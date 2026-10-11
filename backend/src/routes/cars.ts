const express = require("express");
const { query } = require("../database");
const { ApiError, asyncHandler } = require("../lib/errors");
const { escapeLike, validateRentalDates } = require("../lib/validation");
const { requireAuth, requireCompletedProfile } = require("../middleware/auth");

const router = express.Router();
const sortOptions = {
  featured: { featured: -1, sortOrder: 1, _id: 1 },
  "price-asc": { pricePerDay: 1, sortOrder: 1 },
  "price-desc": { pricePerDay: -1, sortOrder: 1 },
};

router.get(
  "/preview",
  asyncHandler(async (request, response) => {
    const result = await query(
      `SELECT id, make, model, image, category, price_per_day
       FROM cars
       WHERE active = true AND fleet_status = 'available'
       ORDER BY featured DESC, sort_order, id
       LIMIT 18`,
    );
    response.json({
      cars: result.rows.map((car) => ({
        id: String(car.id),
        make: car.make,
        model: car.model,
        image: car.image,
        category: car.category,
        pricePerDay: car.price_per_day,
      })),
    });
  }),
);

router.use(requireAuth, requireCompletedProfile);

router.get(
  "/",
  asyncHandler(async (request, response) => {
    const { category, from, location, q, sort = "featured", to } = request.query;
    const conditions = ["c.active = true", "c.fleet_status = 'available'"];
    const values: unknown[] = [];
    const addValue = (value) => {
      values.push(value);
      return `$${values.length}`;
    };

    if (!Object.hasOwn(sortOptions, sort)) {
      throw new ApiError(400, "Choose a valid vehicle sort order.");
    }
    if (category) {
      if (!["sport", "suv", "electric"].includes(category)) {
        throw new ApiError(400, "Choose a valid vehicle category.");
      }
      conditions.push(`${addValue(category)} = ANY(c.category)`);
    }
    if (q) {
      if (typeof q !== "string" || q.length > 80) throw new ApiError(400, "Search must be 80 characters or fewer.");
      const pattern = addValue(`%${escapeLike(q.trim())}%`);
      conditions.push(`(
        c.make ILIKE ${pattern} ESCAPE '!'
        OR c.model ILIKE ${pattern} ESCAPE '!'
        OR c.description ILIKE ${pattern} ESCAPE '!'
      )`);
    }
    if (location) {
      if (typeof location !== "string" || location.length > 80) throw new ApiError(400, "Choose a valid pick-up location.");
      conditions.push(`${addValue(location.trim())} = ANY(c.service_areas)`);
    }
    if (Boolean(from) !== Boolean(to)) {
      throw new ApiError(400, "Choose both a pick-up and return date.");
    }
    if (from && to) {
      const validation = validateRentalDates(from, to);
      if (validation.error) throw new ApiError(400, validation.error);
      const start = addValue(validation.value.from);
      const end = addValue(validation.value.to);
      conditions.push(`NOT EXISTS (
        SELECT 1
        FROM reservation_slots AS rs
        WHERE rs.car_id = c.id
          AND rs.rental_day >= ${start}::date
          AND rs.rental_day < ${end}::date
      )`);
    }

    const ordering = {
      featured: "c.featured DESC, c.sort_order, c.id",
      "price-asc": "c.price_per_day, c.sort_order, c.id",
      "price-desc": "c.price_per_day DESC, c.sort_order, c.id",
    }[sort];
    const result = await query(
      `SELECT
         c.id, c.make, c.model, c.image, c.description, c.category,
         c.price_per_day, c.seats, c.transmission, c.highlight,
         c.service_areas, c.featured, c.sort_order, c.variants
       FROM cars AS c
       WHERE ${conditions.join(" AND ")}
       ORDER BY ${ordering}`,
      values,
    );
    response.json({
      cars: result.rows.map((car) => ({
        _id: String(car.id),
        make: car.make,
        model: car.model,
        image: car.image,
        description: car.description,
        category: car.category,
        pricePerDay: car.price_per_day,
        seats: car.seats,
        transmission: car.transmission,
        highlight: car.highlight,
        serviceAreas: car.service_areas,
        featured: car.featured,
        sortOrder: car.sort_order,
        variants: car.variants ?? [],
      })),
    });
  }),
);

router.get(
  "/:carId",
  asyncHandler(async (request, response) => {
    if (!/^[1-9]\d*$/.test(request.params.carId)) throw new ApiError(404, "That car could not be found.");
    const result = await query(
      `SELECT id, make, model, image, description, category, price_per_day,
              seats, transmission, highlight, service_areas, featured, sort_order, variants
       FROM cars
       WHERE id = $1 AND active = true AND fleet_status = 'available'`,
      [request.params.carId],
    );
    const car = result.rows[0];
    if (!car) throw new ApiError(404, "That car could not be found.");
    response.json({
      car: {
        _id: String(car.id),
        make: car.make,
        model: car.model,
        image: car.image,
        description: car.description,
        category: car.category,
        pricePerDay: car.price_per_day,
        seats: car.seats,
        transmission: car.transmission,
        highlight: car.highlight,
        serviceAreas: car.service_areas,
        featured: car.featured,
        sortOrder: car.sort_order,
        variants: car.variants ?? [],
      },
    });
  }),
);

module.exports = router;
