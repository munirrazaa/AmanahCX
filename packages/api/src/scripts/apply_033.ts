import 'dotenv/config';
import { DatabaseClient } from '@crm/core';

async function run() {
  const db = new DatabaseClient(process.env.DATABASE_URL!);
  await db.connect();
  await db.withSuperAdmin(async (client) => {
    await client.query(`
      ALTER TABLE tickets
        ADD COLUMN IF NOT EXISTS sla_paused_at       timestamptz,
        ADD COLUMN IF NOT EXISTS sla_pause_elapsed_s integer NOT NULL DEFAULT 0
    `);
  });
  console.log('Migration 033 applied successfully');
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
