import { db, initDb } from "./db";

async function processHandoff() {
  const client = await db.connect();

  try {
    const control = await client.query(
      "SELECT paused FROM demo_control WHERE id = 1"
    );

    if (control.rows[0]?.paused) {
      console.log("Worker alive, processing paused");
      return;
    }

    await client.query("BEGIN");

    const result = await client.query(`
      SELECT payment_id
      FROM handoffs
      WHERE status = 'pending'
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);

    if (result.rowCount === 0) {
      await client.query("COMMIT");
      return;
    }

    const paymentId = result.rows[0].payment_id;

    // Simulate an idempotent CRM handoff
    await client.query(
      `INSERT INTO crm_records(payment_id)
       VALUES($1) ON CONFLICT DO NOTHING`,
      [paymentId]
    );

    await client.query(
      `UPDATE handoffs
       SET status = 'completed', completed_at = NOW()
       WHERE payment_id = $1`,
      [paymentId]
    );

    await client.query("COMMIT");

    console.log(`CRM handoff completed: ${paymentId}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Worker error:", err);
  } finally {
    client.release();
  }
}

async function main() {
  await initDb();

  console.log("Worker started");

  while (true) {
    await processHandoff();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
