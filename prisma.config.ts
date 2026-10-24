import { defineConfig } from "prisma/config";

// Load .env without extra dependencies (Node 22+). Missing file is fine in CI/prod.
try {
  process.loadEnvFile();
} catch {}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Supabase: migrations need the direct connection (port 5432), not the pooler.
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
