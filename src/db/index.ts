import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
}

// `next dev` re-evaluates modules on every hot reload; without this cache each
// reload would open a fresh connection pool and eventually exhaust Postgres.
const globalForDb = globalThis as unknown as { __a1lensSql?: ReturnType<typeof postgres> };
const client = globalForDb.__a1lensSql ?? postgres(url, { max: 5, onnotice: () => {} });
if (process.env.NODE_ENV !== "production") globalForDb.__a1lensSql = client;

export const db = drizzle(client, { schema });
export const closeDb = () => client.end({ timeout: 5 });
export { schema };
