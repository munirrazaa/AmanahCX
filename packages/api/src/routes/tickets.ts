/**
 * Ticketing routes — /api/v1/tickets
 *
 * Endpoints:
 *   GET    /                       list tickets (filters: status, priority, queue, assignee, search)
 *   GET    /stats                  dashboard counts
 *   GET    /queues                 list queues
 *   POST   /queues                 create queue
 *   PATCH  /queues/:id             update queue
 *   DELETE /queues/:id             delete queue
 *   GET    /sla-policies           list SLA policies
 *   POST   /sla-policies           create SLA policy
 *   PATCH  /sla-policies/:id       update SLA policy
 *   DELETE /sla-policies/:id       delete SLA policy
 *   POST   /                       create ticket (manual)
 *   POST   /from-voice             create ticket from voice bot call
 *   GET    /:id                    get single ticket + comments
 *   PATCH  /:id                    update ticket fields
 *   POST   /:id/assign             assign to agent
 *   POST   /:id/accept             agent accepts ticket (starts SLA timer)
 *   POST   /:id/resolve            mark resolved
 *   POST   /:id/close              close ticket  ← also triggers CSAT survey email
 *   POST   /:id/rca                submit Root Cause Analysis
 *   GET    /:id/rca                get RCA for a ticket
 *   GET    /:id/audit-log          tamper-proof audit trail for a ticket
 *   POST   /:id/comments           add comment / internal note
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { DatabaseClient, EventBus } from '@crm/core';
import { CRM_EVENTS } from '@crm/core';
import { requireScope, requireRole, requireEntitlement } from '../middlewares/auth.middleware';
import { getVisibleUserIds } from '../lib/visibility';
import { EmailService } from '../services/email.service';
import { SmsService } from '@crm/core/sms.service';
import { getSector } from '@crm/shared';

// ── Schemas ────────────────────────────────────────────────────────────────
const CreateTicketSchema = z.object({
  subject:       z.string().min(1),
  description:   z.string().optional(),
  priority:      z.enum(['urgent','high','medium','low']).default('medium'),
  channel:       z.enum(['manual','email','phone','chat','api','voice_bot']).default('manual'),
  queueId:       z.string().uuid().optional(),
  slaPolicyId:   z.string().uuid().optional(),
  contactId:     z.string().uuid().optional(),
  companyId:     z.string().uuid().optional(),
  assigneeId:    z.string().uuid().optional(),
  reporterEmail: z.string().email().optional(),
  reporterName:  z.string().optional(),
  reporterPhone:     z.string().optional(),
  reporterWhatsapp:  z.string().optional(),
  preferredChannel:  z.enum(['email','sms','whatsapp']).default('email'),
  ticketType:        z.enum(['complaint','inquiry','sales']).default('complaint'),
  tags:              z.array(z.string()).optional(),
  customFields:  z.record(z.unknown()).optional(),
});

const UpdateTicketSchema = z.object({
  subject:        z.string().min(1).optional(),
  description:    z.string().optional(),
  priority:       z.enum(['urgent','high','medium','low']).optional(),
  status:         z.enum(['open','assigned','accepted','in_progress','pending','resolved','closed','cancelled','cancel_requested']).optional(),
  queueId:        z.string().uuid().nullable().optional(),
  slaPolicyId:    z.string().uuid().nullable().optional(),
  contactId:      z.string().uuid().nullable().optional(),
  companyId:      z.string().uuid().nullable().optional(),
  assigneeId:     z.string().uuid().nullable().optional(),
  tags:           z.array(z.string()).optional(),
  resolutionNote: z.string().optional(),
  customFields:   z.record(z.unknown()).optional(),
  priorityChangeReason: z.string().min(1).optional(),
  assigneeChangeReason: z.string().min(1).optional(),
});

const ListQuerySchema = z.object({
  page:       z.coerce.number().min(1).default(1),
  pageSize:   z.coerce.number().min(1).max(100).default(25),
  status:     z.string().optional(),
  priority:   z.string().optional(),
  channel:    z.string().optional(),   // 'manual' | 'voice_bot' | etc.
  queueId:    z.string().optional(),
  assigneeId: z.string().optional(),
  mine:       z.coerce.boolean().optional(),
  overdue:    z.coerce.boolean().optional(),
  contactId:  z.string().uuid().optional(),
  search:     z.string().optional(),
  sortBy:     z.enum(['created_at','updated_at','priority','sla_due_at']).default('created_at'),
  sortOrder:  z.enum(['asc','desc']).default('desc'),
});

const CreateQueueSchema = z.object({
  name:        z.string().min(1),
  description: z.string().optional(),
  color:       z.string().optional(),
  isDefault:   z.boolean().optional(),
});

const CreateSlaSchema = z.object({
  name:                z.string().min(1),
  description:         z.string().optional(),
  priority:            z.enum(['urgent','high','medium','low']),
  firstResponseHours:  z.number().int().min(0),
  resolutionHours:     z.number().int().min(1),
  reminderPct:         z.number().int().min(1).max(99).default(80),
  l1EscalationPct:     z.number().int().min(1).default(100),
  l2EscalationPct:     z.number().int().min(1).default(150),
  businessHoursOnly:       z.boolean().default(false),
  businessHoursSchedule:   z.record(z.object({
    enabled: z.boolean(),
    start:   z.string().regex(/^\d{2}:\d{2}$/),
    end:     z.string().regex(/^\d{2}:\d{2}$/),
  })).optional(),
  pauseOnPending:      z.boolean().default(false),
  matchConditions:     z.object({
    channels:    z.array(z.string()).optional(),
    departments: z.array(z.string()).optional(),
    tags:        z.array(z.string()).optional(),
  }).optional(),
  isActive:            z.boolean().default(true),
  ticketType:          z.enum(['sales','support','complaints']).nullable().optional(),
  reminderSchedule:    z.array(z.object({
    id:           z.string(),
    pct:          z.number().min(1).max(500),
    level:        z.enum(['reminder','l1','l2']),
    label:        z.string(),
    notifyTarget: z.enum(['assignee','managers','admins','all']),
  })).optional(),
});

const AddCommentSchema = z.object({
  body:        z.string().min(1),              // no max — unlimited remarks
  isInternal:  z.boolean().default(false),
  commentType: z.enum(['reply','remark','note']).default('reply'),
  replyToId:   z.string().uuid().optional(),   // WhatsApp-style quoted reply
});

const RcaSchema = z.object({
  rootCause:          z.string().min(1),
  correctiveAction:   z.string().min(1),
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Generate next ticket number: TKT-00042 */
async function nextTicketNumber(db: DatabaseClient, tenantId: string): Promise<string> {
  const [row] = await db.withSuperAdmin(async (client) => {
    const r = await client.query(
      `INSERT INTO ticket_counters (tenant_id, next_val)
       VALUES ($1, 2)
       ON CONFLICT (tenant_id) DO UPDATE SET next_val = ticket_counters.next_val + 1
       RETURNING next_val`,
      [tenantId],
    );
    return r.rows;
  });
  return `TKT-${String(row.next_val - 1).padStart(5, '0')}`;
}

/** Lookup SLA policy for a given priority (fallback to medium) */
async function findSlaPolicy(
  db: DatabaseClient,
  tenantId: string,
  slaPolicyId: string | undefined,
  priority: string,
  context?: { channel?: string; department?: string; tags?: string[] },
): Promise<{ id: string; resolution_hours: number } | null> {
  const rows = await db.withTenant(tenantId, async (client) => {
    if (slaPolicyId) {
      const r = await client.query('SELECT id, resolution_hours FROM sla_policies WHERE id = $1', [slaPolicyId]);
      return r.rows;
    }
    // Fetch all active policies matching priority, ordered by specificity (most conditions first)
    const r = await client.query(
      `SELECT id, resolution_hours, match_conditions FROM sla_policies
       WHERE priority = $1 AND is_active = true AND COALESCE(policy_status,'published') = 'published'
       ORDER BY (
         (CASE WHEN match_conditions->>'channels'    IS NOT NULL AND jsonb_array_length(match_conditions->'channels')    > 0 THEN 1 ELSE 0 END) +
         (CASE WHEN match_conditions->>'departments' IS NOT NULL AND jsonb_array_length(match_conditions->'departments') > 0 THEN 1 ELSE 0 END) +
         (CASE WHEN match_conditions->>'tags'        IS NOT NULL AND jsonb_array_length(match_conditions->'tags')        > 0 THEN 1 ELSE 0 END)
       ) DESC, created_at ASC`,
      [priority],
    );
    if (!r.rows.length) return [];
    if (!context) return [r.rows[0]];
    // Find first policy whose conditions all match the ticket context
    for (const policy of r.rows) {
      const cond = policy.match_conditions ?? {};
      const channels    = cond.channels    as string[] | undefined;
      const departments = cond.departments as string[] | undefined;
      const tags        = cond.tags        as string[] | undefined;
      if (channels?.length    && context.channel    && !channels.includes(context.channel))    continue;
      if (departments?.length && context.department && !departments.includes(context.department)) continue;
      if (tags?.length        && context.tags       && !tags.some(t => context.tags!.includes(t))) continue;
      return [policy];
    }
    return [r.rows[r.rows.length - 1]]; // fallback: last (least specific) policy
  });
  return rows[0] ?? null;
}

/** Send in-app notification to a list of users */
async function notify(
  db: DatabaseClient,
  tenantId: string,
  userIds: string[],
  type: string,
  title: string,
  body: string,
  entityId: string,
) {
  if (!userIds.length) return;
  await db.withSuperAdmin(async (client) => {
    for (const uid of userIds) {
      await client.query(
        `INSERT INTO notifications (tenant_id, user_id, type, title, body, entity_type, entity_id)
         VALUES ($1,$2,$3,$4,$5,'ticket',$6)`,
        [tenantId, uid, type, title, body, entityId],
      );
    }
  });
}

// ── Immutable audit log writer ─────────────────────────────────────────────
async function auditLog(
  db: DatabaseClient,
  opts: {
    tenantId:  string;
    ticketId:  string;
    actorId?:  string | null;
    actorName?:string | null;
    action:    string;
    oldValue?: Record<string, unknown> | null;
    newValue?: Record<string, unknown> | null;
    meta?:     Record<string, unknown>;
  },
): Promise<void> {
  await db.withSuperAdmin(async (c) => {
    await c.query(
      `INSERT INTO ticket_audit_log
         (tenant_id, ticket_id, actor_id, actor_name, action, old_value, new_value, meta)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)`,
      [
        opts.tenantId,
        opts.ticketId,
        opts.actorId   ?? null,
        opts.actorName ?? null,
        opts.action,
        opts.oldValue  ? JSON.stringify(opts.oldValue)  : null,
        opts.newValue  ? JSON.stringify(opts.newValue)  : null,
        JSON.stringify(opts.meta ?? {}),
      ],
    );
  });
}

// ── SLA deadline calculator (business hours + holidays) ──────────────────────
/**
 * Walks forward in time from `start`, counting only minutes that fall within
 * business hours on non-holiday days, until `durationHours` of working time
 * have been consumed.  Returns the wall-clock moment when the deadline is hit.
 *
 * If businessHoursOnly is false (or schedule is empty), falls back to simple
 * clock arithmetic — no change from previous behaviour.
 */
function computeSlaDeadline(
  start:            Date,
  durationHours:    number,
  businessHoursOnly: boolean,
  schedule:         Record<string, { enabled: boolean; start: string; end: string }>,
  holidayDates:     Set<string>,   // 'YYYY-MM-DD' strings in UTC
): Date {
  if (!businessHoursOnly || Object.keys(schedule).length === 0) {
    return new Date(start.getTime() + durationHours * 3_600_000);
  }

  let remaining = durationHours * 60; // working minutes left to consume
  const cursor  = new Date(start);

  // Map day-name keys to 0-based JS getDay() (0=Sun … 6=Sat)
  const DAY_MAP: Record<string, number> = {
    sunday:0, monday:1, tuesday:2, wednesday:3,
    thursday:4, friday:5, saturday:6,
  };

  // Build a lookup: dayIndex → {enabled, startMin, endMin} (minutes from midnight)
  const dayConfig: Record<number, { enabled: boolean; startMin: number; endMin: number }> = {};
  for (const [key, val] of Object.entries(schedule)) {
    const dayIdx = DAY_MAP[key.toLowerCase()];
    if (dayIdx === undefined) continue;
    const toMin = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return (h ?? 0) * 60 + (m ?? 0);
    };
    dayConfig[dayIdx] = {
      enabled:  val.enabled,
      startMin: toMin(val.start ?? '09:00'),
      endMin:   toMin(val.end   ?? '18:00'),
    };
  }

  const MAX_DAYS = 365; // safety cap — never loop more than a year
  let days = 0;

  while (remaining > 0 && days < MAX_DAYS) {
    const dayStr = cursor.toISOString().slice(0, 10); // 'YYYY-MM-DD'
    const dow    = cursor.getUTCDay();
    const cfg    = dayConfig[dow];

    if (!cfg || !cfg.enabled || holidayDates.has(dayStr)) {
      // Non-working day — skip to midnight of next day
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(0, 0, 0, 0);
      days++;
      continue;
    }

    // Current time in minutes from midnight (UTC)
    const nowMin  = cursor.getUTCHours() * 60 + cursor.getUTCMinutes();
    const workEnd = cfg.endMin;

    if (nowMin >= workEnd) {
      // Past business hours today — move to start of next day
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(0, 0, 0, 0);
      days++;
      continue;
    }

    // Clamp cursor to business hours start if before opening time
    const effectiveStart = Math.max(nowMin, cfg.startMin);
    if (effectiveStart > nowMin) {
      cursor.setUTCHours(Math.floor(effectiveStart / 60), effectiveStart % 60, 0, 0);
    }

    // How many working minutes remain today?
    const availableToday = workEnd - effectiveStart;

    if (remaining <= availableToday) {
      // Deadline falls within today's working hours
      const finalMin = effectiveStart + remaining;
      cursor.setUTCHours(Math.floor(finalMin / 60), finalMin % 60, 0, 0);
      remaining = 0;
    } else {
      // Use up all of today and carry forward
      remaining -= availableToday;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(0, 0, 0, 0);
      days++;
    }
  }

  return cursor;
}

/** Fetch tenant holidays and compute both SLA deadlines for a ticket acceptance */
async function buildSlaDeadlines(
  db:       DatabaseClient,
  tenantId: string,
  start:    Date,
  policy:   { first_response_hours: number; resolution_hours: number;
               business_hours_only: boolean; business_hours_schedule: any },
): Promise<{ firstResponseDue: Date; resolutionDue: Date }> {
  // Fetch holidays for this tenant
  const holidays = await db.withSuperAdmin(async (c) => {
    const now = new Date();
    const r = await c.query(
      `SELECT date::text FROM sla_holidays
       WHERE tenant_id = $1
         AND (
           -- exact-year match
           date >= $2::date AND date <= ($2::date + INTERVAL '1 year')
           OR
           -- recurring: same month/day in current or next year
           (recurring = true AND
            EXTRACT(MONTH FROM date) = ANY(ARRAY[
              EXTRACT(MONTH FROM $2::date)::int,
              EXTRACT(MONTH FROM ($2::date + INTERVAL '1 year'))::int
            ]))
         )`,
      [tenantId, now.toISOString()],
    );
    return r.rows;
  });

  const holidaySet = new Set<string>(holidays.map((h: any) => {
    // For recurring holidays, substitute the current/next year
    const [, mm, dd] = (h.date as string).split('-');
    const thisYear  = new Date().getUTCFullYear();
    const candidate = `${thisYear}-${mm}-${dd}`;
    return new Date(candidate) >= start ? candidate : `${thisYear + 1}-${mm}-${dd}`;
  }));

  const schedule = (policy.business_hours_schedule as Record<string, any>) ?? {};

  return {
    firstResponseDue: computeSlaDeadline(
      start, policy.first_response_hours, policy.business_hours_only, schedule, holidaySet,
    ),
    resolutionDue: computeSlaDeadline(
      start, policy.resolution_hours, policy.business_hours_only, schedule, holidaySet,
    ),
  };
}

