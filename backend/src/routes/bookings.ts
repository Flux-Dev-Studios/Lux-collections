const express = require("express");
const { query, withTransaction } = require("../database");
const { ApiError, asyncHandler } = require("../lib/errors");
const { validateRentalDates } = require("../lib/validation");
const { requireAuth, requireCompletedProfile } = require("../middleware/auth");
const { requireObjectBody } = require("../middleware/security");

const router = express.Router();
router.use(requireAuth, requireCompletedProfile);

function publicBooking(row) {
  return {
    _id: String(row.id),
    user: String(row.user_id),
    car: row.car_id === null
      ? null
      : {
          _id: String(row.car_id),
          make: row.make,
          model: row.model,
          image: row.image,
          category: row.category,
          pricePerDay: row.car_price_per_day,
          variant: row.variant_id ? {
            id: row.variant_id,
            name: row.variant_name,
            design: row.variant_design,
            pricePerDay: row.variant_price_per_day,
            details: row.variant_details ?? {},
          } : null,
        },
    startDate: row.start_date,
    endDate: row.end_date,
    pickupLocation: row.pickup_location,
    days: row.days,
    pricePerDay: row.price_per_day,
    totalPrice: row.total_price,
    status: row.status,
    createdAt: row.created_at,
    payment: row.paid_cents === undefined ? undefined : {
      paid: Number(row.paid_cents || 0) / 100,
      due: Math.max(0, Number(row.total_price) - Number(row.paid_cents || 0) / 100),
      pending: Boolean(row.payment_open),
      status: Number(row.paid_cents || 0) >= Math.round(Number(row.total_price) * 100)
        ? "paid"
        : Number(row.paid_cents || 0) > 0 ? "partial" : "unpaid",
    },
  };
}

router.get(
  "/",
  asyncHandler(async (request, response) => {
    const result = await query(
      `SELECT
         b.id, b.user_id, b.car_id, b.start_date, b.end_date,
         b.pickup_location, b.days, b.price_per_day, b.total_price,
         b.variant_id, b.variant_name, b.variant_design, b.variant_price_per_day, b.variant_details,
         b.status, b.created_at,
         coalesce((SELECT sum(p.amount_cents)::int FROM booking_payments p
                   WHERE p.booking_id = b.id AND p.status = 'paid'), 0) AS paid_cents,
         exists(SELECT 1 FROM booking_payments p
                WHERE p.booking_id = b.id AND p.status = 'open') AS payment_open,
         c.make, c.model, c.image, c.category, c.price_per_day AS car_price_per_day
       FROM bookings AS b
       LEFT JOIN cars AS c ON c.id = b.car_id
       WHERE b.user_id = $1
       ORDER BY b.created_at DESC, b.id DESC`,
      [request.user.id],
    );
    response.json({ bookings: result.rows.map(publicBooking) });
  }),
);

