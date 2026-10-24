import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

const globalForPrisma = globalThis;

// Lazy so `next build` does not need DATABASE_URL.
export function db() {
  if (!globalForPrisma.prisma) {
    const adapter = new PrismaPg({ connectionString: env.databaseUrl });
    globalForPrisma.prisma = new PrismaClient({ adapter });
  }
  return globalForPrisma.prisma;
}
