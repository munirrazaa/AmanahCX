import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient, EventBus } from '@crm/core';
import { CRM_EVENTS } from '@crm/core';
import { requireScope } from '../middlewares/auth.middleware';
import { getVisibleUserIds, ownerScopeSql } from '../lib/visibility';

const CreateActivitySchema = z.object({
  type: z.enum(['call','voice_bot_call','email','meeting','task','note','whatsapp','sms','demo','proposal']),
  subject: z.string().min(1),
  body: z.string().optional(),
  status: z.enum(['pending','completed','cancelled']).default('pending'),
  priority: z.enum(['low','normal','high','urgent']).default('normal'),
  contactId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  scheduledAt: z.string().datetime().optional(),
  dueAt: z.string().datetime().optional(),
  duration: z.number().optional(),
  outcome: z.string().optional(),
  ownerId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export function activityRoutes(db: DatabaseClient, eventBus: EventBus) {
  return async function (fastify: FastifyInstance) {

    // List activities with filters
    fastify.get('/', { preHandler: requireScope('activities:read') }, async (req, reply) => {
      const { type, status, contactId, dealId, ownerId, dueFrom, dueTo, page = 1, pageSize = 25 } = req.query as any;
      const offset = (Number(page) - 1) * Number(pageSize);

      // Hard visibility filter — only activities owned by the user or their reportees.
      const scopeIds = await db.withTenant(req.tenant.id, (client) =>
        getVisibleUserIds(client, req.user.sub, req.user.role),
      );

      const activities = await db.withTenant(req.tenant.id, async (client) => {
        const aParams: unknown[] = [req.tenant.id];
        let aWhere = 'WHERE a.tenant_id = $1';
        aWhere += ` ${ownerScopeSql('a.owner_id', scopeIds)}`;
        if (type)      { aParams.push(type);      aWhere += ` AND a.type = $${aParams.length}`; }
        if (status)    { aParams.push(status);    aWhere += ` AND a.status = $${aParams.length}`; }
        if (contactId) { aParams.push(contactId); aWhere += ` AND a.contact_id = $${aParams.length}`; }
        if (dealId)    { aParams.push(dealId);    aWhere += ` AND a.deal_id = $${aParams.length}`; }
        if (ownerId)   { aParams.push(ownerId);   aWhere += ` AND a.owner_id = $${aParams.length}`; }
        if (dueFrom)   { aParams.push(dueFrom);   aWhere += ` AND a.due_at >= $${aParams.length}`; }
        if (dueTo)     { aParams.push(dueTo);     aWhere += ` AND a.due_at <= $${aParams.length}`; }
        aParams.push(Number(pageSize), offset);
        const result = await client.query(
          `SELECT a.*,
             c.first_name || ' ' || COALESCE(c.last_name,'') as contact_name,
             u.name as owner_name,
             d.name as deal_name
           FROM activities a
           LEFT JOIN contacts c ON a.contact_id = c.id
           LEFT JOIN users u ON a.owner_id = u.id
           LEFT JOIN deals d ON a.deal_id = d.id
           ${aWhere}
           ORDER BY COALESCE(a.due_at, a.created_at) ASC
           LIMIT $${aParams.length - 1} OFFSET $${aParams.length}`,
          aParams,
        );
        return result.rows;
      });

      return reply.send({ success: true, data: activities });
    });

    // Overdue tasks — key metric for sales managers
    fastify.get('/overdue', { preHandler: requireScope('activities:read') }, async (req, reply) => {
      const scopeIds = await db.withTenant(req.tenant.id, (client) =>
        getVisibleUserIds(client, req.user.sub, req.user.role),
      );
      const activities = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT a.*, c.first_name || ' ' || COALESCE(c.last_name,'') as contact_name, u.name as owner_name
           FROM activities a
           LEFT JOIN contacts c ON a.contact_id = c.id
           LEFT JOIN users u ON a.owner_id = u.id
           WHERE a.tenant_id = $1 AND a.status = 'pending' AND a.due_at < NOW()
           ${ownerScopeSql('a.owner_id', scopeIds)}
           ORDER BY a.due_at ASC
           LIMIT 100`,
          [req.tenant.id],
        );
        return result.rows;
      });
      return reply.send({ success: true, data: activities });
    });

    // Today's schedule
    fastify.get('/today', { preHandler: requireScope('activities:read') }, async (req, reply) => {
      // Hard visibility filter via the reporting tree (replaces the old "managers
      // see everyone" rule — a manager now sees only their own sub-tree).
      const scopeIds = await db.withTenant(req.tenant.id, (client) =>
        getVisibleUserIds(client, req.user.sub, req.user.role),
      );
      const activities = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT a.*, c.first_name || ' ' || COALESCE(c.last_name,'') as contact_name, u.name as owner_name
           FROM activities a
           LEFT JOIN contacts c ON a.contact_id = c.id
           LEFT JOIN users u ON a.owner_id = u.id
           WHERE a.tenant_id = $1 AND a.status = 'pending'
             AND (a.due_at::date = CURRENT_DATE OR a.scheduled_at::date = CURRENT_DATE)
             ${ownerScopeSql('a.owner_id', scopeIds)}
           ORDER BY COALESCE(a.scheduled_at, a.due_at) ASC`,
          [req.tenant.id],
        );
        return result.rows;
      });
      return reply.send({ success: true, data: activities });
    });

    // Create activity
    fastify.post('/', { preHandler: requireScope('activities:write') }, async (req, reply) => {
      const body = CreateActivitySchema.parse(req.body);
      const ownerId = body.ownerId ?? req.user.sub;

      const [activity] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `INSERT INTO activities
             (tenant_id, type, subject, body, status, priority, contact_id, company_id,
              deal_id, owner_id, scheduled_at, due_at, duration, outcome, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
           RETURNING *`,
          [
            req.tenant.id, body.type, body.subject, body.body,
            body.status, body.priority, body.contactId, body.companyId,
            body.dealId, ownerId, body.scheduledAt, body.dueAt,
            body.duration, body.outcome, JSON.stringify(body.metadata ?? {}),
          ],
        );
        return result.rows;
      });

      await eventBus.publish(req.tenant.id, CRM_EVENTS.ACTIVITY_CREATED, { activity });
      return reply.code(201).send({ success: true, data: activity });
    });

    // PARSE spoken/dictated task description → structured task fields (mobile voice capture)
    // POST /api/v1/activities/parse-task-text
    // Body: { text: string, localTime?: string } — e.g. "remind me to call Ahmed tomorrow at 3pm about the bulk order"
    // Returns extracted fields (plus a matched contact when the name is unambiguous)
    // for the user to verify BEFORE creating the activity.
    fastify.post('/parse-task-text', {
      preHandler: requireScope('activities:write'),
    }, async (req, reply) => {
      const ParseSchema = z.object({
        text: z.string().min(3).max(4000),
        localTime: z.string().optional(),
      });
      const body = ParseSchema.parse(req.body);

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return reply.code(503).send({
          success: false,
          error: { code: 'PARSER_NOT_CONFIGURED', message: 'Voice task capture is not configured on this server (missing ANTHROPIC_API_KEY).' },
        });
      }

      const now = body.localTime ?? new Date().toISOString();
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: `A field sales officer dictated a task or reminder. The dictation may be in English, Urdu, Punjabi, or a mix. The current local date-time is ${now}. Extract the task and reply with ONLY a JSON object (no markdown) with these keys, using null for anything not mentioned: type (one of "call","email","meeting","task","demo","proposal" — default "task"), subject (short imperative phrase in English, e.g. "Call Ahmed about bulk order"), body (any extra context as a short English sentence), dueAt (ISO 8601 date-time resolved from relative phrases like "tomorrow 3pm" — or their Urdu/Punjabi equivalents like "kal 3 baje" — using the current local time; null if no time mentioned), priority (one of "low","normal","high","urgent" — default "normal", "urgent"/"asap"/"zaroori" implies urgent), contactName (person the task is about, if named, transliterated to English/Latin script e.g. احمد خان → Ahmed Khan). Write ALL values in English/Latin script. If the text contains no task at all, reply with {"error": "reason"}.\n\nDictated task: ${JSON.stringify(body.text)}`,
          }],
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        req.log.error({ status: res.status, detail }, 'voice task parse: Anthropic API error');
        return reply.code(502).send({
          success: false,
          error: { code: 'PARSE_FAILED', message: 'Could not understand the task. Please try again.' },
        });
      }

      const ai = await res.json() as { content: Array<{ type: string; text?: string }> };
      const text = ai.content?.find((c) => c.type === 'text')?.text ?? '';
      let extracted: Record<string, string | null>;
      try {
        extracted = JSON.parse(text.replace(/^```(json)?|```$/g, '').trim());
      } catch {
        return reply.code(422).send({
          success: false,
          error: { code: 'PARSE_UNREADABLE', message: 'Could not understand the task. Please try rephrasing.' },
        });
      }
      if (extracted.error) {
        return reply.code(422).send({
          success: false,
          error: { code: 'PARSE_UNREADABLE', message: String(extracted.error) },
        });
      }

      // Best-effort contact match by name — only attach when exactly one contact matches.
      let contactId: string | null = null;
      let contactMatch: string | null = null;
      if (extracted.contactName) {
        const rows = await db.withTenant(req.tenant.id, async (client) => {
          const result = await client.query(
            `SELECT id, first_name, last_name FROM contacts
             WHERE tenant_id = $1 AND (first_name || ' ' || COALESCE(last_name,'')) ILIKE $2
             LIMIT 2`,
            [req.tenant.id, `%${extracted.contactName}%`],
          );
          return result.rows;
        });
        if (rows.length === 1) {
          contactId = rows[0].id;
          contactMatch = `${rows[0].first_name} ${rows[0].last_name ?? ''}`.trim();
        }
      }

      return reply.send({ success: true, data: { ...extracted, contactId, contactMatch } });
    });

    // MY TASKS — everything assigned to the logged-in user (mobile field view)
    // GET /api/v1/activities/mine?status=pending
    fastify.get('/mine', { preHandler: requireScope('activities:read') }, async (req, reply) => {
      const { status } = req.query as { status?: string };
      const rows = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT a.*,
             c.first_name || ' ' || COALESCE(c.last_name,'') as contact_name,
             c.phone as contact_phone, c.mobile as contact_mobile,
             c.custom_fields->>'address' as contact_address
           FROM activities a
           LEFT JOIN contacts c ON a.contact_id = c.id
           WHERE a.tenant_id = $1 AND a.owner_id = $2
           ${status ? `AND a.status = $3` : `AND a.status IN ('pending','completed')`}
           ORDER BY (a.status = 'pending') DESC, COALESCE(a.due_at, a.created_at) ASC
           LIMIT 100`,
          status ? [req.tenant.id, req.user.sub, status] : [req.tenant.id, req.user.sub],
        );
        return result.rows;
      });
      const pending   = rows.filter((r: any) => r.status === 'pending').length;
      const completed = rows.filter((r: any) => r.status === 'completed').length;
      return reply.send({ success: true, data: { tasks: rows, pending, completed } });
    });

    // FIELD CHECK-IN — records the officer's GPS position against a job
    // POST /api/v1/activities/:id/checkin  Body: { lat, lng }
    fastify.post('/:id/checkin', { preHandler: requireScope('activities:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const Loc = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
      const loc = Loc.parse(req.body);

      const [activity] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `UPDATE activities
           SET metadata = jsonb_set(
             COALESCE(metadata, '{}'::jsonb), '{checkins}',
             COALESCE(metadata->'checkins', '[]'::jsonb) || $1::jsonb, true)
           WHERE id = $2 RETURNING *`,
          [JSON.stringify({ lat: loc.lat, lng: loc.lng, at: new Date().toISOString(), by: req.user.sub }), id],
        );
        return result.rows;
      });
      if (!activity) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Activity not found' } });
      return reply.send({ success: true, data: activity });
    });

    // Mark complete — optionally with completion GPS position; emails the linked
    // customer a confirmation when they have an email address on file.
    fastify.post('/:id/complete', { preHandler: requireScope('activities:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const { outcome, lat, lng } = (req.body ?? {}) as { outcome?: string; lat?: number; lng?: number };

      const [activity] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `UPDATE activities
           SET status = 'completed', completed_at = NOW(), outcome = COALESCE($1, outcome),
               metadata = CASE WHEN $3::float8 IS NOT NULL THEN jsonb_set(
                 COALESCE(metadata, '{}'::jsonb), '{completedLocation}',
                 jsonb_build_object('lat', $3::float8, 'lng', $4::float8, 'at', to_jsonb(NOW())), true)
               ELSE metadata END
           WHERE id = $2 RETURNING *`,
          [outcome, id, lat ?? null, lng ?? null],
        );
        return result.rows;
      });

      if (!activity) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Activity not found' } });

      await eventBus.publish(req.tenant.id, CRM_EVENTS.ACTIVITY_COMPLETED, { activity });

      // Notify the customer (best-effort — completion never fails because email did)
      let customerNotified = false;
      if (activity.contact_id && process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL) {
        try {
          const [contact] = await db.withTenant(req.tenant.id, async (client) => {
            const r = await client.query('SELECT first_name, email FROM contacts WHERE id = $1', [activity.contact_id]);
            return r.rows;
          });
          if (contact?.email) {
            const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
              method: 'POST',
              headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                personalizations: [{ to: [{ email: contact.email }] }],
                from: { email: process.env.SENDGRID_FROM_EMAIL, name: process.env.SENDGRID_FROM_NAME ?? 'AmanahCX' },
                subject: `Your service visit is complete — ${activity.subject}`,
                content: [{
                  type: 'text/plain',
                  value: `Dear ${contact.first_name ?? 'Customer'},\n\nThis is to confirm that our team has completed: ${activity.subject}.\n${activity.outcome ? `\nOutcome: ${activity.outcome}\n` : ''}\nIf anything is not resolved to your satisfaction, simply reply to this email and we will follow up.\n\nThank you.`,
                }],
              }),
            });
            customerNotified = res.ok;
            if (!res.ok) req.log.warn({ status: res.status }, 'completion email failed');
          }
        } catch (err) {
          req.log.warn({ err }, 'completion email failed');
        }
      }

      return reply.send({ success: true, data: { ...activity, customerNotified } });
    });

    // Update activity
    fastify.patch('/:id', { preHandler: requireScope('activities:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = CreateActivitySchema.partial().parse(req.body);

      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      const map: Record<string, string> = {
        type: 'type', subject: 'subject', body: 'body', status: 'status',
        priority: 'priority', contactId: 'contact_id', companyId: 'company_id',
        dealId: 'deal_id', scheduledAt: 'scheduled_at', dueAt: 'due_at',
        duration: 'duration', outcome: 'outcome', ownerId: 'owner_id',
      };
      for (const [k, col] of Object.entries(map)) {
        if (k in body) { sets.push(`${col} = $${i++}`); vals.push((body as any)[k]); }
      }
      if (!sets.length) return reply.send({ success: true, data: null });
      vals.push(id);

      const [activity] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `UPDATE activities SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
          vals,
        );
        return result.rows;
      });

      if (!activity) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Activity not found' } });
      return reply.send({ success: true, data: activity });
    });

    // Delete
    fastify.delete('/:id', { preHandler: requireScope('activities:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withTenant(req.tenant.id, async (client) => {
        await client.query('DELETE FROM activities WHERE id = $1', [id]);
      });
      return reply.code(204).send();
    });
  };
}