router.post(
  "/",
  asyncHandler(async (request, response) => {
    const body = requireObjectBody(request.body);
    const { from, location, to } = body;
    const variantId = typeof body.variantId === "string" ? body.variantId : "base";
    const submittedCarId = body.carId ?? body.vehicleId ?? body.id ?? body._id;
    const carId = Number.isSafeInteger(submittedCarId) && submittedCarId > 0
      ? String(submittedCarId)
      : submittedCarId;
    if (typeof carId !== "string" || !/^[1-9]\d*$/.test(carId)) {
      throw new ApiError(400, "Choose a vehicle from the collection.");
    }
    if (typeof location !== "string" || location.trim().length < 2 || location.length > 80) {
      throw new ApiError(400, "Enter a valid pick-up location.");
    }
    const dates = validateRentalDates(from, to);
    if (dates.error) throw new ApiError(400, dates.error);

    const carResult = await query(
      `SELECT id, make, model, image, category, price_per_day, service_areas, variants
       FROM cars
       WHERE id = $1 AND active = true AND fleet_status = 'available'`,
      [carId],
    );
    const car = carResult.rows[0];
    if (!car) throw new ApiError(404, "That car is no longer available.");
    if (!car.service_areas.includes(location.trim())) {
      throw new ApiError(400, "This car is not available at that pick-up location.");
    }
    const variant = variantId === "base" ? null : car.variants.find((item) => item.id === variantId);
    if (variantId !== "base" && !variant) throw new ApiError(400, "Choose a valid version of this vehicle.");
    const dailyRate = variant ? variant.pricePerDay : car.price_per_day;

    let booking;
    try {
      booking = await withTransaction(async (client) => {
        const bookingResult = await client.query(
          `INSERT INTO bookings (
             user_id, car_id, start_date, end_date, pickup_location,
             days, price_per_day, total_price, status,
             variant_id, variant_name, variant_design, variant_price_per_day, variant_details
           )
           VALUES ($1, $2, $3::date, $4::date, $5, $6::integer, $7::numeric, $7::numeric * $6::integer, 'requested', $8, $9, $10, $11, $12::jsonb)
           RETURNING id, user_id, car_id, start_date, end_date,
                     pickup_location, days, price_per_day, total_price,
                     status, created_at, variant_id, variant_name, variant_design,
                     variant_price_per_day, variant_details`,
          [
            request.user.id,
            car.id,
            from,
            to,
            location.trim(),
            dates.value.days,
            dailyRate,
            variant?.id ?? null,
            variant?.name ?? null,
            variant?.design ?? null,
            variant?.pricePerDay ?? null,
            JSON.stringify(variant ?? {}),
          ],
        );
        const created = bookingResult.rows[0];

        await client.query(
          `INSERT INTO reservation_slots (car_id, rental_day, booking_id)
           SELECT $1, rental_day::date, $4
           FROM generate_series($2::date, $3::date - 1, interval '1 day') AS dates(rental_day)`,
          [car.id, from, to, created.id],
        );
        await client.query(
          `INSERT INTO booking_status_events (booking_id, actor_user_id, old_status, new_status, note)
           VALUES ($1, $2, 'new', 'requested', 'Reservation request created')`,
          [created.id, request.user.id],
        );
        return created;
      });
    } catch (error) {
      if (
        error.code === "23505" &&
        error.constraint === "reservation_slots_pkey"
      ) {
        throw new ApiError(409, "Sorry, this car was just reserved for one or more of those dates. Please choose another date.");
      }
      throw error;
    }

    response.status(201).json({
      booking: publicBooking({
        ...booking,
        make: car.make,
        model: car.model,
        image: car.image,
        category: car.category,
        car_price_per_day: car.price_per_day,
      }),
      message: "Your request is with our team. We will confirm your reservation personally.",
    });
  }),
);

router.post(
  "/:bookingId/cancel",
  asyncHandler(async (request, response) => {
    if (!/^[1-9]\d*$/.test(request.params.bookingId)) {
      throw new ApiError(404, "That reservation could not be found.");
    }
    const booking = await withTransaction(async (client) => {
      const result = await client.query(
        `UPDATE bookings
         SET status = 'cancelled', updated_at = now()
         WHERE id = $1 AND user_id = $2 AND status = 'requested'
         RETURNING id, user_id, car_id, start_date, end_date,
                   pickup_location, days, price_per_day, total_price,
                   status, created_at, variant_id, variant_name, variant_design,
                   variant_price_per_day, variant_details`,
        [request.params.bookingId, request.user.id],
      );
      const cancelled = result.rows[0];
      if (!cancelled) return null;
      await client.query("DELETE FROM reservation_slots WHERE booking_id = $1", [cancelled.id]);
      await client.query(
        `INSERT INTO booking_status_events (booking_id, actor_user_id, old_status, new_status, note)
         VALUES ($1, $2, 'requested', 'cancelled', 'Cancelled by customer')`,
        [cancelled.id, request.user.id],
      );
      return cancelled;
    });

    if (!booking) throw new ApiError(404, "That reservation was already cancelled or could not be found.");
    response.json({
      booking: publicBooking(booking),
      message: "Your reservation request has been cancelled.",
    });
  }),
);

module.exports = router;
