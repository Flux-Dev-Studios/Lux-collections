import path from "node:path";
import dotenv from "dotenv";

const isProduction = process.env.NODE_ENV === "production";
const projectRoot = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.join(projectRoot, ".env") });

export const env = {
  appOrigin: process.env.APP_ORIGIN || "http://localhost:3000",
  databaseSsl: process.env.DATABASE_SSL === "true",
  databaseSslCa: process.env.DATABASE_SSL_CA
    ? path.resolve(projectRoot, process.env.DATABASE_SSL_CA)
    : undefined,
  databaseUrl: process.env.DATABASE_URL,
  frontendDirectory: path.resolve(projectRoot, `frontend${isProduction ? "/dist" : ""}`),
  frontendAssetsDirectory: path.resolve(projectRoot, `frontend/${isProduction ? "dist" : "src"}`),
  resendApiKey: process.env.RESEND_API_KEY,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  mailFrom: process.env.MAIL_FROM,
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 3000,
  sessionDays: Number(process.env.SESSION_DAYS) || 7,
};
