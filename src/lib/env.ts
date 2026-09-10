import { z } from "zod";

// Startup config validation — fails fast and clearly if required vars are missing,
// per docs/38-environment-configuration.md and docs/00-ARCHITECTURE-GATE.md §6.
// APP_ENV (not NODE_ENV) drives environment-specific behavior — docs/54-decision-log.md D-8/D-11.

const envSchema = z
  .object({
    APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
    NEXT_PUBLIC_APP_URL: z.string().url(),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    // The unpooled connection, used only by `prisma migrate deploy`. Optional because a
    // local Postgres has no pooler and DATABASE_URL is already direct.
    DIRECT_URL: z.string().optional(),

    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
    // Shared secret the external scheduler presents to /api/v1/internal/cron. Optional so
    // a developer need not set one; the route refuses to run at all when it is unset,
    // rather than running unauthenticated.
    CRON_SECRET: z.string().min(32, "CRON_SECRET must be at least 32 characters").optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    APPLE_CLIENT_ID: z.string().optional(),
    APPLE_CLIENT_SECRET: z.string().optional(),

    REDIS_URL: z.string().min(1, "REDIS_URL is required"),

    AWS_REGION: z.string().min(1),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    S3_BUCKET: z.string().min(1),
    S3_SIGNED_URL_UPLOAD_TTL_SECONDS: z.coerce.number().int().positive().default(120),
    S3_SIGNED_URL_DOWNLOAD_TTL_SECONDS: z.coerce.number().int().positive().default(60),

    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    PAYPAL_CLIENT_ID: z.string().optional(),
    PAYPAL_CLIENT_SECRET: z.string().optional(),
    PAYPAL_WEBHOOK_ID: z.string().optional(),

    EMAIL_PROVIDER_API_KEY: z.string().optional(),
    EMAIL_FROM_ADDRESS: z.string().email().default("no-reply@admitflow.example"),

    DEMO_MODE: z
      .string()
      .default("false")
      .transform((v) => v === "true"),
  })
  .superRefine((val, ctx) => {
    // Hard startup-validation failure — DEMO_MODE must be structurally incapable of being
    // true in production (docs/38-environment-configuration.md, docs/50-test-accounts.md).
    if (val.APP_ENV === "production" && val.DEMO_MODE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DEMO_MODE"],
        message: "DEMO_MODE must never be true when APP_ENV=production",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
