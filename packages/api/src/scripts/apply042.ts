import 'dotenv/config';
import { DatabaseClient } from '@crm/core';
import { readFileSync } from 'fs';
import { join } from 'path';

async function run() {
  const db = new DatabaseClient(process.env.DATABASE_URL!);
  await db.connect();
  const sql = readFileSync(
    join(__dirname, '../../../core/src/database/migrations/042_governance_orders.sql'),
    'utf8',
  );
  await db.withSuperAdmin(async (client) => {
    await client.query(sql);
  });
  console.log('Migration 042 applied successfully.');
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
