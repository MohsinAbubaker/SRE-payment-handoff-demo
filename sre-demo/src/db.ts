import { Pool } from "pg";

export const db = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://demo:demo@localhost:5432/payments"
});

export async function initDb() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'confirmed'
    );

    CREATE TABLE IF NOT EXISTS handoffs (
      payment_id TEXT PRIMARY KEY REFERENCES payments(id),
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS crm_records (
      payment_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS demo_control (
      id INTEGER PRIMARY KEY,
      paused BOOLEAN NOT NULL DEFAULT FALSE
    );

    INSERT INTO demo_control (id, paused)
    VALUES (1, FALSE)
    ON CONFLICT (id) DO NOTHING;
  `);
}
