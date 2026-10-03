import "dotenv/config";
import { defineConfig } from "prisma/config";

const databaseUrl = process.env.DATABASE_URL?.trim();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // Client generation and static verification do not need a database. Migration
  // and introspection commands still require DATABASE_URL to be configured.
  datasource: databaseUrl ? { url: databaseUrl } : undefined,
});
