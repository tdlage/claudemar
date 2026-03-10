import mysql from "mysql2/promise";
import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { config } from "./config.js";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: config.mysqlHost,
      port: config.mysqlPort,
      user: config.mysqlUser,
      password: config.mysqlPassword,
      database: config.mysqlDatabase,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      timezone: "+00:00",
      decimalNumbers: true,
    });
  }
  return pool;
}

export async function query<T extends RowDataPacket[]>(sql: string, params?: (string | number | null | boolean)[]): Promise<T> {
  const [rows] = await getPool().execute<T>(sql, params ?? []);
  return rows;
}

export async function execute(sql: string, params?: (string | number | null | boolean)[]): Promise<ResultSetHeader> {
  const [result] = await getPool().execute<ResultSetHeader>(sql, params ?? []);
  return result;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