/** Generate a CSAT survey token, store it, and email the reporter */
async function sendCsatSurvey(
  db:        DatabaseClient,
  emailSvc:  InstanceType<typeof EmailService>,
  eventBus:  EventBus,
  ticket:    any,
  appUrl:    string,
  csatExpiryDays: number = 7,   // Gap 4: configurable expiry
): Promise<void> {
  if (!ticket.reporter_email) return;

  const token = randomBytes(24).toString('hex'); // 48-char URL-safe token
  const surveyUrl = `${appUrl}/csat/${token}`;
  const expiryLabel = csatExpiryDays === 1 ? '1 day' : `${csatExpiryDays} days`;

  await db.withSuperAdmin(async (c) => {
    await c.query(
      `INSERT INTO csat_surveys
         (tenant_id, ticket_id, token, reporter_email, reporter_name, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' days')::INTERVAL)
       ON CONFLICT (ticket_id) DO NOTHING`,
      [ticket.tenant_id, ticket.id, token, ticket.reporter_email, ticket.reporter_name ?? null, csatExpiryDays],
    );

    // Audit log
    await c.query(
      `INSERT INTO ticket_audit_log
         (tenant_id, ticket_id, actor_id, action, new_value, meta)
       VALUES ($1, $2, NULL, 'csat_sent', $3::jsonb, '{}'::jsonb)`,
      [ticket.tenant_id, ticket.id, JSON.stringify({ surveyToken: token, sentTo: ticket.reporter_email })],
    );
  });

  emailSvc.send(ticket.tenant_id, {
    to:      ticket.reporter_email,
    toName:  ticket.reporter_name ?? undefined,
    subject: `How did we do? — Ticket ${ticket.ticket_number}`,
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <p>Dear ${ticket.reporter_name ?? 'Customer'},</p>
      <p>Your support ticket <strong>${ticket.ticket_number}</strong> — "<em>${ticket.subject}</em>" — has been resolved.</p>
      <p>We'd love to hear how we did. Please take a moment to rate your experience:</p>
      <div style="text-align:center;margin:24px 0;">
        ${[1,2,3,4,5].map(n => `<a href="${surveyUrl}?rating=${n}" style="display:inline-block;margin:0 4px;width:44px;height:44px;line-height:44px;border-radius:50%;background:#f1f5f9;color:#1e293b;font-size:20px;text-decoration:none;font-weight:bold;">${['😞','😕','😐','😊','🤩'][n-1]}</a>`).join('')}
      </div>
      <p style="text-align:center;margin-bottom:24px;">
        <a href="${surveyUrl}" style="background:#6366f1;color:#fff;padding:10px 28px;border-radius:8px;text-decoration:none;font-weight:600;">Rate Your Experience</a>
      </p>
      <p style="color:#94a3b8;font-size:12px;">This survey link expires in ${expiryLabel}.</p>
    </div>`,
    bodyText: `Hi ${ticket.reporter_name ?? 'Customer'},\n\nTicket ${ticket.ticket_number} has been resolved. Please rate your experience:\n${surveyUrl}\n\n(Link expires in 7 days)`,
    ticketId: ticket.id,
  }).catch(() => { /* non-fatal */ });

  await eventBus.publish(ticket.tenant_id, CRM_EVENTS.CSAT_SENT, {
    ticketId: ticket.id,
    surveyToken: token,
    sentTo: ticket.reporter_email,
  });
}

// ── Route factory ──────────────────────────────────────────────────────────

// ── Smart Push Routing Engine ────────────────────────────────────────────
/**
 * Routes a ticket to the best available agent using capacity-aware random selection.
 *
 * Algorithm:
 * 1. Get all active agents who are members of the ticket's queue
 *    (falls back to all active agents in tenant if queue has no members)
 * 2. Filter out agents who currently have >= per_agent_ticket_limit pending tickets
 *    (limit comes from tenant routing settings; default = no limit)
 * 3. From the remaining capacity-available agents, pick one at random
 *    (agents with 0 active tickets get 2× weight for fairness)
 * 4. If NO agent has capacity, route to the agent with fewest active tickets (overflow)
 */
async function assignByPushRouting(
  db: DatabaseClient,
  ticket: any,
  tenantId: string,
  eventBus: EventBus,
): Promise<void> {
  // Read tenant routing config (per_agent_ticket_limit)
  const tenantSettings = await db.withSuperAdmin(async (client) => {
    const r = await client.query(`SELECT settings FROM tenants WHERE id = $1`, [tenantId]);
    return r.rows[0]?.settings ?? {};
  });
  const perAgentLimit: number = tenantSettings?.routing?.per_agent_ticket_limit ?? 0; // 0 = no limit

  // Get queue members — agents explicitly assigned to this queue
  const queueId = ticket.queue_id;
  let candidateIds: string[] = [];

  if (queueId) {
    const qm = await db.withSuperAdmin(async (client) => {
      const r = await client.query(
        `SELECT qm.user_id
         FROM queue_members qm
         JOIN users u ON u.id = qm.user_id
         WHERE qm.queue_id = $1
           AND u.is_active = true
           AND u.agent_status NOT IN ('offline','away')
           AND u.role IN ('agent','manager')
           AND u.id != $2`,
        [queueId, ticket.assignee_id ?? '00000000-0000-0000-0000-000000000000'],
      );
      return r.rows.map((u: any) => u.user_id as string);
    });
    candidateIds = qm;
  }

  // Fallback: if queue has no members, use all active agents in tenant
  if (candidateIds.length === 0) {
    const all = await db.withSuperAdmin(async (client) => {
      const r = await client.query(
        `SELECT id FROM users
         WHERE tenant_id = $1
           AND is_active = true
           AND agent_status NOT IN ('offline','away')
           AND role IN ('agent','manager')
           AND id != $2`,
        [tenantId, ticket.assignee_id ?? '00000000-0000-0000-0000-000000000000'],
      );
      return r.rows.map((u: any) => u.id as string);
    });
    candidateIds = all;
  }

  if (candidateIds.length === 0) return; // no agents available at all

  // Get active ticket count per candidate
  const loadMap = await db.withSuperAdmin(async (client) => {
    const r = await client.query(
      `SELECT assignee_id, COUNT(*) AS active_count
       FROM tickets
       WHERE assignee_id = ANY($1::uuid[])
         AND tenant_id = $2
         AND status NOT IN ('resolved','closed')
       GROUP BY assignee_id`,
      [candidateIds, tenantId],
    );
    const map: Record<string, number> = {};
    candidateIds.forEach(id => { map[id] = 0; }); // default 0
    r.rows.forEach((row: any) => { map[row.assignee_id] = parseInt(row.active_count, 10); });
    return map;
  });

  // Filter: only agents under the per-agent limit (if limit is set)
  let available = candidateIds.filter(id =>
    perAgentLimit === 0 || (loadMap[id] ?? 0) < perAgentLimit,
  );

  let chosen: string;
  if (available.length > 0) {
    // Weighted random: agents with 0 tickets get 2× chance
    const weighted: string[] = [];
    for (const id of available) {
      weighted.push(id);
      if ((loadMap[id] ?? 0) === 0) weighted.push(id); // double weight for free agents
    }
    chosen = weighted[Math.floor(Math.random() * weighted.length)];
  } else {
    // All agents at capacity — overflow to agent with fewest tickets
    chosen = candidateIds.reduce((best, id) =>
      (loadMap[id] ?? 0) < (loadMap[best] ?? 0) ? id : best,
    );
  }

  await db.withSuperAdmin(async (client) => {
    await client.query(
      `UPDATE tickets SET assignee_id = $1, status = 'assigned', updated_at = NOW() WHERE id = $2`,
      [chosen, ticket.id],
    );
  });

  const atCapacity = perAgentLimit > 0 && available.length === 0;
  const note = atCapacity
    ? `Auto-routed (overflow — all agents at capacity limit of ${perAgentLimit})`
    : `Auto-routed (${available.length} agent${available.length === 1 ? '' : 's'} available)`;

  await notify(db, tenantId, [chosen], 'ticket_assigned',
    `New ticket auto-assigned: ${ticket.ticket_number}`,
    `"${ticket.subject}" has been automatically routed to you. ${note}`,
    ticket.id);

  await eventBus.publish(tenantId, CRM_EVENTS.TICKET_ASSIGNED, {
    ticketId: ticket.id, assigneeId: chosen, source: 'push_routing', note,
  });
}

// ── Sales ticket → Deal conversion ──────────────────────────────────────────
// A 'sales' enquiry follows a different lifecycle to a complaint: rather than
// just being resolved & closed, it should feed the sales pipeline so it can be
// forecast and worked as an opportunity. This creates (once) a deal in the
// default pipeline, linked back to the ticket, owned by the handling agent.
// Idempotent: if the ticket already has a linked deal, that deal is returned.
// Returns null only when no pipeline/stage exists to place the deal into.
async function convertSalesTicketToDeal(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> },
  tenantId: string,
  ticket: any,
  ownerId: string,
): Promise<{ deal: any; created: boolean } | null> {
  // Already linked → return the existing deal (no duplicate).
  if (ticket.deal_id) {
    const ex = await client.query(`SELECT * FROM deals WHERE id = $1`, [ticket.deal_id]);
    return ex.rows[0] ? { deal: ex.rows[0], created: false } : null;
  }

  // Place into the tenant's default pipeline, first stage.
  const pipe = await client.query(
    `SELECT id, stages FROM pipelines WHERE tenant_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1`,
    [tenantId],
  );
  const pipeline = pipe.rows[0];
  const firstStage = pipeline?.stages?.[0]?.id ?? null;
  if (!pipeline || !firstStage) return null; // no pipeline configured yet

  const ins = await client.query(
    `INSERT INTO deals
       (tenant_id, name, pipeline_id, stage_id, owner_id, contact_id, company_id, status, source, currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', 'ticket', 'USD')
     RETURNING *`,
    [
      tenantId,
      ticket.subject ?? 'Sales enquiry',
      pipeline.id,
      firstStage,
      ownerId,
      ticket.contact_id ?? null,
      ticket.company_id ?? null,
    ],
  );
  const deal = ins.rows[0];
  await client.query(`UPDATE tickets SET deal_id = $1, updated_at = NOW() WHERE id = $2`, [deal.id, ticket.id]);
  return { deal, created: true };
}

export function ticketRoutes(db: DatabaseClient, eventBus: EventBus) {
  const emailSvc = new EmailService(db);
  const smsSvc   = new SmsService(db);
  const APP_URL  = process.env.APP_URL ?? 'http://localhost:5173';

  return async function (fastify: FastifyInstance) {

    // Gate entire plugin — tenant must be entitled to ticketing.tickets or ticketing.sla.
    // Legacy tenants (no entitled_features recorded) are allowed through unchanged.
    fastify.addHook('preHandler', requireEntitlement('ticketing.tickets', 'ticketing.sla', 'ticketing.csat'));

    // ── Stats (dashboard) ─────────────────────────────────────────────────
    fastify.get('/stats', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;

      const [stats] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `SELECT
             COUNT(*)                                                            AS total,
             COUNT(*) FILTER (WHERE status = 'open')                            AS open,
             COUNT(*) FILTER (WHERE status = 'assigned')                        AS assigned,
             COUNT(*) FILTER (WHERE status IN ('accepted','in_progress'))        AS in_progress,
             COUNT(*) FILTER (WHERE status = 'pending')                         AS pending,
             COUNT(*) FILTER (WHERE status = 'resolved')                        AS resolved,
             COUNT(*) FILTER (WHERE status = 'cancel_requested')               AS cancel_requested,
             COUNT(*) FILTER (WHERE status = 'cancelled')                      AS cancelled,
             COUNT(*) FILTER (WHERE assignee_id = $1
                               AND status NOT IN ('resolved','closed','cancelled'))  AS mine,
             COUNT(*) FILTER (WHERE sla_due_at < NOW()
                               AND status NOT IN ('resolved','closed','cancelled'))  AS overdue,
             COUNT(*) FILTER (WHERE sla_due_at >= NOW()
                               AND accepted_at IS NOT NULL
                               AND status NOT IN ('resolved','closed','cancelled'))  AS within_tat,
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS created_today,
             COUNT(*) FILTER (WHERE status IN ('accepted','in_progress')
                               AND assignee_id IS NOT NULL)                     AS claimed
           FROM tickets`,
          [userId],
        );
        return r.rows;
      });

      return reply.send({ success: true, data: stats });
    });


    // ── Queue CRUD ────────────────────────────────────────────────────────
    fastify.get('/queues', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const queues = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `SELECT q.*, COUNT(t.id) AS ticket_count
           FROM ticket_queues q
           LEFT JOIN tickets t ON t.queue_id = q.id AND t.status NOT IN ('resolved','closed')
           GROUP BY q.id ORDER BY q.is_default DESC, q.name ASC`,
        );
        return r.rows;
      });
      return reply.send({ success: true, data: queues });
    });

    fastify.post('/queues', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const body = CreateQueueSchema.parse(req.body);
      const [queue] = await db.withTenant(req.tenant.id, async (client) => {
        if (body.isDefault) {
          await client.query('UPDATE ticket_queues SET is_default = false');
        }
        const r = await client.query(
          `INSERT INTO ticket_queues (tenant_id, name, description, color, is_default)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [req.tenant.id, body.name, body.description ?? null, body.color ?? '#6366f1', body.isDefault ?? false],
        );
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: queue });
    });

    fastify.patch('/queues/:id', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = CreateQueueSchema.partial().parse(req.body);
      const [queue] = await db.withTenant(req.tenant.id, async (client) => {
        if (body.isDefault) await client.query('UPDATE ticket_queues SET is_default = false');
        const r = await client.query(
          `UPDATE ticket_queues SET
             name = COALESCE($1, name),
             description = COALESCE($2, description),
             color = COALESCE($3, color),
             is_default = COALESCE($4, is_default),
             updated_at = NOW()
           WHERE id = $5 RETURNING *`,
          [body.name, body.description, body.color, body.isDefault, id],
        );
        return r.rows;
      });
      if (!queue) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Queue not found' } });
      return reply.send({ success: true, data: queue });
    });

    fastify.delete('/queues/:id', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withTenant(req.tenant.id, async (client) => {
        await client.query('UPDATE tickets SET queue_id = NULL WHERE queue_id = $1', [id]);
        await client.query('DELETE FROM ticket_queues WHERE id = $1', [id]);
      });
      return reply.code(204).send();
    });

    // ── Queue member management (Gap 2) ───────────────────────────────────
    // GET  /queues/:id/members  — list agents in queue
    fastify.get('/queues/:id/members', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const members = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `SELECT u.id, u.name, u.email, u.role, u.department, u.is_active,
                  qm.added_at,
                  COUNT(t.id) FILTER (WHERE t.status NOT IN ('resolved','closed')) AS active_tickets
           FROM queue_members qm
           JOIN users u ON u.id = qm.user_id
           LEFT JOIN tickets t ON t.assignee_id = u.id AND t.tenant_id = $2
           WHERE qm.queue_id = $1
           GROUP BY u.id, u.name, u.email, u.role, u.department, u.is_active, qm.added_at
           ORDER BY u.name`,
          [id, req.tenant.id],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: members });
    });

    // POST /queues/:id/members — add agent(s) to queue
    fastify.post('/queues/:id/members', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const { userIds } = z.object({ userIds: z.array(z.string().uuid()).min(1) }).parse(req.body);
      await db.withTenant(req.tenant.id, async (client) => {
        for (const uid of userIds) {
          await client.query(
            `INSERT INTO queue_members (queue_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [id, uid],
          );
        }
      });
      return reply.send({ success: true, message: `${userIds.length} agent(s) added to queue` });
    });

    // DELETE /queues/:id/members/:userId — remove agent from queue
    fastify.delete('/queues/:id/members/:userId', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id, userId } = req.params as { id: string; userId: string };
      await db.withTenant(req.tenant.id, async (client) => {
        await client.query('DELETE FROM queue_members WHERE queue_id = $1 AND user_id = $2', [id, userId]);
      });
      return reply.code(204).send();
    });

    // ── Tag management (Gap 5) ────────────────────────────────────────────
    // GET    /tags           — list all tenant tags
    // POST   /tags           — create tag
    // PATCH  /tags/:id       — rename / recolour tag
    // DELETE /tags/:id       — delete tag (also removes from all tickets)
    fastify.get('/tags', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const tags = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `SELECT tt.id, tt.name, tt.color, tt.description, tt.created_at,
                  (SELECT COUNT(*) FROM tickets WHERE tags @> ARRAY[tt.name] AND tenant_id = tt.tenant_id) AS usage_count
           FROM ticket_tags tt
           ORDER BY tt.name`,
        );
        return r.rows;
      });
      return reply.send({ success: true, data: tags });
    });

    fastify.post('/tags', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const body = z.object({
        name:        z.string().min(1).max(50),
        color:       z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6b7280'),
        description: z.string().max(200).optional(),
      }).parse(req.body);

      const [tag] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `INSERT INTO ticket_tags (tenant_id, name, color, description)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, name) DO NOTHING
           RETURNING *`,
          [req.tenant.id, body.name.toLowerCase().trim(), body.color, body.description ?? null],
        );
        return r.rows;
      });
      if (!tag) return reply.code(409).send({ success: false, error: { code: 'TAG_EXISTS', message: 'A tag with this name already exists' } });
      return reply.code(201).send({ success: true, data: tag });
    });

    fastify.patch('/tags/:id', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body   = z.object({
        name:        z.string().min(1).max(50).optional(),
        color:       z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        description: z.string().max(200).nullable().optional(),
      }).parse(req.body);

      const [tag] = await db.withTenant(req.tenant.id, async (client) => {
        // If renaming, also update all tickets that use the old tag name
        const [current] = (await client.query('SELECT * FROM ticket_tags WHERE id = $1', [id])).rows;
        if (!current) return [null];

        const newName = body.name ? body.name.toLowerCase().trim() : current.name;
        if (body.name && body.name !== current.name) {
          // Rename tag across all tickets
          await client.query(
            `UPDATE tickets
             SET tags = array_replace(tags, $1, $2)
             WHERE $1 = ANY(tags)`,
            [current.name, newName],
          );
        }
        const r = await client.query(
          `UPDATE ticket_tags SET
             name        = $2,
             color       = COALESCE($3, color),
             description = COALESCE($4, description)
           WHERE id = $1 RETURNING *`,
          [id, newName, body.color ?? null, body.description ?? null],
        );
        return r.rows;
      });
      if (!tag) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Tag not found' } });
      return reply.send({ success: true, data: tag });
    });

    fastify.delete('/tags/:id', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withTenant(req.tenant.id, async (client) => {
        const [tag] = (await client.query('SELECT * FROM ticket_tags WHERE id = $1', [id])).rows;
        if (tag) {
          // Remove this tag from all tickets first
          await client.query(
            `UPDATE tickets SET tags = array_remove(tags, $1) WHERE $1 = ANY(tags)`,
            [tag.name],
          );
          await client.query('DELETE FROM ticket_tags WHERE id = $1', [id]);
        }
      });
      return reply.code(204).send();
    });

    // ── SLA policy CRUD ───────────────────────────────────────────────────
    fastify.get('/sla-policies', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const role = req.user?.role;
      const governedDepts: string[] = (req.user as any)?.governed_departments ?? [];

      const policies = await db.withTenant(req.tenant.id, async (client) => {
        // policy_admin sees only policies matching their governed departments
        if (role === 'policy_admin' && governedDepts.length > 0) {
          const r = await client.query(
            `SELECT * FROM sla_policies
             WHERE (ticket_type = ANY($1) OR ticket_type IS NULL)
             ORDER BY priority DESC, name ASC`,
            [governedDepts],
          );
          return r.rows;
        }
        const r = await client.query('SELECT * FROM sla_policies ORDER BY priority DESC, name ASC');
        return r.rows;
      });
      return reply.send({ success: true, data: policies });
    });

    fastify.post('/sla-policies', { preHandler: requireRole('policy_admin','super_admin') }, async (req, reply) => {
      const body = CreateSlaSchema.parse(req.body);
      const governedDepts: string[] = (req.user as any)?.governed_departments ?? [];
      // Enforce scope: ticket_type must be within governed departments (or null if governing all)
      const ticketType = body.ticketType ?? null;
      if (ticketType && governedDepts.length > 0 && !governedDepts.includes(ticketType)) {
        return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Outside your governed departments' } });
      }
      const [policy] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
           `INSERT INTO sla_policies
              (tenant_id, name, description, priority, first_response_hours, resolution_hours,
               reminder_pct, l1_escalation_pct, l2_escalation_pct, business_hours_only,
               business_hours_schedule, pause_on_pending, match_conditions, is_active, reminder_schedule, ticket_type)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
           [req.tenant.id, body.name, body.description ?? null, body.priority,
            body.firstResponseHours, body.resolutionHours,
            body.reminderPct, body.l1EscalationPct, body.l2EscalationPct,
            body.businessHoursOnly, JSON.stringify(body.businessHoursSchedule ?? {}),
            body.pauseOnPending, JSON.stringify(body.matchConditions ?? {}),
            body.isActive, JSON.stringify(body.reminderSchedule ?? []), ticketType],
         );
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: policy });
    });

    fastify.patch('/sla-policies/:id', { preHandler: requireRole('policy_admin','super_admin') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const governedDepts: string[] = (req.user as any)?.governed_departments ?? [];
      // Verify policy is within governed departments before allowing edit
      if (governedDepts.length > 0) {
        const existing = await db.withTenant(req.tenant.id, async (c) => {
          const r = await c.query('SELECT ticket_type FROM sla_policies WHERE id = $1', [id]);
          return r.rows[0];
        });
        if (existing?.ticket_type && !governedDepts.includes(existing.ticket_type)) {
          return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Outside your governed departments' } });
        }
      }
      const body = CreateSlaSchema.partial().parse(req.body);
      const [policy] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
           `UPDATE sla_policies SET
             name                 = COALESCE($1,  name),
             description          = COALESCE($2,  description),
             priority             = COALESCE($3,  priority),
             first_response_hours = COALESCE($4,  first_response_hours),
             resolution_hours     = COALESCE($5,  resolution_hours),
             reminder_pct         = COALESCE($6,  reminder_pct),
             l1_escalation_pct    = COALESCE($7,  l1_escalation_pct),
             l2_escalation_pct    = COALESCE($8,  l2_escalation_pct),
             business_hours_only     = COALESCE($9,        business_hours_only),
             business_hours_schedule = COALESCE($10::jsonb, business_hours_schedule),
             pause_on_pending        = COALESCE($11,        pause_on_pending),
             match_conditions        = COALESCE($12::jsonb, match_conditions),
             is_active               = COALESCE($13,        is_active),
             reminder_schedule       = COALESCE($14::jsonb, reminder_schedule),
             ticket_type             = COALESCE($16,        ticket_type),
             updated_at              = NOW()
           WHERE id = $15 RETURNING *`,
          [body.name, body.description, body.priority, body.firstResponseHours,
           body.resolutionHours, body.reminderPct, body.l1EscalationPct,
           body.l2EscalationPct, body.businessHoursOnly,
           body.businessHoursSchedule !== undefined ? JSON.stringify(body.businessHoursSchedule) : null,
           body.pauseOnPending ?? null,
           body.matchConditions !== undefined ? JSON.stringify(body.matchConditions) : null,
           body.isActive,
           body.reminderSchedule !== undefined ? JSON.stringify(body.reminderSchedule) : null, id,
           body.ticketType ?? null],
        );
        return r.rows;
      });
      if (!policy) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'SLA policy not found' } });
      return reply.send({ success: true, data: policy });
    });

    fastify.delete('/sla-policies/:id', { preHandler: requireRole('policy_admin','super_admin') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withTenant(req.tenant.id, async (client) => {
        await client.query('UPDATE tickets SET sla_policy_id = NULL WHERE sla_policy_id = $1', [id]);
        await client.query('DELETE FROM sla_policies WHERE id = $1', [id]);
      });
      return reply.code(204).send();
    });

    // ── Holiday calendar CRUD ─────────────────────────────────────────────
    const HolidaySchema = z.object({
      name:      z.string().min(1),
      date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
      recurring: z.boolean().default(true),
    });

    fastify.get('/holidays', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const holidays = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query('SELECT id, tenant_id, name, date::text, recurring, created_at FROM sla_holidays ORDER BY date ASC');
        return r.rows;
      });
      return reply.send({ success: true, data: holidays });
    });

    fastify.post('/holidays', { preHandler: requireRole('policy_admin','super_admin') }, async (req, reply) => {
      const body = HolidaySchema.parse(req.body);
      const [holiday] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `INSERT INTO sla_holidays (tenant_id, name, date, recurring)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (tenant_id, date) DO UPDATE SET name = EXCLUDED.name, recurring = EXCLUDED.recurring
           RETURNING id, tenant_id, name, date::text, recurring, created_at`,
          [req.tenant.id, body.name, body.date, body.recurring],
        );
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: holiday });
    });

    fastify.patch('/holidays/:id', { preHandler: requireRole('policy_admin','super_admin') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = HolidaySchema.partial().parse(req.body);
      const [holiday] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `UPDATE sla_holidays SET
             name      = COALESCE($1, name),
             date      = COALESCE($2::date, date),
             recurring = COALESCE($3, recurring)
           WHERE id = $4 RETURNING id, tenant_id, name, date::text, recurring, created_at`,
          [body.name ?? null, body.date ?? null, body.recurring ?? null, id],
        );
        return r.rows;
      });
      if (!holiday) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Holiday not found' } });
      return reply.send({ success: true, data: holiday });
    });

    fastify.delete('/holidays/:id', { preHandler: requireRole('policy_admin','super_admin') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withTenant(req.tenant.id, async (client) => {
        await client.query('DELETE FROM sla_holidays WHERE id = $1', [id]);
      });
      return reply.code(204).send();
    });

    // ── Create ticket (manual) ────────────────────────────────────────────
    fastify.post('/', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const body       = CreateTicketSchema.parse(req.body);

      // Every ticket must be linked to a contact — enforced here and on the frontend.
      // Voice bot tickets always provide a contactId (auto-created from caller phone).
      if (!body.contactId && body.channel !== 'voice_bot') {
        return reply.code(400).send({
          success: false,
          error: { code: 'CONTACT_REQUIRED', message: 'A contact must be selected before creating a ticket.' },
        });
      }

      const tenantId   = req.tenant.id;
      const ticketNum  = await nextTicketNumber(db, tenantId);
      const sla        = await findSlaPolicy(db, tenantId, body.slaPolicyId, body.priority, {
        channel:    body.channel,
        department: (body as any).department,
        tags:       body.tags,
      });

      const [ticket] = await db.withTenant(tenantId, async (client) => {
        // Auto-assign to default queue if none given
        let queueId = body.queueId;
        if (!queueId) {
          const qr = await client.query('SELECT id FROM ticket_queues WHERE is_default = true LIMIT 1');
          queueId = qr.rows[0]?.id;
        }

        const status = body.assigneeId ? 'assigned' : 'open';
        const r = await client.query(
          `INSERT INTO tickets
             (tenant_id, ticket_number, subject, description, status, priority, channel,
              queue_id, sla_policy_id, contact_id, company_id, assignee_id,
              reporter_email, reporter_name, reporter_phone, reporter_whatsapp,
              preferred_channel, ticket_type, tags, custom_fields, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
           RETURNING *`,
          [tenantId, ticketNum, body.subject, body.description ?? null,
           status, body.priority, body.channel,
           queueId ?? null, sla?.id ?? null,
           body.contactId ?? null, body.companyId ?? null,
           body.assigneeId ?? null,
           body.reporterEmail ?? null, body.reporterName ?? null, body.reporterPhone ?? null,
            body.reporterWhatsapp ?? null, body.preferredChannel ?? 'email',
            body.ticketType ?? 'complaint',
            body.tags ?? [], JSON.stringify(body.customFields ?? {}), req.user.sub],
        );
        return r.rows;
      });

      // Notify assignee if set
      if (ticket.assignee_id) {
        await notify(db, tenantId, [ticket.assignee_id], 'ticket_assigned',
          `New ticket assigned: ${ticketNum}`,
          `"${body.subject}" has been assigned to you.`,
          ticket.id);
      }

      // ── Auto-apply milestone template based on ticket_type ──────────────
      const [milTmpl] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT steps FROM ticket_milestone_templates WHERE tenant_id = $1 AND ticket_type = $2`,
          [tenantId, body.ticketType ?? 'complaint'],
        );
        return r.rows;
      });
      if (milTmpl?.steps?.length > 0) {
        await db.withTenant(tenantId, async (client) => {
          await client.query(
            `UPDATE tickets SET milestones = $1::jsonb WHERE id = $2`,
            [JSON.stringify(milTmpl.steps.map((s: any, i: number) => ({ ...s, completed: false, order: i }))), ticket.id],
          );
        });
      }

      // ── Push routing: auto-assign if queue is configured for push ──────
      const [queueCfg] = await db.withTenant(tenantId, async (client) => {
        if (!ticket.queue_id) return [null];
        const r = await client.query(
          `SELECT routing_method FROM ticket_queues WHERE id = $1`,
          [ticket.queue_id],
        );
        return r.rows;
      });

      if (queueCfg?.routing_method === 'push_random' || queueCfg?.routing_method === 'push_criteria') {
        await assignByPushRouting(db, ticket, tenantId, eventBus);
      }

      await eventBus.publish(tenantId, CRM_EVENTS.TICKET_CREATED, { ticket });

      // Audit log — creation
      await auditLog(db, {
        tenantId, ticketId: ticket.id,
        actorId:   req.user.sub,
        action:    'created',
        newValue:  { status: ticket.status, priority: ticket.priority, channel: ticket.channel },
      });

      // G-F1: repeat-caller detection — if this contact has ≥3 tickets in last 30 days,
      // flag the ticket and notify managers so root cause can be addressed.
      if (ticket.contact_id) {
        const recCheck = await db.withSuperAdmin(async (c) => {
          const r = await c.query(
            `SELECT COUNT(*)::int AS cnt FROM tickets
             WHERE tenant_id = $1 AND contact_id = $2
               AND created_at > NOW() - INTERVAL '30 days'`,
            [tenantId, ticket.contact_id],
          );
          return r.rows[0]?.cnt ?? 0;
        });
        if (recCheck >= 3) {
          await db.withSuperAdmin(async (c) => {
            await c.query(
              `UPDATE tickets SET recurrence_flag = TRUE, recurrence_count = $1 WHERE id = $2`,
              [recCheck, ticket.id],
            );
          });
          // Notify all active managers in the tenant
          const managers = await db.withSuperAdmin(async (c) => {
            const r = await c.query(
              `SELECT id FROM users WHERE tenant_id = $1 AND role IN ('manager','tenant_admin') AND is_active = TRUE`,
              [tenantId],
            );
            return r.rows.map((u: any) => u.id as string);
          });
          if (managers.length > 0) {
            await notify(db, tenantId, managers, 'recurrence_flag',
              `Repeat caller flagged — ${ticket.ticket_number}`,
              `Contact has raised ${recCheck} tickets in the last 30 days. Root cause review recommended.`,
              ticket.id);
          }
        }
      }

      return reply.code(201).send({ success: true, data: ticket });
    });

    // ── Create ticket from voice bot ──────────────────────────────────────
    // Called automatically by the voice module after a call completes
    // with a support-triggering outcome. Also usable by external APIs.
    fastify.post('/from-voice', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const body = z.object({
        voiceCallId:   z.string().uuid(),
        subject:       z.string().min(1),
        description:   z.string().optional(),
        priority:      z.enum(['urgent','high','medium','low']).default('medium'),
        reporterName:  z.string().optional(),
        reporterPhone:    z.string().optional(),
        reporterWhatsapp: z.string().optional(),
        preferredChannel: z.enum(['email','sms','whatsapp']).default('email'),
        contactId:        z.string().uuid().optional(),
      }).parse(req.body);

      const tenantId  = req.tenant.id;
      const ticketNum = await nextTicketNumber(db, tenantId);
      const sla       = await findSlaPolicy(db, tenantId, undefined, body.priority);

      const [ticket] = await db.withTenant(tenantId, async (client) => {
        const qr = await client.query('SELECT id FROM ticket_queues WHERE is_default = true LIMIT 1');
        const r = await client.query(
          `INSERT INTO tickets
             (tenant_id, ticket_number, subject, description, status, priority, channel,
              queue_id, sla_policy_id, contact_id, voice_call_id,
              reporter_name, reporter_phone, tags, custom_fields)
           VALUES ($1,$2,$3,$4,'open',$5,'voice_bot',$6,$7,$8,$9,$10,$11,'{}','{}')
           RETURNING *`,
          [tenantId, ticketNum, body.subject, body.description ?? null,
           body.priority,
           qr.rows[0]?.id ?? null, sla?.id ?? null,
           body.contactId ?? null, body.voiceCallId,
           body.reporterName ?? null, body.reporterPhone ?? null],
        );
        return r.rows;
      });

      await eventBus.publish(tenantId, CRM_EVENTS.TICKET_CREATED, { ticket, source: 'voice_bot' });
      return reply.code(201).send({ success: true, data: ticket });
    });

    // ── Hard delete ticket (tenant_admin / super_admin, closed tickets only) ─
    fastify.delete('/:id', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const [ticket] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(`SELECT id, status, ticket_number FROM tickets WHERE id = $1 AND tenant_id = $2`, [id, req.tenant.id]);
        return r.rows;
      });
      if (!ticket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      if (ticket.status !== 'closed') {
        return reply.code(409).send({
          success: false,
          error: { code: 'NOT_CLOSED', message: `Only closed tickets can be permanently deleted. This ticket is currently "${ticket.status}".` },
        });
      }
      await db.withTenant(req.tenant.id, async (client) => {
        await client.query(`DELETE FROM tickets WHERE id = $1 AND tenant_id = $2`, [id, req.tenant.id]);
      });
      return reply.send({ success: true, data: { deleted: ticket.ticket_number } });
    });

    // ── List tickets ──────────────────────────────────────────────────────
    fastify.get('/', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const query    = ListQuerySchema.parse(req.query);
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;
      const offset   = (query.page - 1) * query.pageSize;

      const params: unknown[] = [];
      const where: string[] = ['1=1'];
      let idx = 1;

      // Visibility guard: agents see only their tickets; managers see full reportee hierarchy.
      // tenant_admin and operations_admin are read-only observers — they see ALL tickets
      // tenant-wide (writes blocked with OBSERVER_ONLY).
      const isFullObserver = req.user.role === 'tenant_admin' || req.user.role === 'operations_admin';
      const visibleIds = isFullObserver ? null : await db.withTenant(tenantId, (client) =>
        getVisibleUserIds(client, userId, req.user.role),
      );
      if (visibleIds !== null) {
        // D-R1: agents can also see unassigned open tickets in their queues (self-assign eligible)
        const agentQueueClause = req.user.role === 'agent'
          ? ` OR (t.assignee_id IS NULL AND t.status = 'open' AND t.queue_id IN` +
            `      (SELECT queue_id FROM queue_members WHERE user_id = $${idx + 2}))`
          : '';
        // D-F3: originators see their own tickets from creation (not just after acceptance)
        where.push(
          `(t.assignee_id = ANY($${idx}::uuid[])` +
          ` OR (t.created_by = $${idx + 1}` +
          `     AND (t.assignee_id IS NULL OR t.assignee_id != ALL($${idx}::uuid[])))` +
          `${agentQueueClause})`,
        );
        if (req.user.role === 'agent') {
          params.push(visibleIds, userId, userId);
          idx += 3;
        } else {
          params.push(visibleIds, userId);
          idx += 2;
        }
      }

      if (query.status) {
        // Allow comma-separated multi-status: "open,assigned"
        const statuses = query.status.split(',').map(s => s.trim());
        where.push(`t.status = ANY($${idx++}::text[])`);
        params.push(statuses);
      }
      if (query.priority) { where.push(`t.priority = $${idx++}`); params.push(query.priority); }
      if (query.channel)  { where.push(`t.channel = $${idx++}`);  params.push(query.channel);  }
      if (query.queueId)  { where.push(`t.queue_id = $${idx++}`); params.push(query.queueId); }
      if (query.assigneeId) { where.push(`t.assignee_id = $${idx++}`); params.push(query.assigneeId); }
      if (query.mine)      { where.push(`t.assignee_id = $${idx++}`); params.push(userId); }
      if (query.contactId) { where.push(`t.contact_id = $${idx++}`); params.push(query.contactId); }
      if (query.overdue)   { where.push(`t.sla_due_at < NOW() AND t.status NOT IN ('resolved','closed')`); }
      if (query.search) {
        // Search by: ticket number (exact prefix), subject, reporter email, reporter name,
        // reporter phone, and contact mobile/NIC (for customer callback identification)
        where.push(
          `(t.ticket_number ILIKE $${idx}` +
          ` OR t.subject ILIKE $${idx}` +
          ` OR t.reporter_email ILIKE $${idx}` +
          ` OR t.reporter_name ILIKE $${idx}` +
          ` OR t.reporter_phone ILIKE $${idx}` +
          ` OR EXISTS (SELECT 1 FROM contacts ct WHERE ct.id = t.contact_id` +
          `   AND (ct.mobile ILIKE $${idx} OR ct.phone ILIKE $${idx} OR ct.nic_number ILIKE $${idx})))`,
        );
        params.push(`%${query.search}%`);
        idx++;
      }

      const whereStr = where.join(' AND ');
      const orderBy  = `t.${query.sortBy} ${query.sortOrder}`;

      const [count, tickets] = await db.withTenant(tenantId, async (client) => {
        const cntR = await client.query(
          `SELECT COUNT(*) FROM tickets t WHERE ${whereStr}`, params,
        );
        const listR = await client.query(
          `SELECT t.*,
             u.name  AS assignee_name,
             u.avatar AS assignee_avatar,
             u.department AS assignee_department,
             c.first_name || ' ' || COALESCE(c.last_name,'') AS contact_name,
             q.name  AS queue_name,
             q.color AS queue_color,
             CASE WHEN t.sla_due_at < NOW() AND t.status NOT IN ('resolved','closed')
                  THEN true ELSE false END AS is_overdue,
             EXTRACT(EPOCH FROM (t.sla_due_at - NOW())) AS sla_seconds_remaining,
             CASE WHEN t.created_by = '${userId}' AND t.accepted_at IS NOT NULL
                       AND (t.assignee_id IS NULL OR u.id IS NULL
                            OR (SELECT department FROM users WHERE id = '${userId}') != u.department)
                  THEN true ELSE false END AS is_originated_by_me
           FROM tickets t
           LEFT JOIN users u    ON t.assignee_id  = u.id
           LEFT JOIN contacts c ON t.contact_id   = c.id
           LEFT JOIN ticket_queues q ON t.queue_id = q.id
           WHERE ${whereStr}
           ORDER BY ${orderBy}
           LIMIT $${idx++} OFFSET $${idx}`,
          [...params, query.pageSize, offset],
        );
        return [parseInt(cntR.rows[0].count), listR.rows];
      });

      return reply.send({
        success: true,
        data: tickets,
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total: count,
          totalPages: Math.ceil(count / query.pageSize),
          // observer_mode: tenant_admin sees all tickets in read-only observation mode (separate from operations)
          observer_mode: req.user.role === 'tenant_admin' || req.user.role === 'operations_admin',
        },
      });
    });

    // ── Get single ticket ─────────────────────────────────────────────────
    fastify.get('/:id', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const { id } = req.params as { id: string };

      const [ticket, comments, escalations, voiceBotCall] = await db.withTenant(req.tenant.id, async (client) => {
        const tr = await client.query(
          `SELECT t.*,
             u.name   AS assignee_name,
             u.role   AS assignee_role,
             u.avatar AS assignee_avatar,
             pu.name  AS prev_assignee_name,
             mob.name AS manager_overridden_by_name,
             c.first_name || ' ' || COALESCE(c.last_name,'') AS contact_name,
             q.name  AS queue_name,
             q.color AS queue_color,
             s.name  AS sla_name,
             s.resolution_hours,
             CASE WHEN t.sla_due_at < NOW() AND t.status NOT IN ('resolved','closed')
                  THEN true ELSE false END AS is_overdue,
             EXTRACT(EPOCH FROM (t.sla_due_at - NOW())) AS sla_seconds_remaining,
             EXTRACT(EPOCH FROM (NOW() - t.created_at)) AS age_seconds
           FROM tickets t
           LEFT JOIN users u         ON t.assignee_id          = u.id
           LEFT JOIN users pu        ON t.prev_assignee_id      = pu.id
           LEFT JOIN users mob       ON t.manager_overridden_by = mob.id
           LEFT JOIN contacts c      ON t.contact_id            = c.id
           LEFT JOIN ticket_queues q ON t.queue_id              = q.id
           LEFT JOIN sla_policies s  ON t.sla_policy_id         = s.id
           WHERE t.id = $1 AND t.tenant_id = $2`,
          [id, req.tenant.id],
        );
        const cr = await client.query(
          `SELECT
             tc.*,
             u.name   AS author_name_resolved,
             u.role   AS author_role,
             u.avatar AS author_avatar,
             -- Quoted (replied-to) remark preview
             rt.id        AS reply_to_id,
             rt.body      AS reply_to_body,
             rt.created_at AS reply_to_created_at,
             ru.name      AS reply_to_author_name
           FROM ticket_comments tc
           LEFT JOIN users u  ON tc.author_id   = u.id
           LEFT JOIN ticket_comments rt ON tc.reply_to_id = rt.id
           LEFT JOIN users ru ON rt.author_id   = ru.id
           WHERE tc.ticket_id = $1
           ORDER BY tc.created_at ASC`,
          [id],
        );
        const er = await client.query(
          `SELECT * FROM ticket_escalations WHERE ticket_id = $1 ORDER BY created_at ASC`,
          [id],
        );
        const vbr = await client.query(
          `SELECT vbc.*, con.first_name || ' ' || COALESCE(con.last_name,'') AS contact_name
           FROM voice_bot_calls vbc
           LEFT JOIN contacts con ON vbc.contact_id = con.id
           WHERE vbc.ticket_id = $1 LIMIT 1`,
          [id],
        );
        return [tr.rows[0], cr.rows, er.rows, vbr.rows[0] ?? null];
      });

      if (!ticket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });

      // Fetch CSAT survey for this ticket (super-admin bypass — csat_surveys has RLS)
      const [csatSurvey] = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `SELECT id, rating, comment, responded_at, sent_at, expires_at
           FROM csat_surveys WHERE ticket_id = $1 LIMIT 1`,
          [ticket.id],
        );
        return r.rows;
      });

      return reply.send({ success: true, data: { ...ticket, comments, escalations, voiceBotCall, csatSurvey: csatSurvey ?? null }, observer_mode: req.user.role === 'tenant_admin' || req.user.role === 'operations_admin' });
    });

    // ── Update ticket ─────────────────────────────────────────────────────
    fastify.patch('/:id', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body  = UpdateTicketSchema.parse(req.body);
      const userId = req.user.sub;
      const role   = req.user.role;

      // Tenant admin and operations_admin are observer-only on tickets
      if (role === 'tenant_admin' || role === 'operations_admin') {
        return reply.code(403).send({ success: false, error: { code: 'OBSERVER_ONLY', message: 'This role has read-only observer access to tickets. Operational changes must be made by managers or agents.' } });
      }

      // Originator read-only guard: if the ticket was created by this user but accepted
      // by a different department, they have view-only access — block writes.
      if (role !== 'super_admin' && role !== 'manager') {
        const visibleIds = await db.withTenant(req.tenant.id, (client) =>
          getVisibleUserIds(client, userId, role),
        );
        if (visibleIds !== null) {
          const [tkt] = await db.withTenant(req.tenant.id, async (client) => {
            const r = await client.query(
              `SELECT created_by, assignee_id, accepted_at FROM tickets WHERE id = $1`, [id],
            );
            return r.rows;
          });
          if (tkt && tkt.created_by === userId && tkt.accepted_at && tkt.assignee_id
              && !visibleIds.includes(tkt.assignee_id)) {
            return reply.code(403).send({
              success: false,
              error: { code: 'ORIGINATOR_READONLY', message: 'This ticket has been accepted by another department. You have read-only access as the originator.' },
            });
          }
        }
      }

      // Priority is SLA-governed, not a free-text field: changing it (especially
      // escalating to urgent) re-routes the SLA clock, so require a reason and
      // record it as a distinct, auditable governance action — separate from
      // routine field edits like queue/status. Reassignment (e.g. emergency
      // reroute to another agent) gets the same distinct-audit-entry treatment,
      // but the reason stays optional — it's an audit-quality nicety for
      // post-incident review, not a compliance gate like priority is.
      let priorityBefore: string | undefined;
      let assigneeBefore: string | null | undefined;
      if (body.priority || 'assigneeId' in body) {
        const [cur] = await db.withTenant(req.tenant.id, async (client) => {
          const r = await client.query(`SELECT priority, assignee_id FROM tickets WHERE id = $1 AND tenant_id = $2`, [id, req.tenant.id]);
          return r.rows;
        });
        if (!cur) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
        priorityBefore = cur.priority;
        assigneeBefore = cur.assignee_id;
        if (body.priority && priorityBefore !== body.priority && !body.priorityChangeReason) {
          return reply.code(400).send({
            success: false,
            error: { code: 'PRIORITY_REASON_REQUIRED', message: 'Changing ticket priority requires a reason (SLA-governance action).' },
          });
        }
      }

      const sets: string[] = ['updated_at = NOW()'];
      const vals: unknown[] = [];
      let idx = 1;

      const map: Record<string, string> = {
        subject: 'subject', description: 'description', priority: 'priority',
        status: 'status', queueId: 'queue_id', slaPolicyId: 'sla_policy_id',
        contactId: 'contact_id', companyId: 'company_id', assigneeId: 'assignee_id',
        resolutionNote: 'resolution_note',
      };
      for (const [k, col] of Object.entries(map)) {
        if (k in body) { sets.push(`${col} = $${idx++}`); vals.push((body as any)[k]); }
      }
      if (body.tags)         { sets.push(`tags = $${idx++}`);          vals.push(body.tags); }
      if (body.customFields) { sets.push(`custom_fields = custom_fields || $${idx++}::jsonb`); vals.push(JSON.stringify(body.customFields)); }

      // Auto-set timestamps for status transitions
      if (body.status === 'resolved') { sets.push(`resolved_at = COALESCE(resolved_at, NOW())`); }
      if (body.status === 'closed')   { sets.push(`closed_at   = COALESCE(closed_at,   NOW())`); }

      // SLA pause/resume on pending transitions
      if (body.status) {
        const [cur] = await db.withTenant(req.tenant.id, async (client) => {
          const r = await client.query(`SELECT status, sla_paused_at, sla_pause_elapsed_s, sla_due_at FROM tickets WHERE id = $1 AND tenant_id = $2`, [id, req.tenant.id]);
          return r.rows;
        });
        if (cur) {
          if (body.status === 'pending' && cur.status !== 'pending' && !cur.sla_paused_at) {
            // Pause: record when we paused
            sets.push(`sla_paused_at = NOW()`);
          } else if (body.status !== 'pending' && cur.sla_paused_at) {
            // Resume: add the elapsed pause time and shift sla_due_at forward, then clear paused_at
            sets.push(`sla_pause_elapsed_s = sla_pause_elapsed_s + EXTRACT(EPOCH FROM (NOW() - sla_paused_at))::int`);
            sets.push(`sla_due_at = sla_due_at + (NOW() - sla_paused_at)`);
            sets.push(`sla_paused_at = NULL`);
          }
        }
      }

      // Auto-reassign SLA policy when priority changes (and no explicit slaPolicyId given)
      if (body.priority && !body.slaPolicyId) {
        const newSla = await findSlaPolicy(db, req.tenant.id, undefined, body.priority);
        if (newSla) { sets.push(`sla_policy_id = $${idx++}`); vals.push(newSla.id); }
      }

      vals.push(id);
      const [ticket] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `UPDATE tickets SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
          vals,
        );
        return r.rows;
      });

      if (!ticket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      await eventBus.publish(req.tenant.id, CRM_EVENTS.TICKET_CREATED, { ticket, changes: body });

      // Audit log — field update
      const changedFields = Object.keys(body)
        .filter(k => k !== 'priorityChangeReason' && k !== 'assigneeChangeReason' && (body as any)[k] !== undefined);
      if (changedFields.length > 0) {
        await auditLog(db, {
          tenantId:  req.tenant.id,
          ticketId:  ticket.id,
          actorId:   req.user.sub,
          action:    body.status ? 'status_changed' : 'field_updated',
          newValue:  Object.fromEntries(changedFields.map(k => [k, (body as any)[k]])),
        });
      }

      // Distinct, auditable governance entry for SLA-tier (priority) changes — kept
      // separate from the generic field_updated entry above so reviewers can filter
      // for escalation history specifically.
      if (body.priority && priorityBefore && priorityBefore !== body.priority) {
        await auditLog(db, {
          tenantId:  req.tenant.id,
          ticketId:  ticket.id,
          actorId:   req.user.sub,
          action:    'priority_changed',
          oldValue:  { priority: priorityBefore },
          newValue:  { priority: body.priority },
          meta:      { reason: body.priorityChangeReason },
        });
      }

      // Distinct audit entry for reassignment (e.g. emergency reroute to another
      // agent) — reason is optional, captured for post-incident review only.
      if ('assigneeId' in body && assigneeBefore !== body.assigneeId) {
        await auditLog(db, {
          tenantId:  req.tenant.id,
          ticketId:  ticket.id,
          actorId:   req.user.sub,
          action:    'assignee_changed',
          oldValue:  { assigneeId: assigneeBefore ?? null },
          newValue:  { assigneeId: body.assigneeId ?? null },
          meta:      body.assigneeChangeReason ? { reason: body.assigneeChangeReason } : {},
        });
      }

      return reply.send({ success: true, data: ticket });
    });

    // ── Assign ticket ─────────────────────────────────────────────────────
    /**
     * POST /:id/assign
     * Assign (or reassign) a ticket to an agent.
     * When a manager overrides a previous assignment:
     *   - Previous assignee is notified their ticket was moved
     *   - Override is recorded with manager name, timestamp, optional note
     *   - Ticket shows "Reassigned by <manager> to <new agent>" in audit trail
     */
    fastify.post('/:id/assign', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body   = z.object({
        assigneeId: z.string().uuid(),
        note:       z.string().max(500).optional(),  // manager can add a note explaining the reassignment
      }).parse(req.body);
      const { assigneeId, note } = body;
      const tenantId   = req.tenant.id;
      const actorId    = (req as any).user?.sub as string;
      const actorRole  = (req as any).user?.role as string;
      const isManager  = ['manager','tenant_admin','super_admin'].includes(actorRole);

      // Read current ticket to capture previous assignee
      const [currentTicket] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query('SELECT * FROM tickets WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
        return r.rows;
      });
      if (!currentTicket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });

      const previousAssigneeId = currentTicket.assignee_id as string | null;
      const isReassignment     = previousAssigneeId && previousAssigneeId !== assigneeId;
      const isManagerOverride  = isReassignment && isManager;

      // Perform the update — record override fields if manager is overriding
      const [ticket] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `UPDATE tickets
           SET assignee_id          = $1,
               prev_assignee_id     = CASE WHEN $3 THEN assignee_id ELSE prev_assignee_id END,
               manager_overridden_by= CASE WHEN $4 THEN $5::uuid ELSE manager_overridden_by END,
               manager_overridden_at= CASE WHEN $4 THEN NOW()    ELSE manager_overridden_at END,
               manager_override_note= CASE WHEN $4 THEN $6       ELSE manager_override_note END,
               status               = CASE WHEN status = 'open' THEN 'assigned' ELSE status END,
               updated_at           = NOW()
           WHERE id = $2 RETURNING *`,
          [assigneeId, id, isReassignment, isManagerOverride, actorId, note ?? null],
        );
        return r.rows;
      });

      // Fetch actor and both agents for notifications
      const userIds = [assigneeId, ...(previousAssigneeId ? [previousAssigneeId] : []), actorId]
        .filter((v, i, a) => a.indexOf(v) === i);
      const users   = await db.withSuperAdmin(async (c) => {
        const r = await c.query('SELECT id, email, name FROM users WHERE id = ANY($1::uuid[])', [userIds]);
        return r.rows as Array<{ id: string; email: string; name: string }>;
      });
      const findUser = (uid: string) => users.find(u => u.id === uid);

      const newAgent   = findUser(assigneeId);
      const prevAgent  = previousAssigneeId ? findUser(previousAssigneeId) : null;
      const actor      = findUser(actorId);

      // ── Notify new assignee ───────────────────────────────────────────
      await notify(db, tenantId, [assigneeId], 'ticket_assigned',
        `Ticket ${ticket.ticket_number} assigned to you`,
        isManagerOverride
          ? `"${ticket.subject}" has been assigned to you by ${actor?.name ?? 'a manager'}. ${note ? `Note: ${note}` : ''}`
          : `"${ticket.subject}" is awaiting your acceptance.`,
        id);

      if (newAgent?.email) {
        emailSvc.send(tenantId, {
          to: newAgent.email, toName: newAgent.name,
          subject: `Ticket ${ticket.ticket_number} assigned to you`,
          bodyHtml: `<p>Hi ${newAgent.name},</p>
<p>Ticket <strong>${ticket.ticket_number}</strong> — "<em>${ticket.subject}</em>" has been assigned to you${isManagerOverride ? ` by ${actor?.name}` : ''}.</p>
${note ? `<p><strong>Note:</strong> ${note}</p>` : ''}
<p>Please log in to the CRM to review and accept this ticket.</p>`,
          bodyText: `Ticket ${ticket.ticket_number} ("${ticket.subject}") assigned to you. Please log in.`,
          ticketId: id,
        }).catch(() => {});
      }

      // ── Notify PREVIOUS assignee if this is a reassignment ───────────
      if (isReassignment && prevAgent) {
        await notify(db, tenantId, [previousAssigneeId!], 'ticket_reassigned',
          `Ticket ${ticket.ticket_number} has been reassigned`,
          `"${ticket.subject}" was assigned to you but has now been ${isManagerOverride ? `reassigned by ${actor?.name}` : 'reassigned'} to ${newAgent?.name ?? 'another agent'}. ${note ? `Note: ${note}` : ''}`,
          id);

        emailSvc.send(tenantId, {
          to: prevAgent.email, toName: prevAgent.name,
          subject: `Ticket ${ticket.ticket_number} has been reassigned`,
          bodyHtml: `<p>Hi ${prevAgent.name},</p>
<p>Ticket <strong>${ticket.ticket_number}</strong> — "<em>${ticket.subject}</em>" that was assigned to you has been reassigned to <strong>${newAgent?.name ?? 'another agent'}</strong>${isManagerOverride ? ` by ${actor?.name}` : ''}.</p>
${note ? `<p><strong>Reason:</strong> ${note}</p>` : ''}
<p>No further action is required from you on this ticket.</p>`,
          bodyText: `Ticket ${ticket.ticket_number} reassigned to ${newAgent?.name ?? 'another agent'}. No action required from you.`,
          ticketId: id,
        }).catch(() => {});
      }

      await eventBus.publish(tenantId, CRM_EVENTS.TICKET_ASSIGNED, {
        ticketId: id, assigneeId,
        previousAssigneeId: previousAssigneeId ?? null,
        assignedBy: actorId,
        isManagerOverride,
        note: note ?? null,
      });
      return reply.send({ success: true, data: ticket });
    });

    // ── Accept ticket (agent confirms they will work on it) ───────────────
    // This starts the SLA resolution timer.
    fastify.post('/:id/accept', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;

      // Fetch ticket + full SLA policy (need business hours fields for deadline calc)
      const [existing] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `SELECT t.*,
                  s.first_response_hours, s.resolution_hours,
                  s.business_hours_only, s.business_hours_schedule
           FROM tickets t
           LEFT JOIN sla_policies s ON t.sla_policy_id = s.id
           WHERE t.id = $1 AND t.tenant_id = $2`,
          [id, tenantId],
        );
        return r.rows;
      });

      if (!existing) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      if (existing.status === 'accepted' || existing.accepted_at) {
        return reply.code(409).send({ success: false, error: { code: 'ALREADY_ACCEPTED', message: 'Ticket already accepted' } });
      }

      const acceptedAt = new Date();

      // Compute deadlines honouring business hours + public holidays
      const policy = {
        first_response_hours:    existing.first_response_hours    ?? 4,
        resolution_hours:        existing.resolution_hours        ?? 24,
        business_hours_only:     existing.business_hours_only     ?? false,
        business_hours_schedule: existing.business_hours_schedule ?? {},
      };
      const { firstResponseDue, resolutionDue: slaDueAt } = await buildSlaDeadlines(
        db, tenantId, acceptedAt, policy,
      );

      const [ticket] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `UPDATE tickets
           SET status = 'accepted',
               accepted_at       = $1,
               sla_due_at        = $2,
               first_response_at = $3,
               assignee_id = COALESCE(assignee_id, $4),
               updated_at  = NOW()
           WHERE id = $5 RETURNING *`,
          [acceptedAt, slaDueAt, firstResponseDue, userId, id],
        );
        return r.rows;
      });

      await notify(db, tenantId, [userId], 'ticket_accepted',
        `You accepted ticket ${ticket.ticket_number}`,
        `SLA timer started. Resolution due by ${slaDueAt.toLocaleString()}.`,
        id);

      await eventBus.publish(tenantId, CRM_EVENTS.TICKET_ACCEPTED, {
        ticketId: id, acceptedAt, slaDueAt, assigneeId: userId,
      });

      // Sales enquiry → feed the pipeline. On acceptance of a 'sales' ticket we
      // create a linked deal (once) so the opportunity is forecast and worked.
      // Complaints/inquiries keep the normal resolve→close lifecycle untouched.
      let convertedDeal: any = null;
      if (ticket.ticket_type === 'sales') {
        const conv = await db.withTenant(tenantId, (client) =>
          convertSalesTicketToDeal(client, tenantId, ticket, userId),
        );
        if (conv?.created) {
          convertedDeal = conv.deal;
          await eventBus.publish(tenantId, CRM_EVENTS.DEAL_CREATED, { deal: conv.deal, fromTicketId: id });
          await notify(db, tenantId, [userId], 'ticket_accepted',
            `Deal created from ${ticket.ticket_number}`,
            `A pipeline deal "${conv.deal.name}" was created from this sales enquiry.`,
            id);
        } else if (conv) {
          convertedDeal = conv.deal;
        }
      }

      return reply.send({ success: true, data: { ...ticket, deal: convertedDeal } });
    });

    // ── Explicit: convert a sales ticket into a pipeline deal ─────────────────
    // Manual counterpart to the auto-conversion on accept. Idempotent — returns
    // the existing linked deal if one was already created.
    fastify.post('/:id/convert-to-deal', { preHandler: requireScope('deals:write') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;

      const [ticket] = await db.withTenant(tenantId, (client) =>
        client.query(`SELECT * FROM tickets WHERE id = $1 AND tenant_id = $2`, [id, tenantId]).then((r) => r.rows),
      );
      if (!ticket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      if (ticket.ticket_type !== 'sales') {
        return reply.code(400).send({ success: false, error: { code: 'NOT_A_SALES_TICKET', message: 'Only sales enquiries can be converted into a deal.' } });
      }

      const conv = await db.withTenant(tenantId, (client) =>
        convertSalesTicketToDeal(client, tenantId, ticket, ticket.assignee_id ?? userId),
      );
      if (!conv) {
        return reply.code(409).send({ success: false, error: { code: 'NO_PIPELINE', message: 'No sales pipeline is configured to place the deal into.' } });
      }
      if (conv.created) {
        await eventBus.publish(tenantId, CRM_EVENTS.DEAL_CREATED, { deal: conv.deal, fromTicketId: id });
      }
      return reply.send({ success: true, data: conv.deal, created: conv.created });
    });

    // ── Resolve ticket ────────────────────────────────────────────────────
    fastify.post('/:id/resolve', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;
      const { note } = z.object({ note: z.string().optional() }).parse(req.body ?? {});

      // G-F4: resolve → pending_closure (48h reopen window) rather than resolved directly
      const closureDeadline = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

      const [ticket] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `UPDATE tickets
           SET status = 'pending_closure',
               resolved_at = COALESCE(resolved_at, NOW()),
               closure_deadline = $1,
               resolution_note = COALESCE($2, resolution_note),
               updated_at = NOW()
           WHERE id = $3 RETURNING *`,
          [closureDeadline, note ?? null, id],
        );
        return r.rows;
      });

      if (!ticket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });

      // Email reporter on resolution — include reopen info and 48h window
      if (ticket.reporter_email) {
        emailSvc.send(tenantId, {
          to: ticket.reporter_email,
          toName: ticket.reporter_name ?? undefined,
          subject: `Your ticket ${ticket.ticket_number} has been resolved`,
          bodyHtml: `<p>Dear ${ticket.reporter_name ?? 'Customer'},</p>
<p>We're pleased to let you know that your support ticket <strong>${ticket.ticket_number}</strong> — "<em>${ticket.subject}</em>" — has been resolved.</p>
<p>If you feel this has not been fully addressed, you can request to reopen it within <strong>48 hours</strong> by replying to this email or contacting our support team.</p>
<p>After 48 hours, the ticket will be automatically closed.</p>
<p>Thank you for your patience.</p>`,
          bodyText: `Dear ${ticket.reporter_name ?? 'Customer'},\n\nYour ticket ${ticket.ticket_number} ("${ticket.subject}") has been resolved.\n\nYou have 48 hours to reopen it if needed. After that it will be automatically closed.\n\nThank you.`,
          ticketId: id,
        }).catch(() => { /* non-fatal */ });
      }

      await eventBus.publish(tenantId, CRM_EVENTS.TICKET_RESOLVED, { ticket });

      // Audit log
      await auditLog(db, {
        tenantId, ticketId: ticket.id,
        actorId:  req.user.sub,
        action:   'status_changed',
        oldValue: { status: 'in_progress' },
        newValue: { status: 'resolved', resolutionNote: note },
      });

      return reply.send({ success: true, data: ticket });
    });


    // ── Update milestone progress ─────────────────────────────────────────
    // PATCH /:id/milestones
    // body: { steps: [{id, label, completed, completed_at}] }
    fastify.patch('/:id/milestones', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;
      const { steps } = req.body as { steps: Array<{ id: string; label: string; completed: boolean; completed_at?: string }> };

      // Fetch ticket
      const [ticket] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(`SELECT * FROM tickets WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
        return r.rows;
      });
      if (!ticket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });

      // Detect newly completed steps (for customer notification)
      const prevMilestones: any[] = ticket.milestones ?? [];
      const prevCompleted = new Set(prevMilestones.filter((s: any) => s.completed).map((s: any) => s.id));
      const newlyCompleted = steps.filter(s => s.completed && !prevCompleted.has(s.id));

      // Persist updated milestones
      await db.withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE tickets SET milestones = $1::jsonb, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify(steps), id],
        );
      });

      // Notify customer on newly completed milestones
      if (newlyCompleted.length > 0 && ticket.reporter_email) {
        for (const step of newlyCompleted) {
          emailSvc.send(tenantId, {
            to:      ticket.reporter_email,
            toName:  ticket.reporter_name ?? undefined,
            subject: `Update on your ticket ${ticket.ticket_number}`,
            bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <p style="color:#1e293b;font-size:15px;">Dear ${ticket.reporter_name ?? 'Customer'},</p>
              <p>We wanted to update you that the following step has been completed for your ticket <strong>${ticket.ticket_number}</strong>:</p>
              <div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px 16px;border-radius:0 8px 8px 0;margin:16px 0;">
                <p style="margin:0;font-weight:600;color:#166534;">✅ ${step.label}</p>
              </div>
              <p style="color:#64748b;">Our team is continuing to work on your request.</p>
            </div>`,
            bodyText: `Ticket ${ticket.ticket_number} update: Step "${step.label}" has been completed.`,
            ticketId: id,
            sentBy: userId,
          }).catch(() => {});
        }
      }

      // Compute overall progress
      const completed = steps.filter(s => s.completed).length;
      const total     = steps.length;

      return reply.send({ success: true, data: { steps, progress: total > 0 ? Math.round((completed / total) * 100) : 0 } });
    });

    // ── Claim ticket (agent self-assign from unassigned queue) ───────────
    // D-R1: agents can claim any unassigned open ticket in a queue they belong to
    fastify.post('/:id/claim', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;

      const [ticket] = await db.withTenant(tenantId, async (client) => {
        // Verify ticket is unassigned and open, and agent is in the ticket's queue
        const check = await client.query(
          `SELECT t.id, t.queue_id, t.status, t.assignee_id, t.ticket_number, t.subject
           FROM tickets t
           WHERE t.id = $1 AND t.tenant_id = $2`,
          [id, tenantId],
        );
        const tkt = check.rows[0];
        if (!tkt) return [null];
        if (tkt.assignee_id !== null) return ['already_assigned'];
        if (tkt.status !== 'open') return ['not_open'];

        if (tkt.queue_id) {
          const mem = await client.query(
            `SELECT 1 FROM queue_members WHERE queue_id = $1 AND user_id = $2`,
            [tkt.queue_id, userId],
          );
          if (mem.rows.length === 0) return ['not_in_queue'];
        }

        const r = await client.query(
          `UPDATE tickets SET assignee_id = $1, status = 'assigned', updated_at = NOW()
           WHERE id = $2 AND assignee_id IS NULL
           RETURNING *`,
          [userId, id],
        );
        return r.rows;
      });

      if (ticket === null) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      if (ticket === 'already_assigned') return reply.code(409).send({ success: false, error: { code: 'ALREADY_ASSIGNED', message: 'Ticket has already been claimed' } });
      if (ticket === 'not_open') return reply.code(409).send({ success: false, error: { code: 'INVALID_STATUS', message: 'Only open tickets can be claimed' } });
      if (ticket === 'not_in_queue') return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'You are not a member of this ticket\'s queue' } });
      if (!ticket.id) return reply.code(409).send({ success: false, error: { code: 'CONFLICT', message: 'Ticket was claimed by another agent simultaneously' } });

      await auditLog(db, {
        tenantId, ticketId: id,
        actorId: userId, actorName: '',
        action: 'assignee_changed',
        oldValue: { assignee_id: null },
        newValue: { assignee_id: userId },
        meta: { claimedFromQueue: true },
      });

      return reply.send({ success: true, data: ticket });
    });

    // ── Close ticket ──────────────────────────────────────────────────────
    fastify.post('/:id/close', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;

      const [ticket] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `UPDATE tickets
           SET status = 'closed', closed_at = COALESCE(closed_at, NOW()), updated_at = NOW()
           WHERE id = $1 RETURNING *`,
          [id],
        );
        return r.rows;
      });
      if (!ticket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });

      // ── Closure notifications ─────────────────────────────────────────
      const closerName = await db.withSuperAdmin(async (c) => {
        const r = await c.query('SELECT name FROM users WHERE id = $1', [userId]);
        return r.rows[0]?.name ?? 'Support Team';
      });

      // 1. Customer
      if (ticket.reporter_email) {
        emailSvc.send(tenantId, {
          to: ticket.reporter_email, toName: ticket.reporter_name ?? undefined,
          subject: `Your ticket ${ticket.ticket_number} has been closed`,
          bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
            <p>Dear ${ticket.reporter_name ?? 'Customer'},</p>
            <p>Your support ticket <strong>${ticket.ticket_number}</strong> — "<em>${ticket.subject}</em>" — has been <strong>closed</strong>.</p>
            ${ticket.resolution_note ? `<div style="background:#f8fafc;border-left:4px solid #29ABE2;padding:12px 16px;border-radius:0 8px 8px 0;margin:16px 0;"><p style="margin:0;color:#1e293b;"><strong>Resolution:</strong> ${ticket.resolution_note}</p></div>` : ''}
            <p style="color:#64748b;">If you need further assistance, please don't hesitate to contact us.</p>
          </div>`,
          bodyText: `Ticket ${ticket.ticket_number} has been closed. ${ticket.resolution_note ? 'Resolution: ' + ticket.resolution_note : ''}`,
          ticketId: id, sentBy: userId,
        }).catch(() => {});
      }

      // 2. Assigned agent notification (in-app)
      if (ticket.assignee_id) {
        await notify(db, tenantId, [ticket.assignee_id], 'ticket_closed',
          `Ticket ${ticket.ticket_number} closed`,
          `"${ticket.subject}" has been closed.`, id);
      }

      // 3. Managers / line management (in-app)
      const managers = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `SELECT id FROM users WHERE tenant_id = $1 AND role IN ('manager','tenant_admin') AND is_active = true`,
          [tenantId],
        );
        return r.rows.map((u: any) => u.id as string);
      });
      if (managers.length > 0) {
        await notify(db, tenantId, managers, 'ticket_closed',
          `Ticket ${ticket.ticket_number} closed by ${closerName}`,
          `"${ticket.subject}" — resolved and closed.`, id);
      }

      await eventBus.publish(tenantId, CRM_EVENTS.TICKET_CLOSED, { ticket });

      // Audit log — closure
      await auditLog(db, {
        tenantId, ticketId: id,
        actorId:   userId,
        actorName: closerName,
        action:    'status_changed',
        oldValue:  { status: 'resolved' },
        newValue:  { status: 'closed' },
      });

      // CSAT survey — fire and forget (Gap 4: read configurable expiry from tenant settings)
      const csatExpiry = (req.tenant as any)?.settings?.csat_expiry_days ?? 7;
      await sendCsatSurvey(db, emailSvc, eventBus, { ...ticket, tenant_id: tenantId }, APP_URL, csatExpiry);

      return reply.send({ success: true, data: ticket });
    });

    // ── Cancel ticket ─────────────────────────────────────────────────────
    // Agent → sets status to 'cancel_requested' (supervisor/manager must approve)
    // Manager/Supervisor → sets status to 'cancelled' directly
    fastify.post('/:id/cancel', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;
      const body     = z.object({ reason: z.string().min(1).optional() }).parse(req.body ?? {});

      const userRole = req.user.role;
      const isManager = ['super_admin','tenant_admin','manager'].includes(userRole);
      const newStatus = isManager ? 'cancelled' : 'cancel_requested';

      const [ticket] = await db.withTenant(tenantId, async (client) => {
        const existing = await client.query(`SELECT status FROM tickets WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
        if (!existing.rows[0]) return [];
        const current = existing.rows[0].status;
        if (['cancelled','closed'].includes(current)) {
          return [{ __error: `Ticket is already ${current}` }];
        }
        const r = await client.query(
          `UPDATE tickets
           SET status = $1, updated_at = NOW(),
               resolution_note = COALESCE($2, resolution_note)
           WHERE id = $3 RETURNING *`,
          [newStatus, body.reason ?? null, id],
        );
        return r.rows;
      });

      if (!ticket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      if (ticket.__error) return reply.code(409).send({ success: false, error: { code: 'CONFLICT', message: ticket.__error } });

      const actorName = await db.withSuperAdmin(async (c) => {
        const r = await c.query('SELECT name FROM users WHERE id = $1', [userId]);
        return r.rows[0]?.name ?? 'Unknown';
      });

      if (!isManager) {
        // Notify managers that an agent has requested cancellation
        const managers = await db.withSuperAdmin(async (c) => {
          const r = await c.query(
            `SELECT id FROM users WHERE tenant_id = $1 AND role IN ('manager','tenant_admin') AND is_active = true`,
            [tenantId],
          );
          return r.rows.map((u: any) => u.id as string);
        });
        if (managers.length > 0) {
          await notify(db, tenantId, managers, 'ticket_cancel_requested',
            `Cancel requested: ${ticket.ticket_number}`,
            `${actorName} requested cancellation of "${ticket.subject}"${body.reason ? ': ' + body.reason : ''}.`, id);
        }
      }

      await auditLog(db, {
        tenantId, ticketId: id,
        actorId: userId, actorName,
        action: 'status_changed',
        oldValue: { status: ticket.status },
        newValue: { status: newStatus, reason: body.reason },
      });

      return reply.send({ success: true, data: ticket });
    });

    // ── G-P3: Agent Escalation (manual escalate to manager) ──────────────
    fastify.post('/:id/escalate', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;
      const body     = z.object({ reason: z.string().min(3).max(500) }).parse(req.body ?? {});

      // Only agents (not already managers) can manually escalate
      const userRole = req.user.role;
      if (['manager','tenant_admin','super_admin'].includes(userRole)) {
        return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Managers do not need to escalate — they can act directly.' } });
      }

      const [ticket] = await db.withTenant(tenantId, async (client) => {
        const existing = await client.query(
          `SELECT id, subject, ticket_number, status, assignee_id, agent_escalated FROM tickets WHERE id = $1`, [id]);
        if (!existing.rows[0]) return [];
        const t = existing.rows[0];
        if (t.agent_escalated) return [{ __error: 'Ticket is already escalated.' }];
        if (['closed','cancelled','resolved'].includes(t.status)) {
          return [{ __error: 'Cannot escalate a closed, cancelled, or resolved ticket.' }];
        }
        const r = await client.query(
          `UPDATE tickets SET agent_escalated=true, agent_escalated_at=NOW(), agent_escalated_reason=$1, updated_at=NOW()
           WHERE id=$2 RETURNING *`, [body.reason, id]);
        return r.rows;
      });

      if (!ticket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      if (ticket.__error) return reply.code(409).send({ success: false, error: { code: 'CONFLICT', message: ticket.__error } });

      const actorName = await db.withSuperAdmin(async (c) => {
        const r = await c.query('SELECT name FROM users WHERE id=$1', [userId]);
        return r.rows[0]?.name ?? 'Unknown';
      });

      // Notify all managers in the tenant
      const managers = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `SELECT id FROM users WHERE tenant_id=$1 AND role='manager' AND is_active=true`, [tenantId]);
        return r.rows.map((u: any) => u.id as string);
      });
      if (managers.length > 0) {
        await notify(db, tenantId, managers, 'ticket_escalated',
          `🚨 Escalation: ${ticket.ticket_number}`,
          `${actorName} escalated ticket "${ticket.subject}": ${body.reason}`, id);
      }

      await auditLog(db, {
        tenantId, ticketId: id, actorId: userId, actorName,
        action: 'escalated',
        newValue: { reason: body.reason },
      });

      return reply.send({ success: true, data: ticket });
    });

    // ── G-P3: Acknowledge escalation (manager clears the escalation flag) ──
    fastify.post('/:id/acknowledge-escalation', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;
      const userRole = req.user.role;

      if (!['manager','tenant_admin','super_admin'].includes(userRole)) {
        return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Only managers can acknowledge escalations.' } });
      }

      const [ticket] = await db.withTenant(tenantId, async (client) => {
        const existing = await client.query(
          `SELECT id, subject, ticket_number, agent_escalated, assignee_id FROM tickets WHERE id=$1`, [id]);
        if (!existing.rows[0]) return [];
        if (!existing.rows[0].agent_escalated) return [{ __error: 'Ticket is not escalated.' }];
        const r = await client.query(
          `UPDATE tickets SET agent_escalated=false, agent_escalated_at=NULL, agent_escalated_reason=NULL, updated_at=NOW()
           WHERE id=$1 RETURNING *`, [id]);
        return r.rows;
      });

      if (!ticket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      if (ticket.__error) return reply.code(409).send({ success: false, error: { code: 'CONFLICT', message: ticket.__error } });

      const actorName = await db.withSuperAdmin(async (c) => {
        const r = await c.query('SELECT name FROM users WHERE id=$1', [userId]);
        return r.rows[0]?.name ?? 'Unknown';
      });

      await auditLog(db, {
        tenantId, ticketId: id, actorId: userId, actorName,
        action: 'escalation_acknowledged',
        newValue: {},
      });

      return reply.send({ success: true, data: ticket });
    });

    // ── G-F4: Reopen a resolved/pending_closure ticket ────────────────────
    fastify.post('/:id/reopen', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;
      const body     = z.object({ reason: z.string().min(3).max(500).optional() }).parse(req.body ?? {});

      const [ticket] = await db.withTenant(tenantId, async (client) => {
        const existing = await client.query(
          `SELECT id, subject, ticket_number, status FROM tickets WHERE id=$1`, [id]);
        if (!existing.rows[0]) return [];
        const t = existing.rows[0];
        if (!['resolved','pending_closure'].includes(t.status)) {
          return [{ __error: 'Only resolved or pending-closure tickets can be reopened.' }];
        }
        const r = await client.query(
          `UPDATE tickets SET status='in_progress', closure_deadline=NULL, resolved_at=NULL, updated_at=NOW()
           WHERE id=$1 RETURNING *`, [id]);
        return r.rows;
      });

      if (!ticket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      if (ticket.__error) return reply.code(409).send({ success: false, error: { code: 'CONFLICT', message: ticket.__error } });

      const actorName = await db.withSuperAdmin(async (c) => {
        const r = await c.query('SELECT name FROM users WHERE id=$1', [userId]);
        return r.rows[0]?.name ?? 'Unknown';
      });

      await auditLog(db, {
        tenantId, ticketId: id, actorId: userId, actorName,
        action: 'reopened',
        newValue: { reason: body.reason ?? 'Customer requested reopen' },
      });

      return reply.send({ success: true, data: ticket });
    });

    // ── G-P5: SLA Policy publish / draft toggle ───────────────────────────
    fastify.patch('/sla-policies/:policyId/publish', { preHandler: requireRole('policy_admin','super_admin','tenant_admin') }, async (req, reply) => {
      const { policyId } = req.params as { policyId: string };
      const tenantId     = req.tenant.id;
      const body         = z.object({ status: z.enum(['draft','published']) }).parse(req.body ?? {});

      const [policy] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `UPDATE sla_policies SET policy_status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
          [body.status, policyId]);
        return r.rows;
      });

      if (!policy) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } });
      return reply.send({ success: true, data: policy });
    });

    // ── D-D1: Manager saved ticket views ─────────────────────────────────
    fastify.get('/saved-views', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;
      const isManager = ['manager','super_admin','tenant_admin','operations_admin'].includes(req.user.role);
      const rows = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `SELECT * FROM user_ticket_views
           WHERE (user_id=$1 OR is_shared=true) AND tenant_id=current_setting('app.tenant_id')::uuid
           ORDER BY created_at DESC`, [userId]);
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    fastify.post('/saved-views', { preHandler: [requireScope('tickets:read'), requireRole('manager','super_admin','tenant_admin')] }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;
      const body     = z.object({
        name:      z.string().min(1).max(80),
        filters:   z.record(z.any()),
        is_shared: z.boolean().default(false),
      }).parse(req.body ?? {});

      const [view] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `INSERT INTO user_ticket_views(tenant_id,user_id,name,filters,is_shared)
           VALUES(current_setting('app.tenant_id')::uuid,$1,$2,$3,$4) RETURNING *`,
          [userId, body.name, JSON.stringify(body.filters), body.is_shared]);
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: view });
    });

    fastify.delete('/saved-views/:viewId', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const { viewId } = req.params as { viewId: string };
      const tenantId   = req.tenant.id;
      const userId     = req.user.sub;
      await db.withTenant(tenantId, async (client) => {
        await client.query(
          `DELETE FROM user_ticket_views WHERE id=$1 AND user_id=$2`, [viewId, userId]);
      });
      return reply.send({ success: true });
    });

    // ── RCA — Root Cause Analysis ─────────────────────────────────────────
    fastify.post('/:id/rca', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;
      const body     = RcaSchema.parse(req.body);

      const [ticket] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `UPDATE tickets
           SET root_cause          = $1,
               corrective_action   = $2,
               rca_completed_at    = COALESCE(rca_completed_at, NOW()),
               rca_completed_by    = COALESCE(rca_completed_by, $3),
               updated_at          = NOW()
           WHERE id = $4
           RETURNING id, ticket_number, subject, root_cause, corrective_action,
                     rca_completed_at, rca_completed_by`,
          [body.rootCause, body.correctiveAction, userId, id],
        );
        return r.rows;
      });

      if (!ticket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });

      // Audit log
      await auditLog(db, {
        tenantId, ticketId: id,
        actorId:  userId,
        action:   'rca_submitted',
        newValue: { rootCause: body.rootCause, correctiveAction: body.correctiveAction },
      });

      await eventBus.publish(tenantId, CRM_EVENTS.TICKET_RCA_SUBMITTED, {
        ticketId: id,
        rootCause: body.rootCause,
        correctiveAction: body.correctiveAction,
      });

      return reply.send({ success: true, data: ticket });
    });

    // ── RCA — Get ─────────────────────────────────────────────────────────
    fastify.get('/:id/rca', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;

      const [ticket] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `SELECT t.id, t.ticket_number, t.subject, t.root_cause, t.corrective_action,
                  t.rca_completed_at, u.name AS rca_completed_by_name
           FROM   tickets t
           LEFT JOIN users u ON u.id = t.rca_completed_by
           WHERE  t.id = $1`,
          [id],
        );
        return r.rows;
      });

      if (!ticket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      return reply.send({ success: true, data: ticket });
    });

    // ── Audit log — tamper-proof trail ────────────────────────────────────
    fastify.get('/:id/audit-log', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;
      const { page = 1, pageSize = 50 } = req.query as any;
      const offset = (Number(page) - 1) * Number(pageSize);

      const rows = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `SELECT al.id, al.action, al.old_value, al.new_value, al.meta,
                  al.created_at, al.actor_name,
                  u.name AS actor_display_name, u.avatar AS actor_avatar
           FROM   ticket_audit_log al
           LEFT JOIN users u ON u.id = al.actor_id
           WHERE  al.ticket_id = $1
           ORDER BY al.created_at ASC
           LIMIT $2 OFFSET $3`,
          [id, pageSize, offset],
        );
        return r.rows;
      });

      return reply.send({ success: true, data: rows });
    });

    // ── Gap 6: Standalone comments endpoint ──────────────────────────────
    // GET /tickets/:id/comments
    //   ?since=<ISO timestamp>   — return only comments after this time (for polling)
    //   ?type=reply|remark|note  — filter by comment type
    //   ?page=1&pageSize=50
    fastify.get('/:id/comments', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const { id }       = req.params as { id: string };
      const tenantId     = req.tenant.id;
      const { since, type, page = '1', pageSize = '50' } = req.query as {
        since?: string; type?: string; page?: string; pageSize?: string;
      };

      const conditions: string[] = ['tc.ticket_id = $1'];
      const vals: any[]          = [id];
      let   idx                  = 2;

      if (since) {
        const sinceDate = new Date(since);
        if (!isNaN(sinceDate.getTime())) {
          conditions.push(`tc.created_at > $${idx++}`);
          vals.push(sinceDate.toISOString());
        }
      }
      if (type && ['reply','remark','note'].includes(type)) {
        conditions.push(`tc.comment_type = $${idx++}`);
        vals.push(type);
      }

      const limit  = Math.min(Math.max(1, Number(pageSize) || 50), 200);
      const offset = (Math.max(1, Number(page) || 1) - 1) * limit;
      const limitClause = `LIMIT $${idx++} OFFSET $${idx++}`;
      vals.push(limit, offset);

      const comments = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `SELECT
             tc.*,
             u.name   AS author_name_resolved,
             u.role   AS author_role,
             u.avatar AS author_avatar,
             rt.id           AS reply_to_id,
             rt.body         AS reply_to_body,
             rt.created_at   AS reply_to_created_at,
             ru.name         AS reply_to_author_name
           FROM ticket_comments tc
           LEFT JOIN users u  ON tc.author_id   = u.id
           LEFT JOIN ticket_comments rt ON tc.reply_to_id = rt.id
           LEFT JOIN users ru ON rt.author_id   = ru.id
           WHERE ${conditions.join(' AND ')}
           ORDER BY tc.created_at ASC
           ${limitClause}`,
          vals,
        );
        return r.rows;
      });

      return reply.send({ success: true, data: comments, meta: { page: Number(page), pageSize: limit } });
    });

    // ── Add comment / internal note ───────────────────────────────────────
    fastify.post('/:id/comments', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const body     = AddCommentSchema.parse(req.body);
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;

      const [comment] = await db.withTenant(tenantId, async (client) => {
        // Record first_response_at (SLA timer) and first_replied_at (metric) on first agent reply
        if (!body.isInternal && body.commentType === 'reply') {
          await client.query(
            `UPDATE tickets SET
               first_response_at = COALESCE(first_response_at, NOW()),
               first_replied_at  = COALESCE(first_replied_at,  NOW())
             WHERE id = $1`,
            [id],
          );
        }
        // Move status to in_progress if still at accepted
        await client.query(
          `UPDATE tickets SET status = 'in_progress', updated_at = NOW()
           WHERE id = $1 AND status = 'accepted'`,
          [id],
        );
        const inserted = await client.query(
          `INSERT INTO ticket_comments
             (tenant_id, ticket_id, author_id, body, is_internal, comment_type, reply_to_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [
            tenantId, id, userId, body.body,
            body.commentType === 'remark' ? true : body.isInternal,
            body.commentType,
            body.replyToId ?? null,
          ],
        );
        const newId = inserted.rows[0]?.id;
        // Return enriched row (author name + role + reply_to preview)
        const r = await client.query(
          `SELECT
             tc.*,
             u.name   AS author_name_resolved,
             u.role   AS author_role,
             rt.id        AS reply_to_id,
             rt.body      AS reply_to_body,
             rt.created_at AS reply_to_created_at,
             ru.name      AS reply_to_author_name
           FROM ticket_comments tc
           LEFT JOIN users u  ON tc.author_id  = u.id
           LEFT JOIN ticket_comments rt ON tc.reply_to_id = rt.id
           LEFT JOIN users ru ON rt.author_id  = ru.id
           WHERE tc.id = $1`,
          [newId],
        );
        return r.rows;
      });

      await eventBus.publish(tenantId, CRM_EVENTS.TICKET_COMMENTED, { ticketId: id, comment });

      // Audit log — comment/note
      await auditLog(db, {
        tenantId, ticketId: id,
        actorId:  userId,
        action:   'comment_added',
        newValue: { isInternal: body.isInternal, excerpt: body.body.slice(0, 120) },
      });

      // ── Dispatch reply via customer's preferred channel ────────────────
      if (!body.isInternal) {
        const [ticket] = await db.withTenant(tenantId, async (client) => {
          const r = await client.query(
            `SELECT ticket_number, subject, reporter_email, reporter_name,
                    reporter_phone, reporter_whatsapp, preferred_channel
             FROM tickets WHERE id = $1`,
            [id],
          );
          return r.rows;
        });
        const [agent] = await db.withSuperAdmin(async (client) => {
          const r = await client.query('SELECT name FROM users WHERE id = $1', [userId]);
          return r.rows;
        });
        const agentName = agent?.name ?? 'Support Team';
        const channel   = ticket?.preferred_channel ?? 'email';

        if (channel === 'sms' && ticket?.reporter_phone) {
          smsSvc.send(tenantId, {
            to:       ticket.reporter_phone,
            body:     `[${ticket.ticket_number}] ${body.body.slice(0, 140)} — ${agentName}`,
            ticketId: id,
          }).catch(() => {});
        } else if (channel === 'whatsapp' && (ticket?.reporter_whatsapp || ticket?.reporter_phone)) {
          const waNumber = ticket.reporter_whatsapp ?? ticket.reporter_phone;
          smsSvc.send(tenantId, {
            to:       `whatsapp:${waNumber}`,
            body:     `[${ticket.ticket_number}] ${body.body} — ${agentName}`,
            ticketId: id,
          }).catch(() => {});
        } else if (ticket?.reporter_email) {
          emailSvc.send(tenantId, {
            to:       ticket.reporter_email,
            toName:   ticket.reporter_name ?? undefined,
            subject:  `Re: [${ticket.ticket_number}] ${ticket.subject}`,
            bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;"><div style="background:#f8fafc;border-left:4px solid #29ABE2;padding:12px 16px;margin-bottom:20px;border-radius:0 8px 8px 0;"><p style="margin:0;font-size:12px;color:#64748b;">Ticket <strong>${ticket.ticket_number}</strong> — ${ticket.subject}</p></div><p style="color:#1e293b;font-size:15px;line-height:1.6;">${body.body.split(String.fromCharCode(10)).join('<br/>')}</p><p style="color:#64748b;font-size:13px;margin-top:24px;">— ${agentName}, Support Team</p><hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;"/><p style="color:#94a3b8;font-size:11px;">Ticket ${ticket.ticket_number}. Please do not reply directly to this email.</p></div>`,
            bodyText:  `${body.body}\n\n— ${agentName}\n\nTicket: ${ticket.ticket_number}`,
            ticketId: id,
            sentBy:   userId,
          }).catch(() => {});
        }
      }


      return reply.code(201).send({ success: true, data: comment });
    });

    // ── Customer-context internal note — any agent can add ────────────
    // Any agent with tickets:read can annotate a ticket they encountered during
    // a customer callback. Always stored as is_internal=true. Does not change
    // ticket ownership or trigger SLA stamps.
    fastify.post('/:id/notes', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const { body: noteBody } = req.body as { body: string };
      if (!noteBody?.trim()) {
        return reply.code(400).send({ success: false, error: { code: 'EMPTY_NOTE', message: 'Note body is required' } });
      }
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;

      // Verify the ticket exists in this tenant
      const [exists] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(`SELECT id FROM tickets WHERE id = $1`, [id]);
        return r.rows;
      });
      if (!exists) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });

      const [note] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `INSERT INTO ticket_comments
             (tenant_id, ticket_id, author_id, body, is_internal, comment_type)
           VALUES ($1,$2,$3,$4,true,'note')
           RETURNING *`,
          [tenantId, id, userId, noteBody.trim()],
        );
        const newId = r.rows[0]?.id;
        const enriched = await client.query(
          `SELECT tc.*, u.name AS author_name_resolved, u.role AS author_role, u.department AS author_department
           FROM ticket_comments tc LEFT JOIN users u ON tc.author_id = u.id
           WHERE tc.id = $1`,
          [newId],
        );
        return enriched.rows;
      });

      await auditLog(db, {
        tenantId, ticketId: id,
        actorId: userId,
        action: 'note_added',
        newValue: { crossDept: true, excerpt: noteBody.trim().slice(0, 120) },
      });

      return reply.code(201).send({ success: true, data: note });
    });

    // ── AGENT DASHBOARD — department-aware ticket counts ──────────────
    // Returns counts bucketed by status + TAT health for the calling agent
    // (or any user_id when called by a manager).
    fastify.get('/dashboard/agent', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const userId = (req.query as any).user_id ?? req.user.sub;

      const { rows } = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'assigned')                                              AS assigned,
             COUNT(*) FILTER (WHERE status = 'accepted' OR accepted_at IS NOT NULL
                               AND status NOT IN ('resolved','closed'))                               AS accepted,
             COUNT(*) FILTER (WHERE status IN ('pending','in_progress'))                              AS pending,
             COUNT(*) FILTER (WHERE status = 'resolved')                                              AS resolved,
             COUNT(*) FILTER (WHERE sla_due_at IS NOT NULL AND sla_due_at > NOW()
                               AND status NOT IN ('resolved','closed'))                               AS within_tat,
             COUNT(*) FILTER (WHERE sla_due_at IS NOT NULL
                               AND sla_due_at > NOW()
                               AND sla_due_at <= NOW() + INTERVAL '2 hours'
                               AND status NOT IN ('resolved','closed'))                               AS approaching_tat,
             COUNT(*) FILTER (WHERE sla_due_at IS NOT NULL AND sla_due_at < NOW()
                               AND status NOT IN ('resolved','closed'))                               AS breached_tat
           FROM tickets
           WHERE tenant_id = $1 AND assignee_id = $2`,
          [tenantId, userId]
        )
      );

      return reply.send({ success: true, data: rows[0] });
    });

    // ── MANAGER ROLLUP — recursive team ticket summary ────────────────
    // Walks the manager_id hierarchy from the given manager downward,
    // returning aggregated counts for the entire reporting tree.
    // Also returns per-agent breakdown for drill-down.
    fastify.get('/dashboard/team', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const managerId = (req.query as any).manager_id ?? req.user.sub;

      // Aggregate totals for the whole tree
      const { rows: [totals] } = await db.withTenant(tenantId, (client) =>
        client.query(
          `WITH RECURSIVE team AS (
             SELECT id FROM users WHERE tenant_id = $1 AND id = $2
             UNION ALL
             SELECT u.id FROM users u INNER JOIN team t ON u.manager_id = t.id
             WHERE u.tenant_id = $1
           )
           SELECT
             COUNT(*) FILTER (WHERE t.status = 'assigned')                                           AS assigned,
             COUNT(*) FILTER (WHERE t.status = 'accepted' OR t.accepted_at IS NOT NULL
                               AND t.status NOT IN ('resolved','closed'))                             AS accepted,
             COUNT(*) FILTER (WHERE t.status IN ('pending','in_progress'))                           AS pending,
             COUNT(*) FILTER (WHERE t.status = 'resolved')                                           AS resolved,
             COUNT(*) FILTER (WHERE t.sla_due_at IS NOT NULL AND t.sla_due_at > NOW()
                               AND t.status NOT IN ('resolved','closed'))                             AS within_tat,
             COUNT(*) FILTER (WHERE t.sla_due_at IS NOT NULL
                               AND t.sla_due_at > NOW()
                               AND t.sla_due_at <= NOW() + INTERVAL '2 hours'
                               AND t.status NOT IN ('resolved','closed'))                             AS approaching_tat,
             COUNT(*) FILTER (WHERE t.sla_due_at IS NOT NULL AND t.sla_due_at < NOW()
                               AND t.status NOT IN ('resolved','closed'))                             AS breached_tat
           FROM tickets t
           WHERE t.tenant_id = $1 AND t.assignee_id IN (SELECT id FROM team)`,
          [tenantId, managerId]
        )
      );

      // Per-agent breakdown (direct reports only — drill further by calling with their id)
      const { rows: agents } = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT
             u.id, u.name, u.email, u.department, u.department_type,
             COUNT(t.id) FILTER (WHERE t.status = 'assigned')                                        AS assigned,
             COUNT(t.id) FILTER (WHERE t.status = 'accepted' OR t.accepted_at IS NOT NULL
                                  AND t.status NOT IN ('resolved','closed'))                          AS accepted,
             COUNT(t.id) FILTER (WHERE t.status IN ('pending','in_progress'))                        AS pending,
             COUNT(t.id) FILTER (WHERE t.status = 'resolved')                                        AS resolved,
             COUNT(t.id) FILTER (WHERE t.sla_due_at IS NOT NULL AND t.sla_due_at > NOW()
                                  AND t.status NOT IN ('resolved','closed'))                          AS within_tat,
             COUNT(t.id) FILTER (WHERE t.sla_due_at IS NOT NULL
                                  AND t.sla_due_at > NOW()
                                  AND t.sla_due_at <= NOW() + INTERVAL '2 hours'
                                  AND t.status NOT IN ('resolved','closed'))                          AS approaching_tat,
             COUNT(t.id) FILTER (WHERE t.sla_due_at IS NOT NULL AND t.sla_due_at < NOW()
                                  AND t.status NOT IN ('resolved','closed'))                          AS breached_tat
           FROM users u
           LEFT JOIN tickets t ON t.assignee_id = u.id AND t.tenant_id = $1
           WHERE u.tenant_id = $1 AND u.manager_id = $2
           GROUP BY u.id, u.name, u.email, u.department, u.department_type
           ORDER BY u.name`,
          [tenantId, managerId]
        )
      );

      // Count sub-reports (people reporting to these agents)
      const { rows: [{ direct_reports }] } = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT COUNT(*) AS direct_reports FROM users WHERE tenant_id = $1 AND manager_id = $2`,
          [tenantId, managerId]
        )
      );

      return reply.send({
        success: true,
        data: { totals, agents, direct_reports: Number(direct_reports) },
      });
    });

    // ── G-P1: Bulk ticket operations (manager+) ────────────────────────
    // POST /api/v1/tickets/bulk
    // body: { ids: string[], action: 'close'|'resolve'|'reassign'|'status', assigneeId?, status? }
    fastify.post('/bulk', { preHandler: [requireScope('tickets:write'), requireRole('manager','tenant_admin','super_admin','policy_admin')] }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;
      const body = z.object({
        ids:        z.array(z.string().uuid()).min(1).max(100),
        action:     z.enum(['close','resolve','reassign','status']),
        assigneeId: z.string().uuid().optional(),
        status:     z.enum(['open','assigned','accepted','in_progress','pending','resolved','closed','cancelled']).optional(),
      }).parse(req.body);

      let setSql = '';
      const extraParams: any[] = [];
      if (body.action === 'close') {
        setSql = `status = 'closed', closed_at = COALESCE(closed_at, NOW()), updated_at = NOW()`;
      } else if (body.action === 'resolve') {
        setSql = `status = 'resolved', resolved_at = COALESCE(resolved_at, NOW()), updated_at = NOW()`;
      } else if (body.action === 'reassign') {
        if (!body.assigneeId) return reply.code(400).send({ success: false, error: { code: 'BAD_REQUEST', message: 'assigneeId required for reassign action' } });
        setSql = `assignee_id = $3, status = CASE WHEN status = 'open' THEN 'assigned' ELSE status END, updated_at = NOW()`;
        extraParams.push(body.assigneeId);
      } else if (body.action === 'status') {
        if (!body.status) return reply.code(400).send({ success: false, error: { code: 'BAD_REQUEST', message: 'status required for status action' } });
        setSql = `status = $3, updated_at = NOW()`;
        extraParams.push(body.status);
      }

      const updated = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `UPDATE tickets SET ${setSql}
           WHERE id = ANY($1::uuid[]) AND tenant_id = $2
           RETURNING id, ticket_number, status`,
          [body.ids, tenantId, ...extraParams],
        );
        return r.rows;
      });

      // Individual audit entries per ticket (ISO 27001 traceability)
      await Promise.all(updated.map((t: any) =>
        auditLog(db, {
          tenantId, ticketId: t.id,
          actorId: userId, actorName: null,
          action: body.action === 'reassign' ? 'assignee_changed' : 'status_changed',
          newValue: body.action === 'reassign'
            ? { assignee_id: body.assigneeId }
            : { status: t.status },
          meta: { bulk: true, bulk_size: body.ids.length },
        }),
      ));

      return reply.send({ success: true, data: { updated: updated.length, tickets: updated } });
    });

    // ── G-P2: Ticket merge (manager+, same tenant) ─────────────────────
    // POST /api/v1/tickets/:id/merge  — merges :id INTO targetId
    // The source ticket is closed and marked merged; comments + audit log copied to target.
    fastify.post('/:id/merge', { preHandler: [requireScope('tickets:write'), requireRole('manager','tenant_admin','super_admin')] }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;
      const { targetId } = z.object({ targetId: z.string().uuid() }).parse(req.body);

      if (id === targetId) return reply.code(400).send({ success: false, error: { code: 'BAD_REQUEST', message: 'Cannot merge a ticket into itself' } });

      const [source, target] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `SELECT id, ticket_number, status, subject, merged_into_id FROM tickets WHERE id = ANY($1::uuid[])`,
          [[id, targetId]],
        );
        const rows = r.rows;
        return [rows.find((t: any) => t.id === id), rows.find((t: any) => t.id === targetId)];
      });

      if (!source) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Source ticket not found' } });
      if (!target) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Target ticket not found' } });
      if (source.merged_into_id) return reply.code(409).send({ success: false, error: { code: 'ALREADY_MERGED', message: 'Source ticket has already been merged' } });
      if (['closed','cancelled'].includes(source.status)) return reply.code(409).send({ success: false, error: { code: 'INVALID_STATUS', message: 'Cannot merge a closed or cancelled ticket' } });

      // Close source and mark merged; re-parent comments to target
      await db.withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE tickets SET merged_into_id = $1, status = 'closed', closed_at = NOW(), updated_at = NOW() WHERE id = $2`,
          [targetId, id],
        );
        // Re-parent comments so agent context isn't lost
        await client.query(
          `UPDATE ticket_comments SET ticket_id = $1 WHERE ticket_id = $2`,
          [targetId, id],
        );
      });

      await auditLog(db, { tenantId, ticketId: id, actorId: userId, actorName: null,
        action: 'status_changed', oldValue: { status: source.status }, newValue: { status: 'closed', merged_into: targetId },
        meta: { merged: true, target_ticket_number: target.ticket_number } });
      await auditLog(db, { tenantId, ticketId: targetId, actorId: userId, actorName: null,
        action: 'ticket_merged_in', newValue: { source_ticket: source.ticket_number, source_id: id },
        meta: { merged: true } });

      return reply.send({ success: true, data: { merged: source.ticket_number, into: target.ticket_number } });
    });

  };
}

