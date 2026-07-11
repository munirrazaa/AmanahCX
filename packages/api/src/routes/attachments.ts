import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Readable } from 'stream';
import type { DatabaseClient } from '@crm/core';
import { requireScope } from '../middlewares/auth.middleware';
import { buildFileStorage } from '../lib/file-storage';

const storage = buildFileStorage();

const ENTITY_TYPES = ['deal', 'contact', 'ticket', 'activity', 'company'] as const;

const UploadSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string().uuid(),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(3).max(100),
  // base64 without data-uri prefix — matches the mobile card-scan convention
  data: z.string().min(4),
});

export function attachmentRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {
    // Table is created lazily so no migration step is needed in dev. When the
    // app's DB role lacks DDL rights (hardened setups), an existing table is
    // fine — only fail if the table is genuinely missing.
    try {
      await db.withSuperAdmin(async (client) => {
        await client.query(`
          CREATE TABLE IF NOT EXISTS attachments (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id UUID NOT NULL,
            filename TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size_bytes BIGINT NOT NULL,
            storage_key TEXT NOT NULL,
            uploaded_by UUID,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments (tenant_id, entity_type, entity_id);
        `);
      });
    } catch (err) {
      const exists = await db.withSuperAdmin(async (client) => {
        const r = await client.query("SELECT to_regclass('public.attachments') IS NOT NULL AS ok");
        return r.rows[0]?.ok;
      });
      if (!exists) throw err;
    }

    // UPLOAD — POST /api/v1/attachments  (base64 JSON body, ≤ 15 MB decoded)
    fastify.post('/', {
      preHandler: requireScope('contacts:write'),
      bodyLimit: 20 * 1024 * 1024,
    }, async (req, reply) => {
      const body = UploadSchema.parse(req.body);
      const buffer = Buffer.from(body.data, 'base64');
      if (buffer.length > 15 * 1024 * 1024) {
        return reply.code(413).send({ success: false, error: { code: 'TOO_LARGE', message: 'File must be under 15 MB.' } });
      }

      const stored = await storage.save(
        Readable.from(buffer),
        body.filename,
        `attachments/${req.tenant.id}/${body.entityType}`,
      );

      const [row] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `INSERT INTO attachments (tenant_id, entity_type, entity_id, filename, mime_type, size_bytes, storage_key, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, filename, mime_type, size_bytes, created_at`,
          [req.tenant.id, body.entityType, body.entityId, body.filename, body.mimeType, buffer.length, stored.key, req.user.sub],
        );
        return r.rows;
      });

      return reply.code(201).send({ success: true, data: row });
    });

    // LIST — GET /api/v1/attachments?entityType=deal&entityId=…
    fastify.get('/', { preHandler: requireScope('contacts:read') }, async (req, reply) => {
      const { entityType, entityId } = req.query as { entityType?: string; entityId?: string };
      if (!entityType || !entityId) {
        return reply.code(400).send({ success: false, error: { code: 'BAD_REQUEST', message: 'entityType and entityId are required' } });
      }
      const rows = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `SELECT id, filename, mime_type, size_bytes, uploaded_by, created_at
           FROM attachments WHERE entity_type = $1 AND entity_id = $2
           ORDER BY created_at DESC`,
          [entityType, entityId],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // DOWNLOAD — GET /api/v1/attachments/:id/download
    fastify.get('/:id/download', { preHandler: requireScope('contacts:read') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query('SELECT filename, mime_type, storage_key FROM attachments WHERE id = $1', [id]);
        return r.rows;
      });
      if (!row) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Attachment not found' } });
      const buf = await storage.load(row.storage_key);
      return reply
        .header('Content-Type', row.mime_type)
        .header('Content-Disposition', `inline; filename="${row.filename}"`)
        .send(buf);
    });

    // DELETE — DELETE /api/v1/attachments/:id
    fastify.delete('/:id', { preHandler: requireScope('contacts:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query('DELETE FROM attachments WHERE id = $1 RETURNING storage_key', [id]);
        return r.rows;
      });
      if (row) await storage.remove(row.storage_key).catch(() => {});
      return reply.code(204).send();
    });
  };
}
