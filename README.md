# Lux Collection

Lux Collection is a premium car-hire website with a public landing page and a member area. Visitors register and complete a profile before browsing the vehicle catalogue. Members can request a vehicle for selected dates, review their requests and cancel pending requests.

## Project structure

- `frontend/` contains the responsive landing page, account screens, catalogue and reservation history.
- `backend/` contains the Express API, PostgreSQL schema, migrations, session and profile gates, reservation management and catalogue seed data.
- `.env.example` is the local configuration template. Keep `.env` private; it is ignored by Git.

## Requirements

- Node.js 20 or newer.
- A Supabase project (recommended), Docker Desktop for local PostgreSQL, or PostgreSQL 14 or newer running locally or hosted.

## Run locally on Windows

In PowerShell, from the project root:

```powershell
npm install --prefix backend
Copy-Item .env.example .env
```

For the fastest setup, create a Supabase project, open **Connect** in its dashboard, choose **Session pooler**, and copy its URI. Session mode works over IPv4, which is the safe default for a local Windows machine. Replace the placeholders in `.env` with that complete URI and set `DATABASE_SSL=true`. If Node reports a certificate-chain error, download the database CA certificate from **Database → SSL Configuration**, save it inside the project (for example, `backend/certs/prod-ca-2021.crt`), then set `DATABASE_SSL_CA=backend/certs/prod-ca-2021.crt`. TLS verification remains enabled. Percent-encode reserved characters in the database password. Keep the URI private and only use it in the backend; the frontend never connects directly to PostgreSQL.

The app uses its existing PostgreSQL driver and applies `backend/src/database/schema.sql` to the Supabase database on startup. You can also apply it explicitly with `npm run migrate`, then load example cars with `npm run seed`.

After saving the Supabase connection details in `.env`, build the app once before running the compiled migration and seed commands:

```powershell
npm run build
npm run migrate
npm run seed
npm run dev
```

