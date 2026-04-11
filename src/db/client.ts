import { Pool } from "pg";
import type { AppConfig } from "../config/env.js";

export function createPool(config: AppConfig): Pool {
  return new Pool({
    host: config.pgHost,
    port: config.pgPort,
    database: config.pgDatabase,
    user: config.pgUser,
    password: config.pgPassword,
  });
}
