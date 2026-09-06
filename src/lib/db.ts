import { PrismaClient } from "../../prisma/generated/client";

// Singleton Prisma client — avoids exhausting connections under Next.js dev hot-reload
// and serverless module re-invocation. See docs/08-backend-architecture.md.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.APP_ENV === "production" ? ["error"] : ["error", "warn"],
  });

if (process.env.APP_ENV !== "production") {
  globalForPrisma.prisma = db;
}
