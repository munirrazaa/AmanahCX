import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseClient } from '@crm/core';
import { logger } from '@crm/core/config/logger';

async function migrate() {
  const db = new DatabaseClient(process.env.DATABASE_URL!);
  await db.connect();

  // Works for both:
  //   Dev (tsx):      __dirname = packages/api/src/scripts  → ../../core/src/database/migrations
  //   Prod (compiled): __dirname = packages/api/dist/scripts → ../../core/src/database/migrations
  // The Dockerfile copies migrations to packages/core/src/database/migrations in the image.
  const migrationsDir = path.resolve(__dirname, '../../../core/src/database/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  await db.withSuperAdmin(async (client) => {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    for (const file of files) {
      const [{ count }] = (await client.query(
        'SELECT COUNT(*) FROM _migrations WHERE filename = $1', [file],
      )).rows;

      if (parseInt(count) > 0) {
        logger.info(`Skipping ${file} (already applied)`);
        continue;
      }

      logger.info(`Applying ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      try {
        await client.query(sql);
      } catch (err: any) {
        // If objects already exist (code 42P07 = duplicate table, 42701 = duplicate column)
        // mark as applied and continue — migration was run before tracking was in place
        if (err.code === '42P07' || err.code === '42701' || err.message?.includes('already exists')) {
          logger.warn(`${file} partially applied (objects already exist) — marking as done`);
          await client.query('INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
          continue;
        }
        throw err;
      }
      await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
      logger.info(`Applied ${file}`);
    }
  });

  await db.end();
  logger.info('All migrations complete');
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
