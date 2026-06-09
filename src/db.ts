import pg from "pg";
import { getConfig } from "./config.js";

export const pool = new pg.Pool({
  connectionString: getConfig().databaseUrl,
});

export type Queryable = pg.Pool | pg.PoolClient;

export async function closePool() {
  await pool.end();
}