// ── SLA Worker (lives in modules/ticketing/src/index.ts) ──────────────────
// The actual SLA worker runs in the TicketingPlatformModule's onLoad().
// This export is kept for backward compatibility only.

export async function runSlaWorker(db: DatabaseClient, eventBus: EventBus): Promise<void> {
  try {
    // ════════════════════════════════════════════════════════════════════
    // GAP 1: FIRST-RESPONSE SLA CHECK
    // Runs for all open/assigned tickets that have not yet received a first
    // response, where the SLA policy defines a first_response_hours limit.
    // ════════════════════════════════════════════════════════════════════
    const firstResponseTickets = await db.withSuperAdmin(async (client) => {
      const r = await client.query(
        `SELECT
           t.id, t.tenant_id, t.ticket_number, t.subject, t.priority,
           t.assignee_id, t.created_at, t.first_response_at,
           t.first_response_breached, t.first_response_warned,
           s.first_response_hours,
           s.id AS sla_policy_id
         FROM tickets t
         LEFT JOIN sla_policies s ON t.sla_policy_id = s.id
         WHERE t.status NOT IN ('resolved','closed')
           AND t.first_response_at IS NULL
           AND s.first_response_hours IS NOT NULL
           AND s.first_response_hours > 0`,
      );
      return r.rows;
    });

    for (const ticket of firstResponseTickets) {
      const now            = Date.now();
      const createdMs      = new Date(ticket.created_at).getTime();
      const deadlineMs     = createdMs + ticket.first_response_hours * 3_600_000;
      const totalMs        = deadlineMs - createdMs;
      const elapsedMs      = now - createdMs;
      const elapsedPct     = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 0;
      const remaining      = Math.round((deadlineMs - now) / 60_000); // minutes

      // Warning at 80% of first_response_hours
      if (elapsedPct >= 80 && !ticket.first_response_warned) {
        await db.withSuperAdmin(async (client) => {
          await client.query(
            `UPDATE tickets SET first_response_warned = true WHERE id = $1`,
            [ticket.id],
          );
        });
        const targets = ticket.assignee_id ? [ticket.assignee_id] : [];
        await notify(db, ticket.tenant_id, targets,
          'first_response_warning',
          `⚠️ First response due soon: ${ticket.ticket_number}`,
          `"${ticket.subject}" — First response required in ~${Math.max(0, remaining)} minutes. Please respond to the customer.`,
          ticket.id);
        await eventBus.publish(ticket.tenant_id, 'FIRST_RESPONSE_WARNING', {
          ticketId: ticket.id, minutesRemaining: Math.max(0, remaining),
        });
      }

      // Breach at 100%
      if (elapsedPct >= 100 && !ticket.first_response_breached) {
        const overMins = Math.round(-remaining);
        await db.withSuperAdmin(async (client) => {
          await client.query(
            `UPDATE tickets
             SET first_response_breached = true,
                 first_response_breached_at = NOW()
             WHERE id = $1`,
            [ticket.id],
          );
          // Insert audit record
          await client.query(
            `INSERT INTO ticket_escalations (tenant_id, ticket_id, escalation_level, reason, notified_users)
             VALUES ($1, $2, 0, 'first_response_breach', '[]')
             ON CONFLICT DO NOTHING`,
            [ticket.tenant_id, ticket.id],
          );
        });

        // Notify assignee + managers
        const managers = await db.withSuperAdmin(async (client) => {
          const r = await client.query(
            `SELECT id FROM users WHERE tenant_id = $1 AND role IN ('manager','tenant_admin') AND is_active = true`,
            [ticket.tenant_id],
          );
          return r.rows.map((u: any) => u.id as string);
        });
        const notifyIds = [...(ticket.assignee_id ? [ticket.assignee_id] : []), ...managers];

        await notify(db, ticket.tenant_id, notifyIds,
          'first_response_breach',
          `🚨 First response SLA breached: ${ticket.ticket_number}`,
          `"${ticket.subject}" — No first response was sent within ${ticket.first_response_hours}h. SLA breached by ${overMins} minute${overMins === 1 ? '' : 's'}. Please respond immediately.`,
          ticket.id);

        await eventBus.publish(ticket.tenant_id, 'FIRST_RESPONSE_BREACH', {
          ticketId: ticket.id, overMinutes: overMins,
          slaPolicyId: ticket.sla_policy_id,
        });
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // RESOLUTION SLA CHECK (existing logic — unchanged)
    // ════════════════════════════════════════════════════════════════════
    // Find all active (non-resolved/closed) tickets that have been accepted
    const activeTickets = await db.withSuperAdmin(async (client) => {
      const r = await client.query(
        `SELECT
           t.id, t.tenant_id, t.ticket_number, t.subject, t.priority,
           t.assignee_id, t.accepted_at, t.sla_due_at,
           t.escalation_level, t.reminder_sent_at,
           t.escalated_l1_at, t.escalated_l2_at,
           s.resolution_hours,
           s.reminder_pct,
           s.l1_escalation_pct,
           s.l2_escalation_pct
         FROM tickets t
         LEFT JOIN sla_policies s ON t.sla_policy_id = s.id
         WHERE t.accepted_at IS NOT NULL
           AND t.status NOT IN ('resolved','closed')
           AND t.sla_due_at IS NOT NULL`,
      );
      return r.rows;
    });

    for (const ticket of activeTickets) {
      const now          = Date.now();
      const acceptedMs   = new Date(ticket.accepted_at).getTime();
      const dueMs        = new Date(ticket.sla_due_at).getTime();
      const totalMs      = dueMs - acceptedMs;
      const elapsedMs    = now - acceptedMs;
      const elapsedPct   = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 0;

      const reminderPct  = ticket.reminder_pct      ?? 80;
      const l1Pct        = ticket.l1_escalation_pct ?? 100;
      const l2Pct        = ticket.l2_escalation_pct ?? 150;

      // ── Multi-step reminder schedule ─────────────────────────────────
      // Uses reminder_schedule if configured (new), else falls back to
      // legacy single reminder_pct field.
      const schedule: Array<{
        id: string; pct: number; level: string; label: string; notifyTarget: string;
      }> = Array.isArray(ticket.reminder_schedule) ? ticket.reminder_schedule : [];

      const sentMap: Record<string, boolean> = ticket.sla_reminders_sent ?? {};

      if (schedule.length > 0) {
        // ── New: iterate schedule steps ──────────────────────────────
        for (const step of schedule) {
          if (elapsedPct < step.pct) continue;  // not reached yet
          if (sentMap[step.id]) continue;        // already fired

          // Determine who to notify
          let notifyIds: string[] = [];
          if (step.notifyTarget === 'assignee' || step.notifyTarget === 'all') {
            if (ticket.assignee_id) notifyIds.push(ticket.assignee_id);
          }
          if (step.notifyTarget === 'managers' || step.notifyTarget === 'all') {
            const mgrs = await db.withSuperAdmin(async (c) => {
              const r = await c.query(
                `SELECT id FROM users WHERE tenant_id=$1 AND role IN ('manager','tenant_admin') AND is_active=true`,
                [ticket.tenant_id],
              );
              return r.rows.map((u: any) => u.id as string);
            });
            notifyIds = [...notifyIds, ...mgrs];
          }
          if (step.notifyTarget === 'admins' || step.notifyTarget === 'all') {
            const admins = await db.withSuperAdmin(async (c) => {
              const r = await c.query(
                `SELECT id FROM users WHERE tenant_id=$1 AND role='tenant_admin' AND is_active=true`,
                [ticket.tenant_id],
              );
              return r.rows.map((u: any) => u.id as string);
            });
            notifyIds = [...notifyIds, ...admins];
          }
          notifyIds = [...new Set(notifyIds)];

          // Mark step as sent
          sentMap[step.id] = true;
          await db.withSuperAdmin(async (c) => {
            await c.query(
              `UPDATE tickets SET sla_reminders_sent = $1::jsonb, reminder_sent_at = COALESCE(reminder_sent_at, NOW()) WHERE id = $2`,
              [JSON.stringify(sentMap), ticket.id],
            );
            // Insert escalation record for L1/L2 steps
            if (step.level === 'l1' && ticket.escalation_level < 1) {
              await c.query(
                `UPDATE tickets SET escalation_level=1, escalated_l1_at=COALESCE(escalated_l1_at,NOW()) WHERE id=$1`,
                [ticket.id],
              );
              await c.query(
                `INSERT INTO ticket_escalations(tenant_id,ticket_id,escalation_level,reason,notified_users) VALUES($1,$2,1,'sla_schedule',$3)`,
                [ticket.tenant_id, ticket.id, notifyIds],
              );
            } else if (step.level === 'l2' && ticket.escalation_level < 2) {
              await c.query(
                `UPDATE tickets SET escalation_level=2, escalated_l2_at=COALESCE(escalated_l2_at,NOW()) WHERE id=$1`,
                [ticket.id],
              );
              await c.query(
                `INSERT INTO ticket_escalations(tenant_id,ticket_id,escalation_level,reason,notified_users) VALUES($1,$2,2,'sla_schedule',$3)`,
                [ticket.tenant_id, ticket.id, notifyIds],
              );
            }
          });

          const remaining   = Math.round((dueMs - now) / 60_000);
          const overMins    = Math.round((now - dueMs) / 60_000);
          const levelEmoji  = step.level === 'l2' ? '🚨' : step.level === 'l1' ? '⚠️' : '⏰';
          const timeNote    = remaining > 0 ? `${remaining} min remaining` : `${overMins} min past deadline`;

          await notify(db, ticket.tenant_id, notifyIds,
            step.level === 'reminder' ? 'sla_reminder' : 'sla_breach',
            `${levelEmoji} ${step.label}: ${ticket.ticket_number}`,
            `"${ticket.subject}" — ${timeNote}.`,
            ticket.id);

          await eventBus.publish(ticket.tenant_id,
            step.level === 'reminder' ? CRM_EVENTS.SLA_REMINDER : CRM_EVENTS.SLA_BREACH,
            { ticketId: ticket.id, stepId: step.id, level: step.level });
        }
      } else {
        // ── Legacy: single reminder_pct check ───────────────────────
        if (elapsedPct >= reminderPct && !ticket.reminder_sent_at && ticket.assignee_id) {
          const remaining = Math.round((dueMs - now) / 60_000);
          await db.withSuperAdmin(async (c) => {
            await c.query(`UPDATE tickets SET reminder_sent_at = NOW() WHERE id = $1`, [ticket.id]);
          });
          await notify(db, ticket.tenant_id, [ticket.assignee_id],
            'sla_reminder',
            `⏰ SLA reminder: ${ticket.ticket_number}`,
            `"${ticket.subject}" — ${remaining > 0 ? `${remaining} minutes remaining` : 'SLA deadline approaching'}.`,
            ticket.id);
          await eventBus.publish(ticket.tenant_id, CRM_EVENTS.SLA_REMINDER, { ticketId: ticket.id });
        }
      }

      // ── L1 Escalation — supervisor/managers notified ─────────────────
      if (elapsedPct >= l1Pct && ticket.escalation_level < 1 && !ticket.escalated_l1_at) {
        const managers = await db.withSuperAdmin(async (c) => {
          const r = await c.query(
            `SELECT id FROM users
             WHERE tenant_id = $1 AND role IN ('manager','tenant_admin','super_admin')
               AND is_active = true`,
            [ticket.tenant_id],
          );
          return r.rows.map((u: any) => u.id as string);
        });

        const notifyIds = [
          ...(ticket.assignee_id ? [ticket.assignee_id] : []),
          ...managers,
        ].filter((v, i, a) => a.indexOf(v) === i); // dedupe

        await db.withSuperAdmin(async (c) => {
          await c.query(
            `UPDATE tickets SET escalation_level = 1, escalated_l1_at = NOW() WHERE id = $1`,
            [ticket.id],
          );
          await c.query(
            `INSERT INTO ticket_escalations (tenant_id, ticket_id, escalation_level, reason, notified_users)
             VALUES ($1,$2,1,'sla_breach',$3)`,
            [ticket.tenant_id, ticket.id, notifyIds],
          );
        });

        const overMins = Math.round((now - dueMs) / 60_000);
        await notify(db, ticket.tenant_id, notifyIds,
          'sla_breach',
          `🚨 SLA breached: ${ticket.ticket_number}`,
          `"${ticket.subject}" is ${overMins} min past the SLA deadline. Immediate attention required.`,
          ticket.id);

        await eventBus.publish(ticket.tenant_id, CRM_EVENTS.SLA_BREACH, {
          ticketId: ticket.id, escalationLevel: 1, overMinutes: overMins,
        });
      }

      // ── L2 Escalation — tenant admin notified ────────────────────────
      if (elapsedPct >= l2Pct && ticket.escalation_level < 2 && !ticket.escalated_l2_at) {
        const admins = await db.withSuperAdmin(async (c) => {
          const r = await c.query(
            `SELECT id FROM users
             WHERE tenant_id = $1 AND role IN ('tenant_admin','super_admin') AND is_active = true`,
            [ticket.tenant_id],
          );
          return r.rows.map((u: any) => u.id as string);
        });

        await db.withSuperAdmin(async (c) => {
          await c.query(
            `UPDATE tickets SET escalation_level = 2, escalated_l2_at = NOW() WHERE id = $1`,
            [ticket.id],
          );
          await c.query(
            `INSERT INTO ticket_escalations (tenant_id, ticket_id, escalation_level, reason, notified_users)
             VALUES ($1,$2,2,'timeout_l2',$3)`,
            [ticket.tenant_id, ticket.id, admins],
          );
        });

        const overMins = Math.round((now - dueMs) / 60_000);
        await notify(db, ticket.tenant_id, admins,
          'sla_escalated',
          `🔴 Critical escalation: ${ticket.ticket_number}`,
          `"${ticket.subject}" is ${overMins} min past the SLA deadline and has not been resolved. Escalated to you as highest authority.`,
          ticket.id);

        await eventBus.publish(ticket.tenant_id, CRM_EVENTS.TICKET_ESCALATED, {
          ticketId: ticket.id, escalationLevel: 2, overMinutes: overMins,
        });
      }
    }
  } catch (err: any) {
    // Worker errors must not crash the server
    console.error('[SLA Worker] Error:', err.message);
  }
}

// ── Default SLA seed ──────────────────────────────────────────────────────────
//
// Benchmarked against Zendesk, Freshdesk, and Jira Service Management defaults:
//   Urgent  — 1h first response / 4h resolution   (Zendesk critical / Freshdesk urgent)
//   High    — 2h first response / 8h resolution   (Zendesk high)
//   Medium  — 8h first response / 24h resolution  (Freshdesk medium / Jira SM normal)
//   Low     — 24h first response / 72h resolution (Zendesk low / Freshdesk low)
//
// All four tiers use business hours by default (industry standard).
// Escalation schedule mirrors Freshdesk/Zendesk three-tier pattern:
//   50% warning → agent, 75% warning → agent, 100% L1 breach → managers, 150% L2 → admins.

const DEFAULT_SLA_POLICIES = [
  {
    priority: 'urgent',
    name: 'Urgent — Fraud & Critical',
    description: 'Fraud alerts, account blocks, security incidents. 24/7 clock — business hours OFF.',
    first_response_hours: 1,
    resolution_hours: 4,
    business_hours_only: false,
    reminder_pct: 75,
    l1_escalation_pct: 100,
    l2_escalation_pct: 150,
    reminder_schedule: [
      { id: 'u1', pct: 50,  level: 'reminder', label: '50% Warning — Notify Agent',          notifyTarget: 'assignee' },
      { id: 'u2', pct: 75,  level: 'reminder', label: '75% Warning — Urgent Alert to Agent',  notifyTarget: 'assignee' },
      { id: 'u3', pct: 100, level: 'l1',       label: 'SLA Breached — Escalate to Managers', notifyTarget: 'managers' },
      { id: 'u4', pct: 150, level: 'l2',       label: 'Critical Breach — Notify All Admins', notifyTarget: 'admins'  },
    ],
  },
  {
    priority: 'high',
    name: 'High — Card & Loan Issues',
    description: 'Card disputes, loan queries, payment failures. Business hours.',
    first_response_hours: 2,
    resolution_hours: 8,
    business_hours_only: true,
    reminder_pct: 75,
    l1_escalation_pct: 100,
    l2_escalation_pct: 150,
    reminder_schedule: [
      { id: 'h1', pct: 50,  level: 'reminder', label: '50% Warning to Agent',               notifyTarget: 'assignee' },
      { id: 'h2', pct: 75,  level: 'reminder', label: '75% Final Warning to Agent',          notifyTarget: 'assignee' },
      { id: 'h3', pct: 100, level: 'l1',       label: 'SLA Breached — Notify Managers',     notifyTarget: 'managers' },
      { id: 'h4', pct: 150, level: 'l2',       label: 'Critical Breach — Notify Admins',    notifyTarget: 'admins'  },
    ],
  },
  {
    priority: 'medium',
    name: 'Medium — General Complaints',
    description: 'Service complaints, account queries, general support. Business hours.',
    first_response_hours: 8,
    resolution_hours: 24,
    business_hours_only: true,
    reminder_pct: 75,
    l1_escalation_pct: 100,
    l2_escalation_pct: 200,
    reminder_schedule: [
      { id: 'm1', pct: 50,  level: 'reminder', label: '50% Warning to Agent',               notifyTarget: 'assignee' },
      { id: 'm2', pct: 75,  level: 'reminder', label: '75% Warning — Act Now',               notifyTarget: 'assignee' },
      { id: 'm3', pct: 90,  level: 'reminder', label: '90% Final Warning',                   notifyTarget: 'assignee' },
      { id: 'm4', pct: 100, level: 'l1',       label: 'SLA Breached — Notify Managers',     notifyTarget: 'managers' },
      { id: 'm5', pct: 200, level: 'l2',       label: 'Severely Overdue — Notify Admins',   notifyTarget: 'admins'  },
    ],
  },
  {
    priority: 'low',
    name: 'Low — Balance & Info Queries',
    description: 'Balance checks, statement requests, informational queries. Business hours.',
    first_response_hours: 24,
    resolution_hours: 72,
    business_hours_only: true,
    reminder_pct: 75,
    l1_escalation_pct: 100,
    l2_escalation_pct: 200,
    reminder_schedule: [
      { id: 'l1', pct: 50,  level: 'reminder', label: '50% Warning to Agent',               notifyTarget: 'assignee' },
      { id: 'l2', pct: 75,  level: 'reminder', label: '75% Warning to Agent',                notifyTarget: 'assignee' },
      { id: 'l3', pct: 100, level: 'l1',       label: 'SLA Breached — Notify Managers',     notifyTarget: 'managers' },
      { id: 'l4', pct: 200, level: 'l2',       label: 'Long Overdue — Notify Admins',       notifyTarget: 'admins'  },
    ],
  },
];

export async function seedDefaultSlaPolicies(db: any, tenantId: string, sector?: string): Promise<void> {
  // Build sector-aware SLA policies if slaDefaults are configured for the sector
  let policies = DEFAULT_SLA_POLICIES;
  if (sector && sector !== 'other') {
    const cfg = getSector(sector as any);
    const slaDefaults = (cfg as any).slaDefaults as Array<{
      priority: string; name: string; description: string;
      first_response_hours: number; resolution_hours: number; business_hours_only: boolean;
    }> | undefined;
    if (slaDefaults?.length) {
      policies = slaDefaults.map((s, i) => ({
        ...s,
        reminder_pct: 75,
        l1_escalation_pct: 100,
        l2_escalation_pct: 150,
        reminder_schedule: [
          { id: `${s.priority}1`, pct: 50,  level: 'reminder', label: '50% Warning — Notify Agent',           notifyTarget: 'assignee' },
          { id: `${s.priority}2`, pct: 75,  level: 'reminder', label: '75% Warning — Urgent Alert to Agent',  notifyTarget: 'assignee' },
          { id: `${s.priority}3`, pct: 100, level: 'l1',       label: 'SLA Breached — Escalate to Managers',  notifyTarget: 'managers' },
          { id: `${s.priority}4`, pct: 150, level: 'l2',       label: 'Critical Breach — Notify All Admins',  notifyTarget: 'admins'  },
        ],
      }));
    }
  }

  await db.withTenant(tenantId, async (client: any) => {
    const existing = await client.query('SELECT COUNT(*) FROM sla_policies WHERE tenant_id = $1', [tenantId]);
    if (parseInt(existing.rows[0].count) > 0) return; // already seeded

    for (const p of policies) {
      await client.query(
        `INSERT INTO sla_policies
           (tenant_id, name, description, priority, first_response_hours, resolution_hours,
            reminder_pct, l1_escalation_pct, l2_escalation_pct, business_hours_only, is_active, reminder_schedule)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11)`,
        [
          tenantId, p.name, p.description, p.priority,
          p.first_response_hours, p.resolution_hours,
          p.reminder_pct, p.l1_escalation_pct, p.l2_escalation_pct,
          p.business_hours_only, JSON.stringify(p.reminder_schedule),
        ],
      );
    }
  });
}