Password recovery email uses [Resend](https://resend.com). Verify a sender domain in Resend, then set `RESEND_API_KEY` and `MAIL_FROM` in `.env` before requesting reset links. The API stores only SHA-256 hashes of 30-minute, single-use tokens and revokes existing sessions after a successful reset. Without these mail settings, the request endpoint returns a setup error and does not create a token.

### Stripe payments

Customers can pay after an operator confirms a reservation. They can choose the full remaining balance, 50%, or a 20% deposit. Partial payments reduce the balance, and the customer can pay another installment from **My reservations**. Amounts are calculated by the server from the saved reservation total and are charged in GBP through [Stripe Checkout](https://docs.stripe.com/payments/checkout).

Set `STRIPE_SECRET_KEY` in `.env`. Create a Stripe webhook endpoint at `https://your-public-domain/api/payments/stripe-webhook`, set its signing secret as `STRIPE_WEBHOOK_SECRET`, and subscribe it to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `checkout.session.expired`. For local development, forward Stripe CLI events to `http://localhost:3000/api/payments/stripe-webhook` and use the CLI's endpoint secret. Use test keys until the full flow has been checked. Stripe Checkout displays the payment methods enabled for the Stripe account; configure those methods in Stripe Dashboard. The app verifies signed webhooks and records successful payments. Refunds and the cancellation policy still need to be configured and handled by the business.

### Apply SQL edits to Supabase when saved

To apply local SQL file edits to the configured database automatically while you work, run this in a separate terminal:

```powershell
npm run db:watch
```

The watcher first checks the PostgreSQL connection, then watches `backend/src/database/schema.sql` and `backend/src/database/seed.sql`. Saving either file applies its complete contents in a transaction after a short pause. It does not run either file at startup. Stop it with `Ctrl+C`. The watcher writes to the database in `DATABASE_URL`, so point that setting at a development Supabase project while editing. A valid database password and CA certificate are still required.

This save-to-remote workflow is convenient for development. For production releases, put reviewed changes into ordered Supabase migration files and push them deliberately so the database change history stays reproducible.

To use the included local PostgreSQL service instead, run:

```powershell
docker compose up -d db
```

For the local service, set `DATABASE_URL=postgresql://postgres:lux_local_only@localhost:5432/lux_collection` and `DATABASE_SSL=false`. The Compose password is for local development only.

Apply the schema, load the demonstration vehicle catalogue, and start the server:

```powershell
npm run build
npm run migrate
npm run seed
npm run dev
```

Open `http://localhost:3000`. Express serves the frontend and API from one origin. If you change the hostname or port, update `APP_ORIGIN` and `PORT` to match.

For a production build and start:

```powershell
npm run build
$env:NODE_ENV = "production"
npm start
```

Use HTTPS in production, set `DATABASE_SSL=true` when required by your database host, configure `APP_ORIGIN` to the exact public origin, and use a private PostgreSQL deployment with backups and restricted network access.

## Customer journey

1. Visitors can explore the public landing page without access to the live vehicle catalogue.
2. Registration creates an account with a hashed password and an authenticated session.
3. Members add their name, phone number and home city to complete their profile.
4. Members browse and filter the catalogue, then check availability by location and date range.
5. A reservation request holds the requested dates. Members can cancel their pending requests.
6. Operators review each request, confirm or reject it, and move confirmed rentals through active and completed.
7. Reservation status changes are kept in an audit history. A request is not a confirmed booking; payment is available only after an operator confirms it.
8. Confirmed reservations can be paid in full, by 50%, or with a 20% deposit through Stripe Checkout. The account shows payment success only after a signed Stripe webhook has been verified and recorded.

## API overview

- `POST /api/auth/register` and `POST /api/auth/login` create an account or session.
- `GET /api/auth/me`, `PUT /api/auth/profile` and `POST /api/auth/logout` manage the member session and profile.
- `POST /api/auth/password-reset/request` sends a reset link; `POST /api/auth/password-reset/complete` consumes it and changes the password.
- `GET /api/cars` lists vehicles for members with a complete profile. Supports `category`, `location`, `from`, `to`, `q` and `sort` query parameters.
- `GET /api/cars/:carId` returns one listed vehicle to an eligible member.
- `GET /api/bookings`, `POST /api/bookings` and `POST /api/bookings/:bookingId/cancel` manage a member's reservation requests.
- `GET /api/health` reports application and database connectivity.
- `/operator.html` is the role-gated operations workspace. `/api/operator/*` provides fleet, reservation, dashboard and customer operations.

Operators can add vehicles, update vehicle daily rates, locations and readiness status, review reservation requests, move confirmed rentals through pickup and completion, and view customer reservation history. Reservation status changes are recorded in `booking_status_events`.

Sessions use random, opaque, `HttpOnly`, `SameSite=Lax` cookies. Only SHA-256 session-token hashes are stored in PostgreSQL. Mutating requests are restricted to the configured same-site origin. Catalogue access is enforced by the API as well as by page routes.

Reservation requests are limited to 90 days. Unique per-car, per-day PostgreSQL slots prevent overlapping requests from claiming the same dates, including concurrent requests.

### Granting operator access

Register an account normally, then promote it directly in your database. For local development, open a PostgreSQL shell with `docker compose exec db psql -U postgres -d lux_collection` and run:

```sql
UPDATE users SET role = 'admin' WHERE email = 'your-operator@example.com';
```

Sign out and back in to refresh the session role. The operations workspace can then be opened at `/operator.html`.

## Example content and launch readiness

Seed vehicle names, specifications, prices, service areas, testimonials and stock photography are demonstration content. Google Fonts and Unsplash images need an internet connection. Payment processing, identity and licence verification, telematics and keyless vehicle control are not connected. Before launch, configure verified fleet data and photography, insurance terms, cancellation rules, privacy notices, email verification, password recovery, and production integrations for payments and vehicle operations.

Run the available automated validation tests with:

```powershell
npm test
```

The automated tests cover input normalization, profile completion, date safety and search sanitization. Account, availability and reservation flows should also receive integration coverage against a dedicated test database before production launch.
# Lux-collections
