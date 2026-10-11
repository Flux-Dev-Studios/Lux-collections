import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import express from "express";
import { env } from "../config/env";
import { query, withTransaction } from "../database";
import { ApiError, asyncHandler } from "../lib/errors";
import { requireAuth, requireCompletedProfile } from "../middleware/auth";
import { requireObjectBody } from "../middleware/security";

const router = express.Router();
router.use(requireAuth, requireCompletedProfile);

const planLabels = { full: "Pay in full", half: "Pay 50%", deposit: "Pay 20%" };

router.get("/return/:sessionId", asyncHandler(async (request, response) => {
  const sessionId = request.params.sessionId;
  if (typeof sessionId !== "string" || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new ApiError(404, "Payment not found.");
  const result = await query(
    `SELECT p.status, p.amount_cents, p.currency
     FROM booking_payments p JOIN bookings b ON b.id = p.booking_id
     WHERE p.stripe_session_id = $1 AND b.user_id = $2`,
    [sessionId, request.user.id],
  );
  const payment = result.rows[0];
  if (!payment) throw new ApiError(404, "Payment not found.");
  response.json({ status: payment.status, amount: Number(payment.amount_cents) / 100, currency: payment.currency });
}));

async function stripeRequest(path: string, options: { method?: string; body?: URLSearchParams; idempotencyKey?: string } = {}) {
  if (!env.stripeSecretKey) throw new ApiError(503, "Online payment is not configured yet. Please contact support.");
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${env.stripeSecretKey}`,
      ...(options.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
    },
    ...(options.body ? { body: options.body.toString() } : {}),
  });
  const payload = await response.json();
  if (!response.ok) {
    console.error("Stripe request failed:", response.status, payload?.error?.type || "unknown error");
    throw new ApiError(502, "Stripe could not prepare that payment. Please try again shortly.");
  }
  return payload;
}

router.post("/:bookingId/checkout", asyncHandler(async (request, response) => {
  const bookingId = Array.isArray(request.params.bookingId) ? request.params.bookingId[0] : request.params.bookingId;
  if (!/^[1-9]\d*$/.test(bookingId)) throw new ApiError(404, "Reservation not found.");
  const body = requireObjectBody(request.body);
  if (typeof body.plan !== "string" || !Object.hasOwn(planLabels, body.plan)) {
    throw new ApiError(400, "Choose full payment, a 50% payment, or a 20% deposit.");
  }
  const plan = body.plan as keyof typeof planLabels;

  const result = await withTransaction(async (client) => {
    const bookingResult = await client.query(
      `SELECT b.id, b.total_price, b.status, u.email, c.make, c.model
       FROM bookings b JOIN users u ON u.id = b.user_id JOIN cars c ON c.id = b.car_id
       WHERE b.id = $1 AND b.user_id = $2 FOR UPDATE OF b`,
      [bookingId, request.user.id],
    );
    const booking = bookingResult.rows[0];
    if (!booking) throw new ApiError(404, "Reservation not found.");
    if (booking.status !== "confirmed") throw new ApiError(409, "Payment becomes available after the team confirms your request.");

    const paidResult = await client.query(
      "SELECT coalesce(sum(amount_cents), 0)::bigint AS paid_cents FROM booking_payments WHERE booking_id = $1 AND status = 'paid'",
      [booking.id],
    );
    const totalCents = Math.round(Number(booking.total_price) * 100);
    const balanceCents = totalCents - Number(paidResult.rows[0].paid_cents);
    if (balanceCents <= 0) throw new ApiError(409, "This reservation has already been paid in full.");

    const existingResult = await client.query(
      "SELECT stripe_session_id, checkout_url, plan FROM booking_payments WHERE booking_id = $1 AND status = 'open' FOR UPDATE",
      [booking.id],
    );
    const existing = existingResult.rows[0];
    if (existing) {
      const activeSession = await stripeRequest(`/checkout/sessions/${encodeURIComponent(existing.stripe_session_id)}`);
      if (activeSession.status === "open" && existing.plan === plan) {
        return { url: activeSession.url || existing.checkout_url };
      }
      if (activeSession.status === "open") {
        await stripeRequest(`/checkout/sessions/${encodeURIComponent(existing.stripe_session_id)}/expire`, { method: "POST" });
      } else if (activeSession.status === "complete") {
        throw new ApiError(409, "Stripe is confirming your last payment attempt. Refresh your reservations in a moment.");
      }
      await client.query("UPDATE booking_payments SET status = 'expired', updated_at = now() WHERE stripe_session_id = $1", [existing.stripe_session_id]);
    }

    const fraction = plan === "half" ? 0.5 : plan === "deposit" ? 0.2 : 1;
    const amountCents = plan === "full" ? balanceCents : Math.min(balanceCents, Math.ceil(balanceCents * fraction));
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("customer_email", booking.email);
    form.set("client_reference_id", String(booking.id));
    form.set("success_url", `${env.appOrigin}/my-bookings.html?payment=return&bookingId=${encodeURIComponent(booking.id)}&session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", `${env.appOrigin}/my-bookings.html?payment=cancelled&bookingId=${encodeURIComponent(booking.id)}`);
    form.set("line_items[0][price_data][currency]", "gbp");
    form.set("line_items[0][price_data][unit_amount]", String(amountCents));
    form.set("line_items[0][price_data][product_data][name]", `${booking.make} ${booking.model} rental — ${planLabels[plan]}`);
    form.set("line_items[0][quantity]", "1");
    form.set("metadata[booking_id]", String(booking.id));
    form.set("metadata[user_id]", String(request.user.id));
    form.set("metadata[plan]", plan);

    const session = await stripeRequest("/checkout/sessions", {
      method: "POST",
      body: form,
      idempotencyKey: `lux-booking-${booking.id}-${randomUUID()}`,
    });
    if (!session.id || !session.url) throw new ApiError(502, "Stripe did not return a checkout link. Please try again.");
    await client.query(
      `INSERT INTO booking_payments
         (booking_id, stripe_session_id, checkout_url, plan, amount_cents, currency, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'gbp', 'open', to_timestamp($6))`,
      [booking.id, session.id, session.url, plan, amountCents, session.expires_at],
    );
    return { url: session.url };
  });
  response.json(result);
}));

