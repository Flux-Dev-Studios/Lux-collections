import type { RequestHandler } from "express";
import { env } from "../config/env";
import { ApiError } from "../lib/errors";

export const requireSameOrigin: RequestHandler = (request, response, next) => {
  const origin = request.get("origin");
  const deploymentOrigin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined;
  if (origin && origin !== env.appOrigin && origin !== deploymentOrigin) {
    return next(new ApiError(403, "This request did not come from the Lux Collection website."));
  }
  next();
};

export function requireObjectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "Send the details as a JSON object.");
  }
  return body as Record<string, unknown>;
}
