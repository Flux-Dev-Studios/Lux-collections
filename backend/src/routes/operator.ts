const express = require("express");
const { query, withTransaction } = require("../database");
const { ApiError, asyncHandler } = require("../lib/errors");
const { requireAuth, requireOperator } = require("../middleware/auth");
const { requireObjectBody } = require("../middleware/security");

const router = express.Router();
router.use(requireAuth, requireOperator);

function parseVariants(value) {
  if (value === undefined) return null;
  let variants = value;
  if (typeof variants === "string") {
    if (!variants.trim()) return [];
    try { variants = JSON.parse(variants); } catch { throw new ApiError(400, "Vehicle versions must be valid JSON."); }
  }
  if (!Array.isArray(variants) || variants.length > 12) throw new ApiError(400, "Add up to 12 vehicle versions as a JSON array.");
  const ids = new Set();
  return variants.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ApiError(400, `Version ${index + 1} must be an object.`);
    const id = typeof item.id === "string" ? item.id.trim() : `version-${index + 1}`;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const design = typeof item.design === "string" ? item.design.trim() : "";
    const description = typeof item.description === "string" ? item.description.trim() : "";
    const pricePerDay = Number(item.pricePerDay);
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id) || ids.has(id)) throw new ApiError(400, `Version ${index + 1} needs a unique id (letters, numbers, _ or -).`);
    ids.add(id);
    if (name.length < 2 || name.length > 80 || design.length < 2 || design.length > 160 || description.length > 400) {
      throw new ApiError(400, `Version ${index + 1} needs a name and design; descriptions must be 400 characters or fewer.`);
    }
    if (!Number.isFinite(pricePerDay) || pricePerDay <= 0 || pricePerDay > 100000) throw new ApiError(400, `Version ${index + 1} needs a valid daily rate.`);
    let image = "";
    if (item.image) {
      try { const parsed = new URL(item.image); if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(); image = parsed.toString(); }
      catch { throw new ApiError(400, `Version ${index + 1} needs a valid HTTP or HTTPS image URL.`); }
    }
    const textMap = (source, allowed) => {
      const output = {};
      if (source === undefined) return output;
      if (!source || typeof source !== "object" || Array.isArray(source)) throw new ApiError(400, `Version ${index + 1} has invalid vehicle details.`);
      for (const key of allowed) {
        const field = source[key];
        if (field === undefined || field === "") continue;
        if (!["string", "number"].includes(typeof field) || String(field).length > 80) throw new ApiError(400, `Version ${index + 1} has an invalid ${key} detail.`);
        output[key] = String(field).trim();
      }
      return output;
    };
    const features = item.features === undefined ? [] : item.features;
    if (!Array.isArray(features) || features.length > 12 || features.some((feature) => typeof feature !== "string" || !feature.trim() || feature.length > 100)) {
      throw new ApiError(400, `Version ${index + 1} features must be a list of up to 12 short details.`);
    }
    return {
      id, name, design, description, pricePerDay, image,
      performance: textMap(item.performance, ["power", "acceleration", "topSpeed", "drivetrain", "engine"]),
      specs: textMap(item.specs, ["seats", "transmission", "fuel", "range", "bodyStyle"]),
      features: features.map((feature) => feature.trim()),
    };
  });
}

router.get("/dashboard", asyncHandler(async (request, response) => {
  const [fleet, reservations, revenue, recent] = await Promise.all([
    query(`SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE active AND fleet_status = 'available')::int AS available,
                  count(*) FILTER (WHERE fleet_status = 'maintenance')::int AS maintenance
           FROM cars`),
    query(`SELECT count(*) FILTER (WHERE status = 'requested')::int AS awaiting_review,
                  count(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
                  count(*) FILTER (WHERE status = 'active')::int AS active,
                  count(*) FILTER (WHERE status = 'completed')::int AS completed
           FROM bookings`),
    query(`SELECT coalesce(sum(total_price) FILTER (WHERE status IN ('confirmed','active','completed')), 0)::numeric(12,2) AS booked_value
           FROM bookings`),
    query(`SELECT b.id, b.start_date, b.end_date, b.pickup_location, b.days, b.total_price, b.status,
                  u.full_name, c.make, c.model
           FROM bookings b JOIN users u ON u.id = b.user_id JOIN cars c ON c.id = b.car_id
           ORDER BY b.created_at DESC LIMIT 8`),
  ]);
  response.json({
    fleet: fleet.rows[0],
    reservations: reservations.rows[0],
    bookedValue: revenue.rows[0].booked_value,
    recent: recent.rows.map((row) => ({ ...row, id: String(row.id) })),
  });
}));

