CREATE TABLE IF NOT EXISTS users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND length(email) <= 254),
  password_hash text NOT NULL,
  full_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'operator', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx ON password_reset_tokens (user_id);

CREATE TABLE IF NOT EXISTS cars (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  make text NOT NULL,
  model text NOT NULL,
  image text NOT NULL,
  description text NOT NULL,
  category text[] NOT NULL CHECK (
    cardinality(category) > 0
    AND category <@ ARRAY['sport', 'suv', 'electric']::text[]
  ),
  price_per_day numeric(10, 2) NOT NULL CHECK (price_per_day > 0),
  seats smallint NOT NULL CHECK (seats > 0),
  transmission text NOT NULL,
  highlight text NOT NULL,
  service_areas text[] NOT NULL CHECK (cardinality(service_areas) > 0),
  featured boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  fleet_status text NOT NULL DEFAULT 'available' CHECK (fleet_status IN ('available', 'maintenance', 'offline')),
  registration_number text NOT NULL DEFAULT '',
  odometer_km integer NOT NULL DEFAULT 0 CHECK (odometer_km >= 0),
  location_label text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  variants jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(variants) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (make, model)
);

CREATE INDEX IF NOT EXISTS cars_active_sort_idx
  ON cars (featured DESC, sort_order, id)
  WHERE active = true;
CREATE INDEX IF NOT EXISTS cars_category_active_idx ON cars USING gin (category);
CREATE INDEX IF NOT EXISTS cars_service_areas_idx ON cars USING gin (service_areas);

CREATE TABLE IF NOT EXISTS bookings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  car_id bigint NOT NULL REFERENCES cars (id) ON DELETE RESTRICT,
  start_date date NOT NULL,
  end_date date NOT NULL,
  pickup_location text NOT NULL,
  days smallint NOT NULL CHECK (days BETWEEN 1 AND 90),
  price_per_day numeric(10, 2) NOT NULL CHECK (price_per_day > 0),
  total_price numeric(12, 2) NOT NULL CHECK (total_price > 0),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'confirmed', 'active', 'completed', 'cancelled', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date > start_date),
  UNIQUE (id, car_id)
);

CREATE INDEX IF NOT EXISTS bookings_user_created_idx ON bookings (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_car_dates_idx ON bookings (car_id, start_date, end_date)
  WHERE status = 'requested';

CREATE TABLE IF NOT EXISTS reservation_slots (
  car_id bigint NOT NULL,
  rental_day date NOT NULL,
  booking_id bigint NOT NULL,
  PRIMARY KEY (car_id, rental_day),
  FOREIGN KEY (booking_id, car_id) REFERENCES bookings (id, car_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS reservation_slots_booking_id_idx ON reservation_slots (booking_id);

CREATE TABLE IF NOT EXISTS booking_status_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id bigint NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  actor_user_id bigint REFERENCES users (id) ON DELETE SET NULL,
  old_status text NOT NULL,
  new_status text NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_status_events_booking_idx
  ON booking_status_events (booking_id, created_at DESC);

CREATE TABLE IF NOT EXISTS booking_payments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id bigint NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  stripe_session_id text NOT NULL UNIQUE,
  stripe_payment_intent_id text UNIQUE,
  checkout_url text NOT NULL,
  plan text NOT NULL CHECK (plan IN ('full', 'half', 'deposit')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'gbp' CHECK (currency = 'gbp'),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'expired', 'failed', 'refunded', 'partially_refunded')),
  expires_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_payments_booking_idx ON booking_payments (booking_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS booking_payments_one_open_idx ON booking_payments (booking_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- Keep existing installations compatible as the schema grows.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'customer';
ALTER TABLE cars ADD COLUMN IF NOT EXISTS fleet_status text NOT NULL DEFAULT 'available';
ALTER TABLE cars ADD COLUMN IF NOT EXISTS registration_number text NOT NULL DEFAULT '';
ALTER TABLE cars ADD COLUMN IF NOT EXISTS odometer_km integer NOT NULL DEFAULT 0;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS location_label text NOT NULL DEFAULT '';
ALTER TABLE cars ADD COLUMN IF NOT EXISTS variants jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS variant_id text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS variant_name text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS variant_design text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS variant_price_per_day numeric(10, 2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS variant_details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('requested', 'confirmed', 'active', 'completed', 'cancelled', 'rejected'));
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('customer', 'operator', 'admin'));
ALTER TABLE cars DROP CONSTRAINT IF EXISTS cars_fleet_status_check;
ALTER TABLE cars ADD CONSTRAINT cars_fleet_status_check CHECK (fleet_status IN ('available', 'maintenance', 'offline'));

-- These tables are in Supabase's exposed public schema. The app accesses them
-- through its trusted server-side PostgreSQL connection, not the Data API.
-- Enable RLS without public policies so anon/authenticated API roles cannot
-- read or mutate application data directly.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE cars ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;
