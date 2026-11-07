import express from "express";
import { db, initDb } from "./db";
import client from "prom-client";

const app = express();
app.use(express.json());

// HTTP health check
app.get("/healthz", (_req, res) => {
  res.json({ status: "healthy" });
});

// Confirm payment and create handoff atomically
app.post("/payments/confirm", async (req, res) => {
  const { paymentId } = req.body;

  if (typeof paymentId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(paymentId)) {
    return res.status(400).json({
      error: "Valid paymentId required"
    });
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO payments(id)
       VALUES($1) ON CONFLICT DO NOTHING`,
      [paymentId]
    );

    await client.query(
      `INSERT INTO handoffs(payment_id)
       VALUES($1) ON CONFLICT DO NOTHING`,
      [paymentId]
    );

    await client.query("COMMIT");

    return res.status(202).json({
      paymentId,
      message: "Payment confirmed; handoff queued"
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ error: "Database error" });
  } finally {
    client.release();
  }
});

// Business workflow status
app.get("/status", async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE status = 'pending'
        )::int AS pending,
        COUNT(*) FILTER (
          WHERE status = 'completed'
        )::int AS completed,
        COALESCE(
          EXTRACT(EPOCH FROM
            NOW() - MIN(created_at) FILTER (
              WHERE status = 'pending'
            )
          ), 0
        )::int AS oldest_pending_seconds
      FROM handoffs
    `);

    res.json(result.rows[0]);
  } catch {
    res.status(503).json({ error: "Database unavailable" });
  }
});

// DEMO ONLY: pause/resume processing
app.post("/demo/pause/:value", async (req, res) => {
  const value = req.params.value;

  if (value !== "true" && value !== "false") {
    return res.status(400).json({ error: "Use true or false" });
  }

  await db.query(
    "UPDATE demo_control SET paused = $1 WHERE id = 1",
    [value === "true"]
  );

  res.json({ paused: value === "true" });
});

initDb().then(() => {
  app.listen(3000, "0.0.0.0", () => {
    console.log("API listening on port 3000");
  });
}).catch(err => {
  console.error(err);
  process.exit(1);
});

client.collectDefaultMetrics();

const pendingGauge = new client.Gauge({
  name: "handoff_pending_total",
  help: "Number of pending handoffs"
});

const oldestGauge = new client.Gauge({
  name: "handoff_oldest_pending_seconds",
  help: "Age of oldest pending handoff"
});

app.get("/metrics", async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE status = 'pending'
        )::int AS pending,
        COALESCE(
          EXTRACT(EPOCH FROM
            NOW() - MIN(created_at) FILTER (
              WHERE status = 'pending'
            )
          ), 0
        )::int AS oldest
      FROM handoffs
    `);

    pendingGauge.set(result.rows[0].pending);
    oldestGauge.set(result.rows[0].oldest);

    res.set("Content-Type", client.register.contentType);
    res.end(await client.register.metrics());
  } catch {
    res.status(503).send("Metrics unavailable");
  }
});