router.get("/cars", asyncHandler(async (request, response) => {
  const result = await query(`SELECT id, make, model, image, category, price_per_day, seats,
      transmission, service_areas, active, fleet_status, registration_number, odometer_km, location_label, variants
    FROM cars ORDER BY active DESC, make, model`);
  response.json({ cars: result.rows.map((car) => ({ ...car, id: String(car.id) })) });
}));

router.post("/cars", asyncHandler(async (request, response) => {
  const body = requireObjectBody(request.body);
  const variants = parseVariants(body.variants);
  const fields = ["make", "model", "image", "description", "transmission", "highlight"];
  for (const field of fields) {
    if (typeof body[field] !== "string" || !body[field].trim() || body[field].trim().length > (field === "description" ? 600 : 160)) {
      throw new ApiError(400, `Enter a valid ${field.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}.`);
    }
  }
  let imageUrl;
  try { imageUrl = new URL(body.image); } catch { throw new ApiError(400, "Enter a valid vehicle image URL."); }
  if (!["https:", "http:"].includes(imageUrl.protocol)) throw new ApiError(400, "Vehicle images must use HTTP or HTTPS.");
  const categories = Array.isArray(body.category) ? body.category : [body.category];
  if (!categories.length || categories.some((category) => !["sport", "suv", "electric"].includes(category))) {
    throw new ApiError(400, "Choose one or more valid vehicle categories.");
  }
  const serviceAreas = typeof body.serviceAreas === "string" ? body.serviceAreas.split(",").map((area) => area.trim()).filter(Boolean) : [];
  const price = Number(body.pricePerDay);
  const seats = Number(body.seats);
  if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(seats) || seats < 1 || seats > 20 || !serviceAreas.length) {
    throw new ApiError(400, "Enter a valid daily price, seat count and at least one service area.");
  }
  try {
    const result = await query(`INSERT INTO cars
      (make, model, image, description, category, price_per_day, seats, transmission, highlight,
       service_areas, registration_number, location_label, variants, featured, active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,false,true)
      RETURNING id, make, model, fleet_status`,
    [body.make.trim(), body.model.trim(), imageUrl.toString(), body.description.trim(), categories, price,
      seats, body.transmission.trim(), body.highlight.trim(), serviceAreas,
      typeof body.registrationNumber === "string" ? body.registrationNumber.trim().slice(0, 30) : "",
      typeof body.locationLabel === "string" ? body.locationLabel.trim().slice(0, 80) : serviceAreas[0], JSON.stringify(variants ?? [])]);
    response.status(201).json({ car: { ...result.rows[0], id: String(result.rows[0].id) } });
  } catch (error) {
    if (error.code === "23505") throw new ApiError(409, "A vehicle with this make and model already exists.");
    throw error;
  }
}));

router.patch("/cars/:carId", asyncHandler(async (request, response) => {
  if (!/^[1-9]\d*$/.test(request.params.carId)) throw new ApiError(404, "Vehicle not found.");
  const body = requireObjectBody(request.body);
  const status = body.fleetStatus;
  const active = body.active;
  const price = body.pricePerDay;
  const location = body.locationLabel;
  const odometer = body.odometerKm;
  const variants = parseVariants(body.variants);
  if (status !== undefined && !["available", "maintenance", "offline"].includes(status)) {
    throw new ApiError(400, "Choose a valid fleet status.");
  }
  if (active !== undefined && typeof active !== "boolean") throw new ApiError(400, "Active must be true or false.");
  if (price !== undefined && (!Number.isFinite(Number(price)) || Number(price) <= 0)) throw new ApiError(400, "Enter a valid daily rate.");
  if (location !== undefined && (typeof location !== "string" || location.trim().length > 80)) throw new ApiError(400, "Enter a valid location.");
  if (odometer !== undefined && (!Number.isInteger(Number(odometer)) || Number(odometer) < 0)) throw new ApiError(400, "Enter a valid odometer reading.");

  const result = await query(`UPDATE cars SET
      fleet_status = coalesce($1, fleet_status), active = coalesce($2, active),
      price_per_day = coalesce($3, price_per_day), location_label = coalesce($4, location_label),
      odometer_km = coalesce($5, odometer_km), variants = coalesce($7::jsonb, variants), updated_at = now()
    WHERE id = $6 RETURNING id, make, model, active, fleet_status, price_per_day, location_label, odometer_km`,
  [status ?? null, active ?? null, price ?? null, typeof location === "string" ? location.trim() : null, odometer ?? null, request.params.carId, variants === null ? null : JSON.stringify(variants)]);
  if (!result.rowCount) throw new ApiError(404, "Vehicle not found.");
  response.json({ car: { ...result.rows[0], id: String(result.rows[0].id) } });
}));

