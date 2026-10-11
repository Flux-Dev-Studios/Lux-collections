const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const { env } = require("./config/env");
const { pool, query } = require("./database");
const { applySchema } = require("./database/migrate");
const { ApiError, asyncHandler } = require("./lib/errors");
const { requireAuth, requireCompletedProfile, requireOperator } = require("./middleware/auth");
const { requireSameOrigin } = require("./middleware/security");
const authRoutes = require("./routes/auth");
const bookingRoutes = require("./routes/bookings");
const carRoutes = require("./routes/cars");
const operatorRoutes = require("./routes/operator");
const paymentRoutes = require("./routes/payments").default;
const { handleStripeWebhook } = require("./routes/payments");

const app = express();
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        frameSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https://images.unsplash.com"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        ...(env.nodeEnv === "production" ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(cookieParser());
app.use("/api", requireSameOrigin);
app.post("/api/payments/stripe-webhook", express.raw({ type: "application/json", limit: "128kb" }), asyncHandler(handleStripeWebhook));
app.use(express.json({ limit: "16kb" }));

app.get(
  "/api/health",
  asyncHandler(async (request, response) => {
    await query("SELECT 1");
    response.json({ status: "ok", database: "connected" });
  }),
);
app.use("/api/auth", authRoutes);
app.use("/api/cars", carRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/operator", operatorRoutes);

app.use(express.static(env.frontendAssetsDirectory, { index: false, dotfiles: "deny" }));

app.get("/", (request, response) => response.sendFile(`${env.frontendDirectory}/index.html`));
app.get("/login.html", (request, response) => response.sendFile(`${env.frontendDirectory}/login.html`));
app.get("/register.html", (request, response) => response.sendFile(`${env.frontendDirectory}/register.html`));
app.get("/profile.html", requireAuth, (request, response) =>
  response.sendFile(`${env.frontendDirectory}/profile.html`),
);
app.get(
  "/cars.html",
  requireAuth,
  requireCompletedProfile,
  (request, response) => response.sendFile(`${env.frontendDirectory}/cars.html`),
);
app.get(
  "/my-bookings.html",
  requireAuth,
  requireCompletedProfile,
  (request, response) => response.sendFile(`${env.frontendDirectory}/my-bookings.html`),
);
app.get(
  "/checkout.html",
  requireAuth,
  requireCompletedProfile,
  (request, response) => response.sendFile(`${env.frontendDirectory}/checkout.html`),
);
app.get(
  "/reservation-confirmation.html",
  requireAuth,
  requireCompletedProfile,
  (request, response) => response.sendFile(`${env.frontendDirectory}/reservation-confirmation.html`),
);
app.get("/operator.html", requireAuth, requireOperator, (request, response) =>
  response.sendFile(`${env.frontendDirectory}/operator.html`),
);

app.use(express.static(env.frontendDirectory, { index: false, dotfiles: "deny" }));
app.use("/api", (request, response) => response.status(404).json({ error: "API route not found." }));
app.use((request, response) => response.status(404).send("Page not found."));
app.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  if (error instanceof SyntaxError && "body" in error) {
    return response.status(400).json({ error: "The request body must contain valid JSON." });
  }
  if (error.code === "22P02" || error.code === "23514" || error.code === "23503") {
    return response.status(400).json({ error: "Some submitted details are invalid." });
  }
  const status = error instanceof ApiError ? error.status : 500;
  if (status >= 500) console.error("Lux Collection request failed:", error);
  return response.status(status).json({
    error: status >= 500 ? "Something went wrong. Please try again shortly." : error.message,
  });
});

async function start() {
  if (!env.databaseUrl) throw new Error("DATABASE_URL is missing. Copy .env.example to .env and configure PostgreSQL.");
  await applySchema(pool);
  const server = app.listen(env.port, () => {
    console.log(`Lux Collection is running at ${env.appOrigin}`);
    console.log("PostgreSQL connected and schema ready.");
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      server.close(() => pool.end().then(() => process.exit(0)));
    });
  }
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Could not start Lux Collection:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { app, start };
