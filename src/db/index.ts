import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

declare global {
  // eslint-disable-next-line no-var
  var __mockstock_sql: ReturnType<typeof postgres> | undefined;
}

// One pool per process. Reused across HMR reloads in dev so we don't leak
// connections every time a file changes.
export const sql =
  global.__mockstock_sql ??
  postgres(connectionString, {
    max: 20,
    idle_timeout: 30,
    connect_timeout: 10,
    // Never let a stuck order transaction pin a connection through an event.
    connection: { statement_timeout: 15000 },
    onnotice: () => {},
  });

if (process.env.NODE_ENV !== "production") global.__mockstock_sql = sql;

export const db = drizzle(sql, { schema });
export type DB = typeof db;
export * from "./schema";

/** A Drizzle transaction handle. Helpers accept `DB | Tx` so they compose. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Conn = DB | Tx;
