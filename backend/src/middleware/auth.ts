import { createHash } from "node:crypto";
import type { CookieOptions, RequestHandler } from "express";
import { query } from "../database";
import { env } from "../config/env";
import { ApiError, asyncHandler } from "../lib/errors";
import { profileIsComplete, type Profile } from "../lib/validation";

export const SESSION_COOKIE = "lux_session";

interface SessionUserRow {
  id: string;
  email: string;
  role: "customer" | "operator" | "admin";
  full_name: string;
  phone: string;
  city: string;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionCookieOptions(expiresAt: Date): CookieOptions {
  return {
    httpOnly: true,
    maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
    path: "/",
    sameSite: "lax",
    secure: env.nodeEnv === "production",
    expires: expiresAt,
  };
}

export const requireAuth: RequestHandler = asyncHandler(async (request, response, next) => {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) {
    if (request.path.endsWith(".html")) {
      response.redirect(302, `/login.html?next=${encodeURIComponent(request.path)}`);
      return;
    }
    throw new ApiError(401, "Please sign in to continue.");
  }

  const result = await query<SessionUserRow>(
  `SELECT s.expires_at, u.id, u.email, u.full_name, u.phone, u.city, u.role
     FROM sessions AS s
     JOIN users AS u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const session = result.rows[0];

  if (!session) {
    response.clearCookie(SESSION_COOKIE, sessionCookieOptions(new Date(0)));
    if (request.path.endsWith(".html")) {
      response.redirect(302, `/login.html?next=${encodeURIComponent(request.path)}`);
      return;
    }
    throw new ApiError(401, "Your session has expired. Please sign in again.");
  }

  request.user = {
    id: session.id,
    email: session.email,
    role: session.role,
    profile: { fullName: session.full_name, phone: session.phone, city: session.city },
  };
  next();
});

export const requireCompletedProfile: RequestHandler = (request, response, next) => {
  const profile: Partial<Profile> = request.user?.profile ?? {};
  if (!profileIsComplete(profile)) {
    if (request.path.endsWith(".html")) {
      response.redirect(302, "/profile.html");
      return;
    }
    next(new ApiError(403, "Complete your profile to view and book cars."));
    return;
  }
  next();
};

export const requireOperator: RequestHandler = (request, response, next) => {
  if (!request.user || !["operator", "admin"].includes(request.user.role)) {
    next(new ApiError(403, "Operator access is required."));
    return;
  }
  next();
};
