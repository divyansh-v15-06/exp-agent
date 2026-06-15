/**
 * Prisma client singleton. Next.js dev mode hot-reloads modules, which would
 * otherwise spawn a new PrismaClient (and connection) on every reload — so we
 * cache it on globalThis outside production.
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