function hasValidStripeSignature(payload: Buffer, signatureHeader: string, secret: string): boolean {
  const parts = signatureHeader.split(",").map((part) => part.split("=", 2));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !/^\d+$/.test(timestamp) || !signatures.length || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(payload).digest();
  return signatures.some((signature) => {
    if (!/^[a-f\d]{64}$/i.test(signature)) return false;
    const actual = Buffer.from(signature, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}

export async function handleStripeWebhook(request: express.Request, response: express.Response): Promise<void> {
  if (!env.stripeWebhookSecret) throw new ApiError(503, "Stripe webhooks are not configured.");
  if (!Buffer.isBuffer(request.body)) throw new ApiError(400, "The Stripe webhook body must be sent as raw JSON.");
  const signature = request.get("stripe-signature") || "";
  if (!hasValidStripeSignature(request.body, signature, env.stripeWebhookSecret)) {
    throw new ApiError(400, "Stripe webhook signature could not be verified.");
  }
  let event;
  try { event = JSON.parse(request.body.toString("utf8")); }
  catch { throw new ApiError(400, "Stripe sent an invalid webhook payload."); }
  if (!event?.id || !event?.type) throw new ApiError(400, "Stripe sent an incomplete webhook event.");

  await withTransaction(async (client) => {
    const inserted = await client.query(
      "INSERT INTO stripe_webhook_events (event_id, event_type) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING event_id",
      [event.id, event.type],
    );
    if (!inserted.rowCount) return;

    const isPaidEvent = ["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type);
    const isFailedEvent = ["checkout.session.async_payment_failed", "checkout.session.expired"].includes(event.type);
    if (!isPaidEvent && !isFailedEvent) return;
    const session = event.data?.object;
    if (!session?.id) throw new ApiError(400, "Stripe sent a checkout event without a session.");
    const paymentResult = await client.query(
      `SELECT p.id, p.booking_id, p.amount_cents, p.currency, p.status, p.plan,
              b.total_price, b.user_id
       FROM booking_payments p JOIN bookings b ON b.id = p.booking_id
       WHERE p.stripe_session_id = $1 FOR UPDATE OF p, b`,
      [session.id],
    );
    const payment = paymentResult.rows[0];
    if (!payment) return;
    if (session.metadata?.booking_id !== String(payment.booking_id)
      || session.metadata?.user_id !== String(payment.user_id)
      || session.metadata?.plan !== payment.plan) {
      throw new ApiError(400, "Stripe checkout metadata does not match the reservation.");
    }

    if (isPaidEvent && session.payment_status === "paid") {
      if (session.currency !== payment.currency || session.amount_total !== payment.amount_cents) {
        throw new ApiError(400, "Stripe payment amount does not match the reservation payment.");
      }
      if (payment.status !== "paid") {
        const paidBefore = await client.query(
          "SELECT coalesce(sum(amount_cents), 0)::bigint AS cents FROM booking_payments WHERE booking_id = $1 AND status = 'paid'",
          [payment.booking_id],
        );
        if (Number(paidBefore.rows[0].cents) + Number(payment.amount_cents) > Math.round(Number(payment.total_price) * 100)) {
          throw new ApiError(409, "Stripe payment exceeds the remaining reservation balance.");
        }
        await client.query(
          `UPDATE booking_payments
           SET status = 'paid', stripe_payment_intent_id = $1, paid_at = now(), updated_at = now()
           WHERE id = $2`,
          [typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null, payment.id],
        );
      }
    } else if (isFailedEvent && payment.status === "open") {
      await client.query(
        "UPDATE booking_payments SET status = $1, updated_at = now() WHERE id = $2",
        [event.type === "checkout.session.expired" ? "expired" : "failed", payment.id],
      );
    }
  });
  response.json({ received: true });
}

export default router;
