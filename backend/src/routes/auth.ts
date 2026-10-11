const { randomBytes } = require("node:crypto");
const bcrypt = require("bcryptjs");
const express = require("express");
const { rateLimit } = require("express-rate-limit");
const { query, withTransaction } = require("../database");
const { env } = require("../config/env");
const { sessionDays } = env;
const { ApiError, asyncHandler } = require("../lib/errors");
const {
  profileIsComplete,
  validateProfile,
  validateRegistration,
} = require("../lib/validation");
const {
  SESSION_COOKIE,
  hashToken,
  requireAuth,
  sessionCookieOptions,
} = require("../middleware/auth");
const { requireObjectBody } = require("../middleware/security");

const router = express.Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Please try again in 15 minutes." },
});
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many password reset requests. Please try again later." },
});

async function sendPasswordResetEmail(email, token) {
  if (!env.resendApiKey || !env.mailFrom) throw new Error("Password reset email is not configured.");
  const resetUrl = new URL("/reset-password.html", env.appOrigin);
  resetUrl.searchParams.set("token", token);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.mailFrom,
      to: [email],
      subject: "Reset your Lux Collection password",
      text: `Use this link to choose a new password. It expires in 30 minutes:\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>Use the link below to choose a new password. It expires in 30 minutes.</p><p><a href="${resetUrl}">Reset your password</a></p><p>If you did not request this, you can ignore this email.</p>`,
    }),
  });
  if (!response.ok) throw new Error(`Password reset email provider returned ${response.status}.`);
}

function publicUser(user) {
  return {
    id: String(user.id),
    email: user.email,
    role: user.role || "customer",
    profile: {
      fullName: user.full_name ?? user.profile?.fullName ?? "",
      phone: user.phone ?? user.profile?.phone ?? "",
      city: user.city ?? user.profile?.city ?? "",
    },
    profileComplete: profileIsComplete({
      fullName: user.full_name ?? user.profile?.fullName ?? "",
      phone: user.phone ?? user.profile?.phone ?? "",
      city: user.city ?? user.profile?.city ?? "",
    }),
  };
}

async function createUserSession(user, response) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDays * 86_400_000);
  await query("DELETE FROM sessions WHERE expires_at <= now()");
  await query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [hashToken(token), user.id, expiresAt],
  );
  response.cookie(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

router.post(
  "/password-reset/request",
  passwordResetLimiter,
  asyncHandler(async (request, response) => {
    const body = requireObjectBody(request.body);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new ApiError(400, "Enter a valid email address.");
    }
    if (!env.resendApiKey || !env.mailFrom) {
      throw new ApiError(503, "Password recovery is not configured yet. Please contact support.");
    }

    const result = await query("SELECT id FROM users WHERE email = $1", [email]);
    if (result.rows[0]) {
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await query("DELETE FROM password_reset_tokens WHERE user_id = $1", [result.rows[0].id]);
      await query(
        "INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
        [hashToken(token), result.rows[0].id, expiresAt],
      );
      try {
        await sendPasswordResetEmail(email, token);
      } catch (error) {
        await query("DELETE FROM password_reset_tokens WHERE user_id = $1", [result.rows[0].id]);
        console.error("Could not send password reset email:", error.message);
      }
    }
    response.status(202).json({
      message: "If an account exists for that email, we’ve sent a password reset link.",
    });
  }),
);

router.post(
  "/password-reset/complete",
  passwordResetLimiter,
  asyncHandler(async (request, response) => {
    const body = requireObjectBody(request.body);
    const token = typeof body.token === "string" ? body.token : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) throw new ApiError(400, "This reset link is invalid or has expired.");
    if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
      throw new ApiError(400, "Your password must be between 8 and 72 characters.");
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await withTransaction(async (client) => {
      const result = await client.query(
        "DELETE FROM password_reset_tokens WHERE token_hash = $1 AND expires_at > now() RETURNING user_id",
        [hashToken(token)],
      );
      if (!result.rows[0]) throw new ApiError(400, "This reset link is invalid or has expired.");
      const userId = result.rows[0].user_id;
      await client.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [passwordHash, userId]);
      await client.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [userId]);
    });
    response.clearCookie(SESSION_COOKIE, sessionCookieOptions(new Date(0)));
    response.json({ message: "Your password has been reset. Please sign in with your new password." });
  }),
);

router.post(
  "/register",
  asyncHandler(async (request, response) => {
    const validation = validateRegistration(requireObjectBody(request.body));
    if (validation.error) throw new ApiError(400, validation.error);

    const passwordHash = await bcrypt.hash(validation.value.password, 12);
    let result;
    try {
      result = await query(
        `INSERT INTO users (email, password_hash)
         VALUES ($1, $2)
         RETURNING id, email, full_name, phone, city, role`,
        [validation.value.email, passwordHash],
      );
    } catch (error) {
      if (error.code === "23505") throw new ApiError(409, "An account with this email already exists.");
      throw error;
    }

    const user = result.rows[0];
    await createUserSession(user, response);
    response.status(201).json({
      user: publicUser(user),
      next: "/profile.html",
      message: "Your account is ready. Complete your profile to unlock the collection.",
    });
  }),
);

router.post(
  "/login",
  loginLimiter,
  asyncHandler(async (request, response) => {
    const validation = validateRegistration(requireObjectBody(request.body));
    if (validation.error) throw new ApiError(400, validation.error);

    const result = await query(
      `SELECT id, email, password_hash, full_name, phone, city, role
       FROM users
       WHERE email = $1`,
      [validation.value.email],
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(validation.value.password, user.password_hash))) {
      throw new ApiError(401, "That email and password do not match.");
    }

    await createUserSession(user, response);
    response.json({
      user: publicUser(user),
      next: publicUser(user).profileComplete ? "/cars.html" : "/profile.html",
      message: "Welcome back.",
    });
  }),
);

router.get(
  "/me",
  asyncHandler(async (request, response) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) {
      response.json({ user: null });
      return;
    }
    const result = await query(
      `SELECT u.id, u.email, u.full_name, u.phone, u.city, u.role
       FROM sessions AS s
       JOIN users AS u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashToken(token)],
    );
    const user = result.rows[0];
    if (!user) {
      response.clearCookie(SESSION_COOKIE, sessionCookieOptions(new Date(0)));
      response.json({ user: null });
      return;
    }
    response.json({ user: publicUser(user) });
  }),
);

router.put(
  "/profile",
  requireAuth,
  asyncHandler(async (request, response) => {
    const validation = validateProfile(requireObjectBody(request.body));
    if (validation.error) throw new ApiError(400, validation.error);

    const result = await query(
      `UPDATE users
       SET full_name = $1, phone = $2, city = $3, updated_at = now()
       WHERE id = $4
       RETURNING id, email, full_name, phone, city, role`,
      [
        validation.value.fullName,
        validation.value.phone,
        validation.value.city,
        request.user.id,
      ],
    );
    response.json({
      user: publicUser(result.rows[0]),
      message: "Your profile has been saved.",
    });
  }),
);

router.post(
  "/logout",
  asyncHandler(async (request, response) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
    response.clearCookie(SESSION_COOKIE, sessionCookieOptions(new Date(0)));
    response.status(204).end();
  }),
);

module.exports = router;
