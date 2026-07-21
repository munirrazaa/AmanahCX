/**
 * Sector routes
 *  GET  /api/v1/sector              — current tenant's sector + field definitions
 *  GET  /api/v1/sector/fields        — custom_field_definitions for contacts
 *  POST /api/v1/sector/fields        — add a new custom field
 *  DELETE /api/v1/sector/fields/:id  — remove a custom field
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '@crm/core';
import { requireScope } from '../middlewares/auth.middleware';
import { getSector, SECTORS } from '@crm/shared';

export function sectorRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {

    const readHandler  = [requireScope('tickets:read')];   // agents + managers + admins
    const writeHandler = [requireScope('admin:write')];

    // ── GET /api/v1/sector  —  sector + all fields ───────────────────────
    fastify.get('/', { preHandler: readHandler }, async (req, reply) => {
      const tenantId = req.tenant.id;

      const [tenantRow] = await db.withSuperAdmin(async (client) => {
        const r = await client.query('SELECT sector, settings FROM tenants WHERE id = $1', [tenantId]);
        return r.rows;
      });

      const sectorId = tenantRow?.sector ?? 'other';
      const sectorCfg = getSector(sectorId);

      const fields = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `SELECT id, name, label, field_type, options, is_required, sort_order
           FROM custom_field_definitions
           WHERE tenant_id = $1 AND entity = 'contact'
           ORDER BY sort_order, label`,
          [tenantId],
        );
        return r.rows;
      });

      return reply.send({
        success: true,
        data: {
          sector:   sectorId,
          config:   sectorCfg,
          fields,
          allSectors: SECTORS.map(s => ({ id: s.id, label: s.label, icon: s.icon, description: s.description, color: s.color, bg: s.bg })),
        },
      });
    });

    // ── GET /api/v1/sector/fields  —  just the field list ───────────────
    fastify.get('/fields', { preHandler: readHandler }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const entity = (req.query as any).entity ?? 'contact';
      const validEntities = ['contact', 'company', 'ticket', 'deal'];
      if (!validEntities.includes(entity)) return reply.code(400).send({ success: false, error: { code: 'BAD_REQUEST', message: 'entity must be contact, company, ticket, or deal' } });
      const fields = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `SELECT id, name, label, field_type, options, is_required, sort_order, entity
           FROM custom_field_definitions
           WHERE tenant_id = $1 AND entity = $2
           ORDER BY sort_order, label`,
          [tenantId, entity],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: fields });
    });

    // ── POST /api/v1/sector/fields  —  add a custom field ───────────────
    const AddFieldSchema = z.object({
      name:        z.string().min(1).regex(/^[a-z0-9_]+$/, 'name must be snake_case'),
      label:       z.string().min(1),
      field_type:  z.enum(['text','email','phone','number','date','select','textarea','boolean']),
      entity:      z.enum(['contact','company','ticket','deal']).default('contact'),
      is_required: z.boolean().default(false),
      sort_order:  z.number().int().default(100),
      options:     z.array(z.string()).optional(),
    });

    fastify.post('/fields', { preHandler: writeHandler }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const body = AddFieldSchema.parse(req.body);

      const field = await db.withTenant(tenantId, async (client) => {
        // Insert new fields into their correct alphabetical position among the
        // entity's existing fields (by label), instead of always appending at
        // the end — matches how field lists read in top CRMs. Fields already
        // seeded from a sector preset keep their curated grouping/order; this
        // only affects where a newly-added field lands relative to them.
        // `ORDER BY sort_order, label` elsewhere means even an exact sort_order
        // tie still resolves correctly via the label tiebreak, so a plain
        // midpoint is enough — no need for gap-collision handling.
        const existing = await client.query(
          `SELECT sort_order, label FROM custom_field_definitions
           WHERE tenant_id = $1 AND entity = $2
           ORDER BY sort_order, label`,
          [tenantId, body.entity],
        );
        const rows: { sort_order: number; label: string }[] = existing.rows;
        const insertAt = rows.findIndex(r => r.label.localeCompare(body.label, undefined, { sensitivity: 'base' }) > 0);
        let sortOrder: number;
        if (rows.length === 0) sortOrder = 10;
        else if (insertAt === -1) sortOrder = rows[rows.length - 1].sort_order + 10;
        else if (insertAt === 0) sortOrder = rows[0].sort_order - 10;
        else sortOrder = Math.floor((rows[insertAt - 1].sort_order + rows[insertAt].sort_order) / 2);

        const r = await client.query(
          `INSERT INTO custom_field_definitions
             (tenant_id, entity, name, label, field_type, options, is_required, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (tenant_id, entity, name) DO UPDATE
             SET label = EXCLUDED.label, field_type = EXCLUDED.field_type,
                 options = EXCLUDED.options, is_required = EXCLUDED.is_required,
                 sort_order = EXCLUDED.sort_order
           RETURNING *`,
          [tenantId, body.entity, body.name, body.label, body.field_type,
           body.options ? JSON.stringify(body.options) : null,
           body.is_required, sortOrder],
        );
        return r.rows[0];
      });

      return reply.code(201).send({ success: true, data: field });
    });

    // ── PATCH /api/v1/sector/fields/:id  —  update a field ───────────────
    const UpdateFieldSchema = z.object({
      label:       z.string().min(1).optional(),
      is_required: z.boolean().optional(),
      sort_order:  z.number().int().optional(),
      options:     z.array(z.string()).optional(),
    });

    fastify.patch('/fields/:id', { preHandler: writeHandler }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const { id } = req.params as { id: string };
      const body = UpdateFieldSchema.parse(req.body);

      const field = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `UPDATE custom_field_definitions
           SET
             label       = COALESCE($2, label),
             is_required = COALESCE($3, is_required),
             sort_order  = COALESCE($4, sort_order),
             options     = COALESCE($5, options)
           WHERE id = $1
           RETURNING *`,
          [id, body.label ?? null, body.is_required ?? null, body.sort_order ?? null,
           body.options ? JSON.stringify(body.options) : null],
        );
        return r.rows[0];
      });

      if (!field) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Field not found' } });
      return reply.send({ success: true, data: field });
    });

    // ── POST /api/v1/sector/fields/restore-defaults ───────────────────────
    // Resets every field that matches the tenant's own sector preset back to its
    // default label/type/options/required/order (existing custom fields the
    // tenant added themselves, with no matching name in the sector preset, are
    // left untouched). Works like a single "restore to sector defaults" toggle —
    // no cross-sector browsing, since the tenant only ever has one sector.
    fastify.post('/fields/restore-defaults', { preHandler: writeHandler }, async (req, reply) => {
      const tenantId = req.tenant.id;

      const [tenantRow] = await db.withSuperAdmin(async (client) => {
        const r = await client.query('SELECT sector FROM tenants WHERE id = $1', [tenantId]);
        return r.rows;
      });
      const sectorId = tenantRow?.sector ?? 'other';
      const cfg = getSector(sectorId);

      const entityFieldMap: { entity: 'contact' | 'company' | 'deal' | 'ticket'; fields: any[] }[] = [
        { entity: 'contact', fields: cfg.fields ?? [] },
        { entity: 'company', fields: (cfg as any).companyFields ?? [] },
        { entity: 'deal',    fields: (cfg as any).dealFields    ?? [] },
        { entity: 'ticket',  fields: (cfg as any).ticketFields  ?? [] },
      ];

      let restored = 0;
      await db.withTenant(tenantId, async (client) => {
        for (const { entity, fields } of entityFieldMap) {
          for (const field of fields) {
            await client.query(
              `INSERT INTO custom_field_definitions
                 (tenant_id, entity, name, label, field_type, options, is_required, sort_order)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (tenant_id, entity, name) DO UPDATE
                 SET label = EXCLUDED.label, field_type = EXCLUDED.field_type,
                     options = EXCLUDED.options, is_required = EXCLUDED.is_required,
                     sort_order = EXCLUDED.sort_order`,
              [
                tenantId, entity, field.name, field.label, field.field_type,
                field.options ? JSON.stringify(field.options) : null,
                field.is_required ?? false, field.sort_order ?? 0,
              ],
            );
            restored++;
          }
        }
      });

      return reply.send({ success: true, data: { sector: sectorId, restored } });
    });

    // ── DELETE /api/v1/sector/fields/:id ─────────────────────────────────
    fastify.delete('/fields/:id', { preHandler: writeHandler }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const { id } = req.params as { id: string };

      await db.withTenant(tenantId, async (client) => {
        await client.query(
          `DELETE FROM custom_field_definitions WHERE id = $1 AND tenant_id = $2`,
          [id, tenantId],
        );
      });

      return reply.code(204).send();
    });

    // ── GET /api/v1/sector/all  —  list all available sectors ────────────
    fastify.get('/all', async (_req, reply) => {
      return reply.send({
        success: true,
        data: SECTORS.map(s => ({
          id: s.id, label: s.label, icon: s.icon,
          description: s.description, color: s.color, bg: s.bg,
          contactLabel: s.contactLabel, departments: s.departments,
        })),
      });
    });
  };
}
