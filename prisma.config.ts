import "dotenv/config";
import { defineConfig } from "prisma/config";

const databaseUrl = process.env.DATABASE_URL?.trim();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // `--conditions=react-server` keeps the `server-only` marker import in the
    // seed's data modules resolvable outside the Next.js bundler.
    seed: "tsx --conditions=react-server prisma/seed.ts",
  },
  // Client generation and static verification do not need a database. Migration
  // and introspection commands still require DATABASE_URL to be configured.
  datasource: databaseUrl ? { url: databaseUrl } : undefined,
});
