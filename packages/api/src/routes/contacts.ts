import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '@crm/core';
import type { EventBus } from '@crm/core';
import { CRM_EVENTS } from '@crm/core';
import { requireScope, requireRole } from '../middlewares/auth.middleware';
import { getVisibleUserIds, ownerScopeSql } from '../lib/visibility';

const CreateContactSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  mobile: z.string().optional(),
  companyId: z.string().uuid().optional(),
  jobTitle: z.string().optional(),
  status: z.enum(['lead', 'prospect', 'customer', 'churned', 'unqualified']).optional(),
  source: z.string().optional(),
  tags: z.array(z.string()).optional(),
  customFields: z.record(z.unknown()).optional(),
  ownerId: z.string().uuid().optional(),
});

const UpdateContactSchema = CreateContactSchema.partial();

const ListQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  search: z.string().optional(),
  status: z.string().optional(),
  ownerId: z.string().optional(),
  source: z.string().optional(),
  sortBy: z.enum(['first_name', 'created_at', 'last_contacted_at', 'score']).default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export function contactRoutes(db: DatabaseClient, eventBus: EventBus) {
  return async function (fastify: FastifyInstance) {

    // LIST contacts
    fastify.get('/', {
      preHandler: requireScope('contacts:read'),
    }, async (req, reply) => {
      const query = ListQuerySchema.parse(req.query);
      const tenantId = req.tenant.id;
      const offset = (query.page - 1) * query.pageSize;

      // Hard visibility filter: a user only sees contacts owned by themselves or
      // anyone beneath them in the reporting tree. Managers see their department.
      // operations_admin sees all contacts tenant-wide (read-only cross-tenant observer).
      const scopeIds = req.user.role === 'operations_admin'
        ? null
        : await db.withTenant(tenantId, (client) =>
            getVisibleUserIds(client, req.user.sub, req.user.role),
          );
      const scopeClause = ownerScopeSql('c.owner_id', scopeIds);
      const scopeClauseNoAlias = ownerScopeSql('owner_id', scopeIds);

      const [{ count }] = await db.withTenant(tenantId, async (client) => {
        const result = await client.query(
          buildCountQuery(query, scopeClauseNoAlias),
          buildQueryParams(query),
        );
        return result.rows;
      });

      const contacts = await db.withTenant(tenantId, async (client) => {
        const result = await client.query(
          buildListQuery(query, offset, scopeClause),
          buildQueryParams(query, query.pageSize, offset),
        );
        return result.rows;
      });

      return reply.send({
        success: true,
        data: contacts,
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total: parseInt(count),
          totalPages: Math.ceil(parseInt(count) / query.pageSize),
        },
      });
    });

    // GET single contact
    fastify.get('/:id', { preHandler: requireScope('contacts:read') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const [contact] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT c.*, comp.name as company_name, u.name as owner_name
           FROM contacts c
           LEFT JOIN companies comp ON c.company_id = comp.id
           LEFT JOIN users u ON c.owner_id = u.id
           WHERE c.id = $1`,
          [id],
        );
        return result.rows;
      });

      if (!contact) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Contact not found' } });
      return reply.send({ success: true, data: contact });
    });

    // CREATE contact
    fastify.post('/', { preHandler: requireScope('contacts:write') }, async (req, reply) => {
      if (req.user.role === 'operations_admin') {
        return reply.code(403).send({ success: false, error: { code: 'OBSERVER_ONLY', message: 'Operations admin has read-only access. Contact changes must be made by agents or managers.' } });
      }
      const body = CreateContactSchema.parse(req.body);
      const ownerId = body.ownerId ?? req.user.sub;

      const requiredFields = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `SELECT name FROM custom_field_definitions WHERE tenant_id = $1 AND entity = 'contact' AND is_required = true`,
          [req.tenant.id],
        );
        return r.rows.map((row: { name: string }) => row.name);
      });

      const customFields = body.customFields ?? {};
      const missingFields = req.user.role === 'super_admin' ? [] : requiredFields.filter(
        (name: string) => customFields[name] === undefined || customFields[name] === null || customFields[name] === '',
      );

      if (missingFields.length > 0) {
        return reply.code(400).send({
          success: false,
          error: {
            code: 'MISSING_REQUIRED_FIELDS',
            message: `Missing required sector fields: ${missingFields.join(', ')}`,
            fields: missingFields,
          },
        });
      }

      const [contact] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `INSERT INTO contacts (tenant_id, first_name, last_name, email, phone, mobile,
            company_id, job_title, owner_id, status, source, tags, custom_fields)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING *`,
          [
            req.tenant.id, body.firstName, body.lastName, body.email, body.phone,
            body.mobile, body.companyId, body.jobTitle, ownerId,
            body.status ?? 'lead', body.source ?? 'manual',
            body.tags ?? [], JSON.stringify(body.customFields ?? {}),
          ],
        );
        return result.rows;
      });

      await eventBus.publish(req.tenant.id, CRM_EVENTS.CONTACT_CREATED, { contact });
      return reply.code(201).send({ success: true, data: contact });
    });

    // BULK IMPORT contacts from CSV
    // POST /api/v1/contacts/import
    // Body: { rows: Array<Record<string,string>>, mapping: Record<string,string> }
    // mapping maps CSV header → CRM field, e.g. { "Email Address": "email" }
    fastify.post('/import', { preHandler: requireScope('contacts:write') }, async (req, reply) => {
      const { rows, mapping } = req.body as {
        rows: Record<string, string>[];
        mapping: Record<string, string>; // csvHeader → crmField
      };

      if (!Array.isArray(rows) || rows.length === 0)
        return reply.code(400).send({ success: false, error: { code: 'EMPTY', message: 'No rows to import' } });
      if (rows.length > 5000)
        return reply.code(400).send({ success: false, error: { code: 'TOO_LARGE', message: 'Maximum 5 000 rows per import' } });

      const tenantId = req.tenant.id;
      const ownerId  = req.user.sub;

      let imported = 0;
      let skipped  = 0;
      const errors: { row: number; reason: string }[] = [];

      // Process in chunks of 100 to avoid huge transactions
      const CHUNK = 100;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);

        await db.withTenant(tenantId, async (client) => {
          for (let j = 0; j < chunk.length; j++) {
            const raw = chunk[j];
            const rowNum = i + j + 2; // +2: 1-based + header row

            // Apply column mapping
            const mapped: Record<string, string> = {};
            for (const [csvCol, crmField] of Object.entries(mapping)) {
              if (raw[csvCol] !== undefined) mapped[crmField] = raw[csvCol];
            }

            const firstName = (mapped.firstName ?? mapped.first_name ?? '').trim();
            if (!firstName) { skipped++; continue; }

            try {
              await client.query(
                `INSERT INTO contacts
                   (tenant_id, first_name, last_name, email, phone, mobile,
                    job_title, status, source, tags, custom_fields, owner_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                 ON CONFLICT (tenant_id, email) WHERE email IS NOT NULL
                 DO UPDATE SET
                   first_name = EXCLUDED.first_name,
                   last_name  = COALESCE(EXCLUDED.last_name, contacts.last_name),
                   phone      = COALESCE(EXCLUDED.phone, contacts.phone),
                   updated_at = NOW()`,
                [
                  tenantId,
                  firstName,
                  (mapped.lastName ?? mapped.last_name ?? '') || null,
                  (mapped.email ?? '') || null,
                  (mapped.phone ?? '') || null,
                  (mapped.mobile ?? '') || null,
                  (mapped.jobTitle ?? mapped.job_title ?? '') || null,
                  ['lead','prospect','customer','churned','unqualified'].includes(mapped.status ?? '')
                    ? mapped.status : 'lead',
                  mapped.source || 'import',
                  '{}',
                  '{}',
                  ownerId,
                ],
              );
              imported++;
            } catch (err: any) {
              errors.push({ row: rowNum, reason: err.message });
              skipped++;
            }
          }
        });
      }

      await eventBus.publish(tenantId, CRM_EVENTS.CONTACT_CREATED, {
        bulk: true, imported, skipped,
      });

      return reply.send({ success: true, data: { imported, skipped, errors: errors.slice(0, 20) } });
    });

    // UPDATE contact
    fastify.patch('/:id', { preHandler: requireScope('contacts:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = UpdateContactSchema.parse(req.body);

      const setClauses: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      const fieldMap: Record<string, string> = {
        firstName: 'first_name', lastName: 'last_name', email: 'email',
        phone: 'phone', mobile: 'mobile', companyId: 'company_id',
        jobTitle: 'job_title', status: 'status', source: 'source',
        tags: 'tags', ownerId: 'owner_id', score: 'score',
      };

      for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
        if (jsKey in body) {
          setClauses.push(`${dbCol} = $${idx++}`);
          values.push((body as any)[jsKey]);
        }
      }

      if (body.customFields) {
        setClauses.push(`custom_fields = custom_fields || $${idx++}::jsonb`);
        values.push(JSON.stringify(body.customFields));
      }

      if (!setClauses.length) return reply.send({ success: true, data: null });

      values.push(id);
      const [contact] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `UPDATE contacts SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
          values,
        );
        return result.rows;
      });

      if (!contact) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Contact not found' } });

      await eventBus.publish(req.tenant.id, CRM_EVENTS.CONTACT_UPDATED, { contact, changes: body });
      return reply.send({ success: true, data: contact });
    });

    // DELETE contact — tenant_admin / super_admin only (global standard: no operational role should hard-delete)
    fastify.delete('/:id', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const deleted = await db.withTenant(req.tenant.id, async (client) => {
          // Nullify FK references before deleting
          await client.query('UPDATE deals SET contact_id = NULL WHERE contact_id = $1', [id]);
          await client.query('UPDATE activities SET contact_id = NULL WHERE contact_id = $1', [id]);
          await client.query('UPDATE voice_calls SET contact_id = NULL WHERE contact_id = $1', [id]);
          const result = await client.query('DELETE FROM contacts WHERE id = $1', [id]);
          return result.rowCount ?? 0;
        });
        if (deleted === 0) {
          return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Contact not found' } });
        }
      } catch (err: any) {
        return reply.code(409).send({ success: false, error: { code: 'CONFLICT', message: 'Cannot delete contact — please remove linked records first' } });
      }
      await eventBus.publish(req.tenant.id, CRM_EVENTS.CONTACT_DELETED, { contactId: id });
      return reply.code(204).send();
    });

    // GET all tickets for a contact — no visibility scoping (Contact 360 context)
    fastify.get('/:id/tickets', { preHandler: requireScope('contacts:read') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const tickets = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT t.id, t.ticket_number, t.subject, t.status, t.priority, t.channel,
                  t.ticket_type as type, u.department, t.created_at, t.accepted_at, t.resolved_at,
                  t.assignee_id, u.name as assignee_name,
                  t.sla_due_at, t.resolved_at
           FROM tickets t
           LEFT JOIN users u ON t.assignee_id = u.id
           WHERE t.contact_id = $1
           ORDER BY t.created_at DESC
           LIMIT 50`,
          [id],
        );
        return result.rows;
      });
      return reply.send({ success: true, data: tickets });
    });

    // GET contact timeline (activities + calls)
    fastify.get('/:id/timeline', { preHandler: requireScope('contacts:read') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const timeline = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT 'activity'   AS type, id, type AS subtype, subject,                  created_at, owner_id,   metadata::text AS metadata
           FROM activities WHERE contact_id = $1
           UNION ALL
           SELECT 'voice_call' AS type, id, direction AS subtype, outcome AS subject,  started_at AS created_at, agent_id AS owner_id, transcript AS metadata
           FROM voice_calls WHERE contact_id = $1
           UNION ALL
           SELECT 'ticket'     AS type, id, status AS subtype, subject,                created_at, assigned_to AS owner_id, NULL
           FROM tickets WHERE contact_id = $1
           UNION ALL
           SELECT 'deal'       AS type, id, stage_name AS subtype, name AS subject,    created_at, owner_id,   NULL
           FROM deals WHERE contact_id = $1
           ORDER BY created_at DESC
           LIMIT 100`,
          [id],
        );
        return result.rows;
      });

      return reply.send({ success: true, data: timeline });
    });

    // GET contact CSAT summary — avg rating + recent responses across all tickets
    fastify.get('/:id/csat', { preHandler: requireScope('contacts:read') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const data = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT cs.rating, cs.comment, cs.responded_at, t.subject AS ticket_subject, t.ticket_number
           FROM csat_surveys cs
           JOIN tickets t ON t.id = cs.ticket_id
           WHERE t.contact_id = $1 AND cs.rating IS NOT NULL
           ORDER BY cs.responded_at DESC
           LIMIT 20`,
          [id],
        );
        const rows = result.rows;
        const avg = rows.length > 0 ? rows.reduce((s: number, r: any) => s + r.rating, 0) / rows.length : null;
        return { avg: avg ? Math.round(avg * 10) / 10 : null, count: rows.length, responses: rows };
      });
      return reply.send({ success: true, data });
    });

    // ── G-P4: GDPR Right-to-Erasure ────────────────────────────────────────
    // Anonymises all PII fields on the contact + linked ticket subjects/reporters.
    // Only tenant_admin can invoke. Logs an erasure certificate.
    fastify.post('/:id/erase', { preHandler: requireRole('tenant_admin','super_admin') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;
      const body     = z.object({ note: z.string().max(500).optional() }).parse(req.body ?? {});

      const contact = await db.withTenant(tenantId, async (client) => {
        const r = await client.query('SELECT id, first_name, last_name, email FROM contacts WHERE id=$1', [id]);
        return r.rows[0] ?? null;
      });
      if (!contact) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Contact not found' } });

      const contactRef = `${contact.first_name ?? ''} ${contact.last_name ?? ''} <${contact.email ?? 'unknown'}>`.trim();

      await db.withTenant(tenantId, async (client) => {
        // Anonymise contact PII fields
        await client.query(
          `UPDATE contacts SET
             first_name  = '[ERASED]',
             last_name   = NULL,
             email       = NULL,
             phone       = NULL,
             mobile      = NULL,
             nic_number  = NULL,
             company_id  = NULL,
             notes       = NULL,
             updated_at  = NOW()
           WHERE id = $1`, [id]);

        // Anonymise ticket reporter fields linked to this contact
        await client.query(
          `UPDATE tickets SET
             reporter_name  = '[ERASED]',
             reporter_email = NULL,
             reporter_phone = NULL,
             updated_at     = NOW()
           WHERE contact_id = $1`, [id]);
      });

      // Log erasure certificate (uses super-admin connection so it survives even if tenant data changes)
      await db.withSuperAdmin(async (c) => {
        await c.query(
          `INSERT INTO contact_erasures(tenant_id, contact_id, contact_ref, erased_by, fields_erased, note)
           VALUES($1,$2,$3,$4,$5,$6)`,
          [
            tenantId, id, contactRef, userId,
            JSON.stringify(['first_name','last_name','email','phone','mobile','nic_number','notes','reporter_name','reporter_email','reporter_phone']),
            body.note ?? null,
          ]
        );
      });

      return reply.send({ success: true, message: `Contact ${contactRef} has been anonymised. Erasure certificate logged.` });
    });

    // ── G-P4: List erasure certificates (tenant_admin audit trail) ─────────
    fastify.get('/erasures', { preHandler: requireRole('tenant_admin','super_admin') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const rows = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `SELECT ce.*, u.name as erased_by_name
           FROM contact_erasures ce
           LEFT JOIN users u ON ce.erased_by = u.id
           WHERE ce.tenant_id = $1
           ORDER BY ce.erased_at DESC LIMIT 100`, [tenantId]);
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });
  };
}

function buildListQuery(query: any, offset: number, scopeClause = ''): string {
  let idx = 1;
  const searchClause  = query.search  ? `AND (c.first_name || ' ' || COALESCE(c.last_name,'') || ' ' || COALESCE(c.email,'') || ' ' || COALESCE(c.phone,'') || ' ' || COALESCE(c.mobile,'') || ' ' || COALESCE(c.nic_number,'')) ILIKE $${idx++}` : '';
  const statusClause  = query.status  ? `AND c.status = $${idx++}` : '';
  const ownerClause   = query.ownerId ? `AND c.owner_id = $${idx++}` : '';
  const limitClause   = `LIMIT $${idx++} OFFSET $${idx}`;
  return `
    SELECT c.*, comp.name as company_name, u.name as owner_name
    FROM contacts c
    LEFT JOIN companies comp ON c.company_id = comp.id
    LEFT JOIN users u ON c.owner_id = u.id
    WHERE 1=1
    ${scopeClause}
    ${searchClause}
    ${statusClause}
    ${ownerClause}
    ORDER BY c.${query.sortBy} ${query.sortOrder}
    ${limitClause}
  `;
}

function buildCountQuery(query: any, scopeClause = ''): string {
  let idx = 1;
  const searchClause  = query.search  ? `AND (first_name || ' ' || COALESCE(last_name,'') || ' ' || COALESCE(email,'') || ' ' || COALESCE(phone,'') || ' ' || COALESCE(mobile,'') || ' ' || COALESCE(nic_number,'')) ILIKE $${idx++}` : '';
  const statusClause  = query.status  ? `AND status = $${idx++}` : '';
  const ownerClause   = query.ownerId ? `AND owner_id = $${idx++}` : '';
  return `SELECT COUNT(*) FROM contacts WHERE 1=1 ${scopeClause} ${searchClause} ${statusClause} ${ownerClause}`;
}

function buildQueryParams(query: any, ...extra: unknown[]): unknown[] {
  const params: unknown[] = [];
  if (query.search)  params.push(`%${query.search}%`);
  if (query.status)  params.push(query.status);
  if (query.ownerId) params.push(query.ownerId);
  params.push(...extra);
  return params;
}