router.get("/bookings", asyncHandler(async (request, response) => {
  const result = await query(`SELECT b.id, b.start_date, b.end_date, b.pickup_location, b.days,
      b.total_price, b.status, b.created_at, b.variant_name, b.variant_design, u.full_name, u.email, u.phone,
      c.make, c.model, c.registration_number,
      coalesce((SELECT sum(p.amount_cents)::int FROM booking_payments p
                WHERE p.booking_id = b.id AND p.status = 'paid'), 0) AS paid_amount_cents
    FROM bookings b JOIN users u ON u.id = b.user_id JOIN cars c ON c.id = b.car_id
    ORDER BY CASE b.status WHEN 'requested' THEN 0 WHEN 'confirmed' THEN 1 WHEN 'active' THEN 2 ELSE 3 END,
      b.start_date, b.created_at DESC`);
  response.json({ bookings: result.rows.map((row) => ({ ...row, id: String(row.id) })) });
}));

const transitions = {
  requested: ["confirmed", "rejected"],
  confirmed: ["active", "cancelled"],
  active: ["completed"],
  completed: [], cancelled: [], rejected: [],
};

router.patch("/bookings/:bookingId/status", asyncHandler(async (request, response) => {
  if (!/^[1-9]\d*$/.test(request.params.bookingId)) throw new ApiError(404, "Reservation not found.");
  const body = requireObjectBody(request.body);
  const nextStatus = body.status;
  if (!Object.hasOwn(transitions, nextStatus)) throw new ApiError(400, "Choose a valid reservation status.");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
  const booking = await withTransaction(async (client) => {
    const currentResult = await client.query("SELECT id, status FROM bookings WHERE id = $1 FOR UPDATE", [request.params.bookingId]);
    const current = currentResult.rows[0];
    if (!current) return null;
    if (!transitions[current.status]?.includes(nextStatus)) throw new ApiError(409, `A ${current.status} reservation cannot move to ${nextStatus}.`);
    const updated = await client.query("UPDATE bookings SET status = $1, updated_at = now() WHERE id = $2 RETURNING id, status", [nextStatus, current.id]);
    await client.query(`INSERT INTO booking_status_events (booking_id, actor_user_id, old_status, new_status, note)
        VALUES ($1, $2, $3, $4, $5)`, [current.id, request.user.id, current.status, nextStatus, note]);
    if (["rejected", "cancelled", "completed"].includes(nextStatus)) {
      await client.query("DELETE FROM reservation_slots WHERE booking_id = $1", [current.id]);
    }
    return updated.rows[0];
  });
  if (!booking) throw new ApiError(404, "Reservation not found.");
  response.json({ booking: { ...booking, id: String(booking.id) } });
}));

router.get("/customers", asyncHandler(async (request, response) => {
  const result = await query(`SELECT u.id, u.full_name, u.email, u.phone, u.city, u.created_at,
      count(b.id)::int AS reservation_count,
      coalesce(sum(b.total_price) FILTER (WHERE b.status IN ('confirmed','active','completed')), 0)::numeric(12,2) AS lifetime_value
    FROM users u LEFT JOIN bookings b ON b.user_id = u.id
    WHERE u.role = 'customer'
    GROUP BY u.id ORDER BY u.created_at DESC LIMIT 250`);
  response.json({ customers: result.rows.map((row) => ({ ...row, id: String(row.id) })) });
}));

module.exports = router;
