/**
 * Voice Bot routes — /api/v1/voice-bot
 *
 * Phase 1: Third-party AI voice bot integration.
 * Supported providers: Vapi, Retell AI, Bland.ai
 *
 * Flow:
 *   Customer calls helpline → Third-party AI answers via SIP
 *   → AI extracts complaint info → Provider sends webhook to us
 *   → We parse payload, create voice_bot_call record
 *   → If auto_create_ticket enabled → ticket created (channel='voice_bot')
 *
 * Webhook endpoints are PUBLIC (no auth — validated by signature instead):
 *   POST /api/v1/voice-bot/webhook/vapi
 *   POST /api/v1/voice-bot/webhook/retell
 *   POST /api/v1/voice-bot/webhook/bland
 *
 * Protected endpoints:
 *   GET  /api/v1/voice-bot/config            — get bot configuration
 *   PUT  /api/v1/voice-bot/config            — save bot configuration
 *   GET  /api/v1/voice-bot/calls             — list inbound bot calls
 *   GET  /api/v1/voice-bot/calls/:id         — single call detail
 *   POST /api/v1/voice-bot/calls/:id/ticket  — manually create ticket from a call
 *   GET  /api/v1/voice-bot/stats             — dashboard stats
 *   POST /api/v1/voice-bot/test-call         — initiate a test outbound call (Vapi/Retell)
 *   GET  /api/v1/voice-bot/webhook-url       — get the webhook URL to configure in provider
 */

import type { FastifyInstance } from 'fastify';
import { createHmac } from 'crypto';
import { z } from 'zod';
import type { DatabaseClient, EventBus } from '@crm/core';
import { CRM_EVENTS } from '@crm/core';
import { requireScope, requireRole, requireEntitlement } from '../middlewares/auth.middleware';
import { AccessToken, AgentDispatchClient } from 'livekit-server-sdk';
// pdf-parse's own type declarations expose its CJS module namespace as the
// default export's type rather than a callable function signature — a
// package-authored type declaration bug, not a real runtime issue (it is
// genuinely callable at runtime under esModuleInterop). Cast once here.
import pdfParseImport from 'pdf-parse';
const pdfParse = pdfParseImport as unknown as (data: Buffer) => Promise<{ text: string }>;
import mammoth from 'mammoth';

// ── Default IVR menu ─────────────────────────────────────────────────────
const DEFAULT_IVR_MENU = [
  { option: 1, intent: 'complaint', label: 'Register a complaint',        ticketType: 'complaint', description: 'Lodge a complaint about a product or service' },
  { option: 2, intent: 'inquiry',   label: 'Product & service enquiries', ticketType: 'inquiry',   description: 'Ask about our products and offerings'          },
  { option: 3, intent: 'sales',     label: 'Speak to a sales agent',      ticketType: 'sales',     description: 'Connect with our sales team'                   },
];

// ── IVR system prompt generator ───────────────────────────────────────────
function buildSystemPrompt(menu: typeof DEFAULT_IVR_MENU, customPrompt?: string): string {
  const menuText = menu.map(m => `  Press ${m.option} — ${m.label}: ${m.description}`).join('\n');
  const base = `You are a professional customer service voice assistant. When a customer calls:

1. Greet them warmly and introduce yourself.
2. Ask how you can help them today.
3. Present the following options:
${menuText}

For COMPLAINT (option 1):
- Collect the customer's full name, contact number, and email address.
- Ask them to describe their complaint clearly.
- Confirm the details back to the customer.
- Inform them a support ticket will be raised and they will receive a reference number.
- Set extracted_subject to a one-line summary of the complaint.
- Set extracted_priority based on urgency (urgent/high/medium/low).
- Set ticket_type to "complaint".

For INQUIRY (option 2):
- Answer questions about products and services professionally.
- If the customer is interested in purchasing, collect their name, number and email.
- Set ticket_type to "inquiry".
- Set intent to "sales_lead" if they want to buy.

For SALES (option 3):
- Collect the customer's name, number, and email.
- Ask about their requirements briefly.
- Inform them a sales representative will contact them.
- Set ticket_type to "sales".

Always be polite, concise and professional. Speak clearly.`;

  return customPrompt
    ? base + '\n\nAdditional instructions:\n' + customPrompt
    : base;
}


// ── Ticket extraction from call data ──────────────────────────────────────

const URGENCY_KEYWORDS = [
  'urgent', 'emergency', 'critical', 'asap', 'immediately', 'right now',
  'serious', 'severe', 'life', 'danger', 'broken', 'not working', 'outage',
];

function extractPriority(text: string, configured: string[] = []): 'urgent' | 'high' | 'medium' | 'low' {
  const lower = text.toLowerCase();
  const allKeywords = [...URGENCY_KEYWORDS, ...configured];
  if (allKeywords.some(k => lower.includes(k.toLowerCase()))) return 'urgent';
  if (lower.includes('important') || lower.includes('soon') || lower.includes('today')) return 'high';
  if (lower.includes('whenever') || lower.includes('low priority') || lower.includes('minor')) return 'low';
  return 'medium';
}

function extractSubject(summary: string, fallback: string): string {
  // Take the first sentence (up to 120 chars) of the AI summary
  const first = summary?.split(/[.!?]/)[0]?.trim();
  if (first && first.length > 10) return first.slice(0, 120);
  return fallback.slice(0, 120);
}

function extractSentiment(text: string): 'positive' | 'neutral' | 'negative' | 'urgent' {
  const lower = text.toLowerCase();
  if (URGENCY_KEYWORDS.some(k => lower.includes(k))) return 'urgent';
  const negWords = ['problem', 'issue', 'complaint', 'frustrated', 'unhappy', 'broken', 'fail', 'wrong', 'bad'];
  const posWords = ['great', 'happy', 'satisfied', 'pleased', 'wonderful', 'excellent', 'thank'];
  const negCount = negWords.filter(w => lower.includes(w)).length;
  const posCount = posWords.filter(w => lower.includes(w)).length;
  if (negCount > posCount) return 'negative';
  if (posCount > negCount) return 'positive';
  return 'neutral';
}

// ── Normalised call data (provider-agnostic) ─────────────────────────────

interface NormalisedCall {
  providerCallId: string;
  fromNumber: string;
  toNumber?: string;
  durationSeconds?: number;
  status: string;
  transcript?: string;
  summary?: string;
  recordingUrl?: string;
  extractedName?: string;
  extractedEmail?: string;
  startedAt?: Date;
  endedAt?: Date;
  rawPayload: Record<string, unknown>;
}

// ── Provider normalisation ────────────────────────────────────────────────

function normaliseVapi(body: Record<string, unknown>): NormalisedCall | null {
  // Vapi sends a top-level "type" field; we care about "end-of-call-report"
  const message = body.message as any;
  const type   = (body.type ?? message?.type ?? '') as string;
  const call   = (body.call ?? message?.call ?? body) as any;
  const analysis = (body.analysis ?? message?.analysis ?? {}) as any;

  if (!['end-of-call-report', 'call-ended', 'call.ended'].includes(type) && !call?.id) return null;

  const transcript = (body.transcript ?? message?.transcript ?? call?.transcript ?? '') as string;
  const summary    = (analysis?.summary ?? call?.summary ?? '') as string;

  return {
    providerCallId: (call?.id ?? call?.callId ?? '') as string,
    fromNumber:     (call?.customer?.number ?? call?.phoneNumber ?? '') as string,
    toNumber:       (call?.phoneNumber?.number ?? '') as string,
    durationSeconds: call?.duration ?? call?.durationSeconds,
    status: 'completed',
    transcript,
    summary: summary || transcript.slice(0, 500),
    recordingUrl: (call?.recordingUrl ?? call?.artifact?.recordingUrl) as string | undefined,
    extractedName:  (analysis?.customerName ?? call?.customer?.name) as string | undefined,
    extractedEmail: (analysis?.customerEmail) as string | undefined,
    startedAt: call?.startedAt ? new Date(call.startedAt) : undefined,
    endedAt:   call?.endedAt   ? new Date(call.endedAt)   : undefined,
    rawPayload: body,
  };
}

function normaliseRetell(body: Record<string, unknown>): NormalisedCall | null {
  const event = (body.event ?? '') as string;
  if (!['call_ended', 'call_analyzed'].includes(event) && !body.call_id) return null;

  const call     = (body.call ?? body) as any;
  const analysis = (call?.call_analysis ?? {}) as any;
  const transcript = (call?.transcript ?? body.transcript ?? '') as string;

  return {
    providerCallId: (call?.call_id ?? body.call_id ?? '') as string,
    fromNumber:     (call?.from_number ?? '') as string,
    toNumber:       (call?.to_number ?? '') as string,
    durationSeconds: call?.duration_ms ? Math.round(call.duration_ms / 1000) : undefined,
    status: 'completed',
    transcript,
    summary: (analysis?.call_summary ?? analysis?.summary ?? transcript.slice(0, 500)) as string,
    recordingUrl: (call?.recording_url) as string | undefined,
    extractedName:  (analysis?.custom_analysis_data?.customer_name ?? analysis?.caller_name) as string | undefined,
    extractedEmail: (analysis?.custom_analysis_data?.customer_email) as string | undefined,
    startedAt: call?.start_timestamp ? new Date(call.start_timestamp) : undefined,
    endedAt:   call?.end_timestamp   ? new Date(call.end_timestamp)   : undefined,
    rawPayload: body,
  };
}

function normaliseBland(body: Record<string, unknown>): NormalisedCall | null {
  // Bland sends the call data directly
  if (!body.call_id && !body.c_id) return null;

  const transcript = (body.transcript ?? body.concatenated_transcript ?? '') as string;
  const summary    = (body.summary ?? '') as string;

  return {
    providerCallId: (body.call_id ?? body.c_id ?? '') as string,
    fromNumber:     (body.from   ?? body.phone_number ?? '') as string,
    toNumber:       (body.to     ?? '') as string,
    durationSeconds: body.call_length ? Math.round(Number(body.call_length) * 60) : undefined,
    status: (body.status ?? 'completed') as string,
    transcript,
    summary: summary || transcript.slice(0, 500),
    recordingUrl: (body.recording_url) as string | undefined,
    extractedName:  ((body.variables as any)?.customer_name ?? (body.metadata as any)?.customer_name) as string | undefined,
    extractedEmail: ((body.variables as any)?.customer_email ?? (body.metadata as any)?.customer_email) as string | undefined,
    startedAt: body.start_time ? new Date(body.start_time as string) : undefined,
    endedAt:   body.end_time   ? new Date(body.end_time   as string) : undefined,
    rawPayload: body,
  };
}

const NORMALISERS: Record<string, (body: Record<string, unknown>) => NormalisedCall | null> = {
  vapi:   normaliseVapi,
  retell: normaliseRetell,
  bland:  normaliseBland,
};

// ── Webhook signature validation ──────────────────────────────────────────

function verifyWebhookSignature(
  provider: string,
  secret: string,
  body: string,
  headers: Record<string, string | string[] | undefined>,
): boolean {
  if (!secret) return true; // no secret configured → skip (dev mode)

  const header = (key: string) => {
    const v = headers[key];
    return Array.isArray(v) ? v[0] : (v ?? '');
  };

  try {
    switch (provider) {
      case 'vapi': {
        // Vapi uses HMAC-SHA256 on the raw body, header: x-vapi-signature
        const sig = header('x-vapi-signature');
        const expected = createHmac('sha256', secret).update(body).digest('hex');
        return sig === expected || sig === `sha256=${expected}`;
      }
      case 'retell': {
        const sig = header('x-retell-signature');
        const expected = createHmac('sha256', secret).update(body).digest('hex');
        return sig === expected;
      }
      case 'bland': {
        const sig = header('x-bland-signature') || header('authorization');
        if (sig === secret) return true;
        const expected = createHmac('sha256', secret).update(body).digest('hex');
        return sig === expected;
      }
      default:
        return true;
    }
  } catch {
    return false;
  }
}

// ── Ticket creation from normalised call ─────────────────────────────────

async function createTicketFromBotCall(
  db: DatabaseClient,
  eventBus: EventBus,
  tenantId: string,
  botCallId: string,
  call: NormalisedCall,
  config: any,
): Promise<string | null> {
  try {
    const fullText = [call.summary, call.transcript].filter(Boolean).join(' ');
    const priority = extractPriority(fullText, config?.keyword_urgency ?? []) as string;

    const subject = extractSubject(
      call.summary ?? '',
      `Support request from ${call.fromNumber || 'caller'}`,
    );

    const description = [
      call.summary ? `Summary: ${call.summary}` : null,
      call.transcript ? `\nTranscript:\n${call.transcript.slice(0, 2000)}` : null,
    ].filter(Boolean).join('\n');

    // Find existing contact by phone, or create one so the ticket appears on Contact 360
    const contact = await (async () => {
      const normalised = call.fromNumber?.replace(/\D/g, '').slice(-10) ?? null;

      // 1. Try to find by phone or mobile
      if (normalised) {
        const [existing] = await db.withSuperAdmin(async (c) => {
          const r = await c.query(
            `SELECT id FROM contacts WHERE tenant_id = $1
               AND (phone ILIKE $2 OR mobile ILIKE $2)
             LIMIT 1`,
            [tenantId, `%${normalised}%`],
          );
          return r.rows;
        });
        if (existing) return existing;
      }

      // 2. Not found — create a new contact from whatever CLI + bot collected.
      //    Even if the caller refused to share details, CLI number is always captured.
      let firstName: string;
      let lastName: string | null;
      if (call.extractedName) {
        const nameParts = call.extractedName.trim().split(/\s+/);
        firstName = nameParts[0] ?? 'Caller';
        lastName  = nameParts.slice(1).join(' ') || null;
      } else {
        // Caller did not share their name — use "Caller" so the contact is human-readable
        firstName = 'Caller';
        lastName  = null;
      }
      const tags = call.extractedName ? ['voice_bot'] : ['voice_bot', 'anonymous'];
      const [created] = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `INSERT INTO contacts
             (tenant_id, first_name, last_name, phone, email, source, tags, custom_fields)
           VALUES ($1, $2, $3, $4, $5, 'voice_bot', $6, '{}')
           RETURNING id`,
          [tenantId, firstName, lastName, call.fromNumber ?? null, call.extractedEmail ?? null, tags],
        );
        return r.rows;
      });
      return created ?? null;
    })();

    const [{ next_val }] = (await db.withSuperAdmin(async (c) =>
      (await c.query(
        `INSERT INTO ticket_counters (tenant_id, next_val) VALUES ($1, 2)
         ON CONFLICT (tenant_id) DO UPDATE SET next_val = ticket_counters.next_val + 1
         RETURNING next_val`,
        [tenantId],
      )).rows,
    ));
    const ticketNumber = `TKT-${String(Number(next_val) - 1).padStart(5, '0')}`;

    const [queueRow] = await db.withSuperAdmin(async (c) => {
      if (config?.default_queue_id) {
        const r = await c.query(
          `SELECT id FROM ticket_queues WHERE id = $1 AND tenant_id = $2`,
          [config.default_queue_id, tenantId],
        );
        if (r.rows.length) return r.rows;
      }
      const r = await c.query(
        `SELECT id FROM ticket_queues WHERE tenant_id = $1 AND is_default = true LIMIT 1`,
        [tenantId],
      );
      return r.rows;
    });

    const [slaRow] = await db.withSuperAdmin(async (c) => {
      const r = await c.query(
        `SELECT id FROM sla_policies WHERE tenant_id = $1 AND priority = $2 AND is_active = true LIMIT 1`,
        [tenantId, priority],
      );
      return r.rows;
    });

    // Detect ticket_type from IVR menu intent (extracted from transcript/summary)
    const ivrMenu = config?.ivr_menu ?? DEFAULT_IVR_MENU;
    let ticketType = 'complaint';
    if (call.summary || call.transcript) {
      const text = (call.summary ?? '') + ' ' + (call.transcript ?? '');
      const lower = text.toLowerCase();
      if (lower.includes('sales') || lower.includes('buy') || lower.includes('purchase') || lower.includes('price') || lower.includes('offer')) {
        ticketType = 'sales';
      } else if (lower.includes('inquiry') || lower.includes('enquiry') || lower.includes('information') || lower.includes('product') || lower.includes('service')) {
        ticketType = 'inquiry';
      }
    }

    // Use queue from IVR menu for this ticket type if configured
    const ivrOption = ivrMenu.find((m: any) => m.ticketType === ticketType || m.intent === ticketType);
    const resolvedQueueId = ivrOption?.queueId ?? queueRow?.id ?? null;

    const [ticket] = await db.withSuperAdmin(async (c) => {
      const r = await c.query(
        `INSERT INTO tickets
           (tenant_id, ticket_number, subject, description, status, priority, channel,
            queue_id, sla_policy_id, contact_id, reporter_phone, reporter_name, reporter_email,
            ticket_type, tags, custom_fields)
         VALUES ($1,$2,$3,$4,'open',$5,'voice_bot',$6,$7,$8,$9,$10,$11,$12,'{}','{}')
         RETURNING *`,
        [
          tenantId, ticketNumber, subject, description, priority,
          resolvedQueueId,
          slaRow?.id   ?? null,
          contact?.id  ?? null,
          call.fromNumber       ?? null,
          call.extractedName    ?? null,
          call.extractedEmail   ?? null,
          ticketType,
        ],
      );
      return r.rows;
    });

    // Load milestone template for this ticket type
    const [milestoneTemplate] = await db.withSuperAdmin(async (c) => {
      const r = await c.query(
        `SELECT steps FROM ticket_milestone_templates WHERE tenant_id = $1 AND ticket_type = $2`,
        [tenantId, ticketType],
      );
      return r.rows;
    });
    if (milestoneTemplate?.steps?.length > 0) {
      await db.withSuperAdmin(async (c) => {
        await c.query(
          `UPDATE tickets SET milestones = $1::jsonb WHERE id = $2`,
          [JSON.stringify(milestoneTemplate.steps.map((s: any, idx: number) => ({ ...s, completed: false, order: idx }))), ticket.id],
        );
      });
    }

    // Link ticket back to the voice_bot_call record
    await db.withSuperAdmin(async (c) => {
      await c.query(
        `UPDATE voice_bot_calls SET ticket_id = $1 WHERE id = $2`,
        [ticket.id, botCallId],
      );
    });

    // Push routing — auto-assign if queue is configured for push
    const [qCfg] = await db.withSuperAdmin(async (c) => {
      if (!resolvedQueueId) return [];
      const r = await c.query(`SELECT routing_method FROM ticket_queues WHERE id = $1`, [resolvedQueueId]);
      return r.rows;
    });
    if (qCfg?.routing_method === 'push_random' || qCfg?.routing_method === 'push_criteria') {
      const agents = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `SELECT id FROM users WHERE tenant_id=$1 AND is_active=true AND role IN ('agent','manager') ORDER BY id`,
          [tenantId],
        );
        return r.rows.map((u: any) => u.id as string);
      });
      if (agents.length > 0) {
        const chosen = agents[Math.floor(Math.random() * agents.length)];
        await db.withSuperAdmin(async (c) => {
          await c.query(
            `UPDATE tickets SET assignee_id=$1, status='assigned' WHERE id=$2`,
            [chosen, ticket.id],
          );
        });
      }
    }

    await eventBus.publish(tenantId, CRM_EVENTS.TICKET_CREATED, {
      source: 'voice_bot', ticketId: ticket.id, ticketType,
    });

    return ticket.id as string;
  } catch (err: any) {
    console.error('[VoiceBot→Ticket]', err.message);
    return null;
  }
}

// ── LiveKit (self-hosted Urdu agent "Nadia") — structured complaint → ticket ──
// Unlike the keyword-derived path above, this trusts the agent's explicit fields
// (it has already extracted priority/category/subject accurately in Urdu).

const PRIORITY_MAP: Record<string, 'urgent' | 'high' | 'medium' | 'low'> = {
  p1: 'urgent', p2: 'high', p3: 'medium', p4: 'low',
  urgent: 'urgent', high: 'high', medium: 'medium', low: 'low',
};

interface StructuredComplaint {
  reporterName?: string;
  reporterPhone?: string;
  reporterEmail?: string;
  reporterNic?: string;
  reporterAddress?: string;
  reporterCity?: string;
  category?: string;   // loan_issue | account_issue | staff_complaint | digital_banking | fraud | branch_service | other
  priority?: string;   // P1..P4 or urgent..low
  subject?: string;
  description?: string;
  fraudAmount?: string;
  transcript?: string;
  callId?: string;
}

// Checks a tenant's Voice Bot minute usage against 70/90/100% of its
// allocation and fires a one-time notification (both to the tenant's own
// admins and to the platform's Super Admin) the first time each threshold
// is crossed. Safe to call after every completed call — `notified_*`
// flags on voice_bot_quotas make it a no-op once a threshold has already
// fired, and a top-up resets them so the next cycle can notify again.
async function checkVoiceBotUsageThresholds(db: DatabaseClient, tenantId: string): Promise<void> {
  await db.withSuperAdmin(async (c) => {
    const [quota] = (await c.query(
      `SELECT minutes_allocated, notified_70, notified_90, notified_100 FROM voice_bot_quotas WHERE tenant_id = $1`,
      [tenantId],
    )).rows;
    if (!quota || !quota.minutes_allocated) return; // no allocation set — nothing to threshold against

    const [consumed] = (await c.query(
      `SELECT COALESCE(SUM(duration_seconds), 0) AS total_seconds FROM voice_bot_calls WHERE tenant_id = $1`,
      [tenantId],
    )).rows;
    const allocated = Number(quota.minutes_allocated);
    const consumedMinutes = Number(consumed.total_seconds) / 60;
    const pct = (consumedMinutes / allocated) * 100;

    // Fire EVERY crossed-but-not-yet-notified threshold, ascending — a
    // single long call can jump straight past 70% to 100%, and skipping
    // the 90% notice in that case would be a real gap, not just a nicety.
    const thresholds: Array<{ level: 70 | 90 | 100; notified: boolean; col: string }> = [
      { level: 70,  notified: quota.notified_70,  col: 'notified_70'  },
      { level: 90,  notified: quota.notified_90,  col: 'notified_90'  },
      { level: 100, notified: quota.notified_100, col: 'notified_100' },
    ];
    const toFire = thresholds.filter(t => pct >= t.level && !t.notified);
    if (toFire.length === 0) return;

    const [tenantRow] = (await c.query(`SELECT name FROM tenants WHERE id = $1`, [tenantId])).rows;
    const tenantName = tenantRow?.name ?? 'A workspace';
    const admins = (await c.query(
      `SELECT id FROM users WHERE tenant_id = $1 AND role = 'tenant_admin' AND is_active = true`,
      [tenantId],
    )).rows;

    for (const t of toFire) {
      const title = t.level === 100
        ? `${tenantName}: Voice Bot minutes exhausted`
        : `${tenantName}: Voice Bot at ${t.level}% of allocated minutes`;
      const body = t.level === 100
        ? `All allocated voice bot minutes have been used. New calls will no longer be answered by the bot until more minutes are added.`
        : `${consumedMinutes.toFixed(0)} of ${allocated.toFixed(0)} minutes used (${pct.toFixed(0)}%).`;

      // Notify every tenant_admin in this tenant, via the same
      // notifications table/bell every other in-app notification uses.
      for (const admin of admins) {
        await c.query(
          `INSERT INTO notifications (tenant_id, user_id, type, title, body, entity_type, entity_id)
           VALUES ($1, $2, 'voice_bot_minutes_threshold', $3, $4, 'voice_bot_quota', $5)`,
          [tenantId, admin.id, title, body, tenantId],
        );
      }
      // Notify Super Admin at the platform level (not tenant-scoped).
      await c.query(
        `INSERT INTO platform_notifications (type, title, body, tenant_id, entity_type, entity_id)
         VALUES ('voice_bot_minutes_threshold', $1, $2, $3, 'voice_bot_quota', $3)`,
        [title, body, tenantId],
      );
      await c.query(`UPDATE voice_bot_quotas SET ${t.col} = true WHERE tenant_id = $1`, [tenantId]);
    }
  });
}

type ContactMatch = {
  id: string;
  confidence: 'strong' | 'weak';
  first_name: string | null;
  email: string | null;
  nic_number: string | null;
  custom_fields: any;
};

// Matching rule (per user decision 2026-07-17): a "strong" match requires
// at least TWO of {phone, NIC, email} to agree with the SAME existing
// contact — much less likely to be a coincidence/typo than any single
// field. If the caller only gave ONE identifier this call (very common —
// people asking a quick question rarely share much), we still match on
// that one field alone, but flag it "weak": the caller hasn't proven it's
// really them yet, so Nadia should read back something safe (first name)
// to confirm before treating it as verified. Never creates a contact —
// callers only use this for read-only identity lookups.
async function matchContact(
  c: { query: (sql: string, params: any[]) => Promise<{ rows: any[] }> },
  tenantId: string,
  identifiers: { phone?: string | null; nic?: string | null; email?: string | null },
): Promise<ContactMatch | null> {
  const normalisedPhone = identifiers.phone?.replace(/\D/g, '').slice(-10) || null;
  const nic = identifiers.nic?.trim() || null;
  const email = identifiers.email?.trim().toLowerCase() || null;

  const fieldClause = (field: 'phone' | 'nic' | 'email', params: any[]): string => {
    if (field === 'phone') { params.push(`%${normalisedPhone}%`); return `(phone ILIKE $${params.length} OR mobile ILIKE $${params.length})`; }
    if (field === 'nic') { params.push(nic); return `nic_number = $${params.length}`; }
    params.push(email); return `LOWER(email) = $${params.length}`;
  };

  const given: Array<'phone' | 'nic' | 'email'> = [
    ...(normalisedPhone ? (['phone'] as const) : []),
    ...(nic ? (['nic'] as const) : []),
    ...(email ? (['email'] as const) : []),
  ];

  // Strong: try every pair of given identifiers, first pair to hit wins.
  if (given.length >= 2) {
    for (let i = 0; i < given.length; i++) {
      for (let j = i + 1; j < given.length; j++) {
        const params: any[] = [tenantId];
        const a = fieldClause(given[i], params);
        const b = fieldClause(given[j], params);
        const r = await c.query(
          `SELECT id, first_name, email, nic_number, custom_fields FROM contacts
           WHERE tenant_id=$1 AND (${a}) AND (${b}) LIMIT 1`,
          params,
        );
        if (r.rows.length) return { ...r.rows[0], confidence: 'strong' };
      }
    }
  }

  // Weak fallback: whichever single identifiers were given, OR'd together.
  if (given.length >= 1) {
    const params: any[] = [tenantId];
    const clauses = given.map((f) => fieldClause(f, params));
    const r = await c.query(
      `SELECT id, first_name, email, nic_number, custom_fields FROM contacts
       WHERE tenant_id=$1 AND (${clauses.join(' OR ')}) LIMIT 1`,
      params,
    );
    if (r.rows.length) return { ...r.rows[0], confidence: 'weak' };
  }

  return null;
}

async function createComplaintFromStructured(
  db: DatabaseClient,
  eventBus: EventBus,
  tenantId: string,
  s: StructuredComplaint,
): Promise<{ ticketId: string; ticketNumber: string; voiceCallId: string } | null> {
  try {
    const priority = PRIORITY_MAP[(s.priority || 'medium').toLowerCase()] ?? 'medium';
    const subject = (s.subject || s.description || 'Voice complaint').slice(0, 120);
    const description = s.description || s.subject || '';

    // Idempotent retry: if THIS call already produced a ticket in the SAME
    // category, return that existing ticket instead of creating a duplicate.
    // Found live 2026-07-18: the first attempt's success response can get
    // lost mid-conversation (turn interrupted/cancelled), so the bot retries
    // an already-created ticket — the retry should hand back the original
    // ticket number, not mint a second ticket for the same issue. A retry
    // with a DIFFERENT category is treated as a genuinely separate issue
    // (the script explicitly supports multiple tickets per call).
    if (s.callId && s.category) {
      const [dup] = await db.withSuperAdmin(async (c) =>
        (await c.query(
          `SELECT t.id, t.ticket_number, vbc.id AS voice_call_id
             FROM tickets t
             JOIN voice_bot_calls vbc
               ON vbc.provider = 'livekit' AND vbc.provider_call_id = $2 AND vbc.tenant_id = t.tenant_id
            WHERE t.tenant_id = $1
              AND t.custom_fields->>'call_id' = $2
              AND t.custom_fields->>'category' = $3
            LIMIT 1`,
          [tenantId, s.callId, s.category],
        )).rows);
      if (dup) {
        return { ticketId: dup.id, ticketNumber: dup.ticket_number, voiceCallId: dup.voice_call_id };
      }
    }

    // These five lookups/inserts are mutually independent — none needs
    // another's result — so run them concurrently instead of one at a time.
    // Each `db.withSuperAdmin` round-trips to a REMOTE (Supabase) database;
    // sequentially that was 5 of the 7 total round-trips in this function,
    // the dominant cost in the ~5s+ ticket-creation delay reported live
    // 2026-07-13. Cuts this function from 7 sequential round-trips to 3.
    const [[contact], [{ next_val }], [queueRow], [slaRow], [botCall], [config]] = await Promise.all([
      db.withSuperAdmin(async (c) => {
        const nic = s.reporterNic?.trim() || null;
        const addressFields = s.reporterAddress || s.reporterCity
          ? { address: s.reporterAddress ?? null, city: s.reporterCity ?? null }
          : null;

        const existing = await matchContact(c, tenantId, {
          phone: s.reporterPhone, nic, email: s.reporterEmail,
        });
        if (existing) {
          // Existing caller (strong or weak match) — fill in any details we
          // didn't have before, never overwrite something already on file.
          // Ticket-creation time always merges regardless of confidence —
          // it's the mid-call identity check (lookup-contact endpoint,
          // below) that treats "weak" as needing a spoken confirmation
          // before Nadia relies on it.
          const mergedCustomFields = addressFields
            ? { ...addressFields, ...existing.custom_fields }
            : existing.custom_fields;
          await c.query(
            `UPDATE contacts SET
               phone = COALESCE(phone, $2),
               email = COALESCE(email, $3),
               nic_number = COALESCE(nic_number, $4),
               custom_fields = $5::jsonb
             WHERE id = $1`,
            [existing.id, s.reporterPhone ?? null, s.reporterEmail ?? null, nic, JSON.stringify(mergedCustomFields ?? {})],
          );
          return [{ id: existing.id }];
        }
        // New caller — create a contact so this call/ticket shows up on a
        // unified Contact 360 timeline, same as every other channel does.
        let firstName = 'Caller';
        let lastName: string | null = null;
        if (s.reporterName) {
          const parts = s.reporterName.trim().split(/\s+/);
          firstName = parts[0] ?? 'Caller';
          lastName = parts.slice(1).join(' ') || null;
        }
        const tags = s.reporterName ? ['voice_bot'] : ['voice_bot', 'anonymous'];
        const created = await c.query(
          `INSERT INTO contacts
             (tenant_id, first_name, last_name, phone, email, nic_number, source, tags, custom_fields)
           VALUES ($1, $2, $3, $4, $5, $6, 'voice_bot', $7, $8::jsonb)
           RETURNING id`,
          [tenantId, firstName, lastName, s.reporterPhone ?? null, s.reporterEmail ?? null,
           s.reporterNic ?? null, tags, JSON.stringify(addressFields ?? {})],
        );
        return created.rows;
      }),
      db.withSuperAdmin(async (c) =>
        (await c.query(
          `INSERT INTO ticket_counters (tenant_id, next_val) VALUES ($1, 2)
           ON CONFLICT (tenant_id) DO UPDATE SET next_val = ticket_counters.next_val + 1
           RETURNING next_val`, [tenantId])).rows),
      db.withSuperAdmin(async (c) =>
        (await c.query(`SELECT id FROM ticket_queues WHERE tenant_id=$1 AND is_default=true LIMIT 1`, [tenantId])).rows),
      db.withSuperAdmin(async (c) =>
        (await c.query(`SELECT id FROM sla_policies WHERE tenant_id=$1 AND priority=$2 AND is_active=true LIMIT 1`, [tenantId, priority])).rows),
      db.withSuperAdmin(async (c) =>
        (await c.query(
          // Upsert, not plain insert: a second raise_ticket in the SAME call
          // (a genuinely separate second complaint — which the bot's script
          // explicitly supports — or a retry after a failure) reuses the
          // call row instead of colliding with uq_voice_bot_calls_provider_
          // call_id and 500ing. Found live 2026-07-18 on the second ticket
          // attempt of a browser test call.
          `INSERT INTO voice_bot_calls
             (tenant_id, provider, provider_call_id, from_number, status, transcript, summary,
              sentiment, extracted_subject, extracted_priority, extracted_reporter_name,
              extracted_reporter_email, raw_payload)
           VALUES ($1,'livekit',$2,$3,'completed',$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
           ON CONFLICT (provider, provider_call_id) DO UPDATE SET
             transcript         = COALESCE(EXCLUDED.transcript, voice_bot_calls.transcript),
             summary            = EXCLUDED.summary,
             extracted_subject  = EXCLUDED.extracted_subject,
             extracted_priority = EXCLUDED.extracted_priority
           RETURNING id`,
          [tenantId, s.callId ?? null, s.reporterPhone ?? null, s.transcript ?? null, description,
           priority === 'urgent' ? 'urgent' : 'negative', subject, priority,
           s.reporterName ?? null, s.reporterEmail ?? null,
           JSON.stringify({ category: s.category, fraudAmount: s.fraudAmount })],
        )).rows),
      db.withSuperAdmin(async (c) =>
        (await c.query(`SELECT default_queue_id, ivr_menu FROM voice_bot_configs WHERE tenant_id=$1 AND provider='livekit'`, [tenantId])).rows),
    ]);
    const ticketNumber = `TKT-${String(Number(next_val) - 1).padStart(5, '0')}`;

    // Route by department/intent, same as the other bot providers — a fraud or
    // sales-flagged call should not just land in whatever queue is "default".
    // If the LLM already classified the call with an exact segment key
    // (sales / inquiry / complaint), trust its explicit decision — keyword
    // scanning the whole transcript misroutes easily (e.g. a COMPLAINT
    // about a "product" contains the word "product", which used to flip it
    // into the inquiry queue). The keyword scan remains only as the
    // fallback for legacy/sector-specific category keys (loan_issue etc.).
    const ivrMenu = config?.ivr_menu ?? DEFAULT_IVR_MENU;
    const exactCategory = (s.category ?? '').trim().toLowerCase();
    let ticketType = 'complaint';
    if (exactCategory === 'sales' || exactCategory === 'inquiry' || exactCategory === 'complaint') {
      ticketType = exactCategory;
    } else {
      const text = (exactCategory + ' ' + (s.subject ?? '') + ' ' + (s.description ?? '') + ' ' + (s.transcript ?? '')).toLowerCase();
      if (text.includes('sales') || text.includes('buy') || text.includes('purchase') || text.includes('price') || text.includes('offer')) {
        ticketType = 'sales';
      } else if (text.includes('inquiry') || text.includes('enquiry') || text.includes('information') || text.includes('product') || text.includes('service')) {
        ticketType = 'inquiry';
      }
    }
    const ivrOption = ivrMenu.find((m: any) => m.ticketType === ticketType || m.intent === ticketType);
    let resolvedQueueId = ivrOption?.queueId ?? queueRow?.id ?? null;
    if (ivrOption?.queueId) {
      // Confirm the IVR-configured queue still belongs to this tenant before trusting it.
      const [ivrQueue] = await db.withSuperAdmin(async (c) =>
        (await c.query(`SELECT id FROM ticket_queues WHERE id=$1 AND tenant_id=$2`, [ivrOption.queueId, tenantId])).rows);
      resolvedQueueId = ivrQueue?.id ?? queueRow?.id ?? null;
    }

    const [ticket] = await db.withSuperAdmin(async (c) =>
      (await c.query(
        `INSERT INTO tickets
           (tenant_id, ticket_number, subject, description, status, priority, channel,
            queue_id, sla_policy_id, contact_id, reporter_phone, reporter_name, reporter_email,
            ticket_type, tags, custom_fields)
         VALUES ($1,$2,$3,$4,'open',$5,'voice_bot',$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
         RETURNING id`,
        [tenantId, ticketNumber, subject, description, priority,
         resolvedQueueId, slaRow?.id ?? null, contact?.id ?? null,
         s.reporterPhone ?? null, s.reporterName ?? null, s.reporterEmail ?? null,
         // Was hardcoded to the literal 'complaint' regardless of the sales/inquiry
         // classification computed above — meant a voice-bot sales enquiry routed to
         // the right queue but could never satisfy the accept-time
         // `ticket.ticket_type === 'sales'` check that creates a pipeline deal
         // (tickets.ts POST /:id/accept). Now persists the actual computed type.
         ticketType,
         [s.category ?? 'other'],
         JSON.stringify({ category: s.category, fraud_amount: s.fraudAmount, agent: 'nadia', call_id: s.callId ?? null })],
      )).rows);

    await db.withSuperAdmin(async (c) => {
      await c.query(`UPDATE voice_bot_calls SET ticket_id=$1 WHERE id=$2`, [ticket.id, botCall.id]);
    });

    // Push routing — auto-assign if queue is configured for push
    if (resolvedQueueId) {
      try {
        const [qCfg] = await db.withSuperAdmin(async (c) => {
          const r = await c.query(`SELECT routing_method FROM ticket_queues WHERE id = $1`, [resolvedQueueId]);
          return r.rows;
        });
        if (qCfg?.routing_method === 'push_random' || qCfg?.routing_method === 'push_criteria') {
          const agents = await db.withSuperAdmin(async (c) => {
            const r = await c.query(
              `SELECT u.id FROM queue_members qm
               JOIN users u ON u.id = qm.user_id
               WHERE qm.queue_id=$1 AND u.tenant_id=$2 AND u.is_active=true AND u.role IN ('agent','manager')
               ORDER BY u.id`,
              [resolvedQueueId, tenantId],
            );
            return r.rows.map((u: any) => u.id as string);
          });
          if (agents.length > 0) {
            const chosen = agents[Math.floor(Math.random() * agents.length)];
            await db.withSuperAdmin(async (c) => {
              await c.query(`UPDATE tickets SET assignee_id=$1, status='assigned' WHERE id=$2`, [chosen, ticket.id]);
            });
          }
        }
      } catch (routingErr: any) {
        // A routing failure must never undo an already-created ticket.
        console.error('[LiveKit→Ticket] routing failed (ticket still created)', routingErr.message);
      }
    }

    await eventBus.publish(tenantId, CRM_EVENTS.TICKET_CREATED, {
      source: 'livekit', ticketId: ticket.id, ticketType: 'complaint',
    });

    return { ticketId: ticket.id as string, ticketNumber, voiceCallId: botCall.id as string };
  } catch (err: any) {
    console.error('[LiveKit→Ticket]', err.message);
    return null;
  }
}

// ── Intent detection from call transcript/summary ────────────────────────
// Returns a canonical intent string used to match against self_service_intents config.

const INTENT_PATTERNS: Array<{ intent: string; keywords: string[] }> = [
  { intent: 'balance_inquiry',  keywords: ['balance', 'account balance', 'how much', 'funds', 'available amount'] },
  { intent: 'order_status',     keywords: ['order status', 'where is my order', 'delivery', 'track', 'shipment', 'dispatch'] },
  { intent: 'branch_hours',     keywords: ['opening hours', 'branch hours', 'what time', 'when do you open', 'when do you close', 'working hours'] },
  { intent: 'installment_info', keywords: ['installment', 'remaining', 'emi', 'monthly payment', 'loan balance', 'how many installments'] },
  { intent: 'faq',              keywords: ['how to', 'how do i', 'what is', 'tell me about', 'explain', 'information about'] },
  { intent: 'complaint',        keywords: ['complaint', 'issue', 'problem', 'not working', 'broken', 'fraud', 'error'] },
  { intent: 'inquiry',          keywords: ['inquiry', 'enquiry', 'question', 'product', 'service', 'offering'] },
  { intent: 'sales',            keywords: ['buy', 'purchase', 'price', 'offer', 'quote', 'sales', 'interested in'] },
];

function detectIntent(call: NormalisedCall, customIntents: Array<{ intent: string; keywords: string[] }> = []): string {
  const text = ((call.summary ?? '') + ' ' + (call.transcript ?? '')).toLowerCase();
  // Tenant-defined custom intents are checked first so they can override the built-ins.
  for (const { intent, keywords } of [...customIntents, ...INTENT_PATTERNS]) {
    if (keywords.some(k => text.includes(k))) return intent;
  }
  return 'complaint'; // default — safest fallback always creates a ticket
}

// Tenant's own "answer, don't create a ticket" reasons, added via the admin screen
// on top of the 8 built-in INTENT_PATTERNS above.
async function getCustomIntents(db: DatabaseClient, tenantId: string) {
  return db.withSuperAdmin(async (c) => {
    const r = await c.query(
      `SELECT intent_key, keywords FROM voice_bot_custom_intents WHERE tenant_id = $1`,
      [tenantId],
    );
    return r.rows.map((row: any) => ({ intent: row.intent_key as string, keywords: row.keywords as string[] }));
  });
}

// ── Route factory ─────────────────────────────────────────────────────────

export function voiceBotRoutes(db: DatabaseClient, eventBus: EventBus) {
  return async function (fastify: FastifyInstance) {

    // Gate entire plugin — tenant must be entitled to voice_bot.calls or voice_bot.config.
    // Webhook endpoints (/webhook/*) bypass auth entirely via server.ts prefix list,
    // so this hook is only reached by authenticated (protected) routes.
    fastify.addHook('preHandler', requireEntitlement('voice_bot.calls', 'voice_bot.config'));

    // ── Webhook URL helper (public) ───────────────────────────────────────
    // Returns the URL the tenant should paste into their provider's dashboard.
    // Needs the tenant's public API base URL from settings.
    fastify.get('/webhook-url', { preHandler: requireScope('settings:read') }, async (req, reply) => {
      const base = process.env.API_BASE_URL ?? `https://api.yourcrm.com`;
      const providers = ['vapi', 'retell', 'bland'];
      return reply.send({
        success: true,
        data: providers.reduce((acc, p) => ({
          ...acc,
          [p]: `${base}/api/v1/voice-bot/webhook/${p}?tenantId=${req.tenant.id}`,
        }), {} as Record<string, string>),
      });
    });

    // ── Inbound webhooks (PUBLIC — no auth, signature-verified) ──────────
    for (const provider of ['vapi', 'retell', 'bland'] as const) {
      fastify.post(`/webhook/${provider}`, async (req, reply) => {
        const { tenantId } = req.query as { tenantId?: string };

        if (!tenantId) {
          return reply.code(400).send({ error: 'tenantId query param required' });
        }

        // Load tenant connector config to get webhook secret
        const [tenant] = await db.withSuperAdmin(async (c) => {
          const r = await c.query('SELECT settings FROM tenants WHERE id = $1', [tenantId]);
          return r.rows;
        });
        if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });

        const connectorCfg: Record<string, string> =
          (tenant.settings as any)?.connectors?.[provider] ?? {};

        // Verify webhook signature — REQUIRED. Reject if no secret is configured.
        // This prevents unauthenticated actors from forging webhook payloads.
        const rawBody = JSON.stringify(req.body);
        if (!connectorCfg.webhookSecret) {
          // No secret configured — refuse the request to prevent spoofing.
          // The tenant must configure a webhook secret in their connector settings.
          return reply.code(401).send({ error: 'Webhook secret not configured. Configure a webhook secret in your voice bot connector settings.' });
        }
        const valid = verifyWebhookSignature(
          provider,
          connectorCfg.webhookSecret,
          rawBody,
          req.headers as Record<string, string>,
        );
        if (!valid) {
          return reply.code(401).send({ error: 'Invalid webhook signature' });
        }

        // Normalise provider payload
        const normaliser = NORMALISERS[provider];
        const callData = normaliser(req.body as Record<string, unknown>);

        if (!callData || !callData.providerCallId) {
          // Unknown event type from this provider — acknowledge but skip
          return reply.code(200).send({ received: true, processed: false });
        }

        // Load bot config for this tenant + provider
        const [botConfig] = await db.withSuperAdmin(async (c) => {
          const r = await c.query(
            `SELECT * FROM voice_bot_configs WHERE tenant_id = $1 AND provider = $2`,
            [tenantId, provider],
          );
          return r.rows;
        });

        const sentiment = extractSentiment(
          [callData.summary, callData.transcript].filter(Boolean).join(' '),
        );

        // Persist call record
        const [botCall] = await db.withSuperAdmin(async (c) => {
          const r = await c.query(
            `INSERT INTO voice_bot_calls
               (tenant_id, provider, provider_call_id, from_number, to_number,
                duration_seconds, status, transcript, summary, recording_url, sentiment,
                extracted_subject, extracted_priority, extracted_reporter_name,
                extracted_reporter_email, raw_payload, started_at, ended_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [
              tenantId, provider, callData.providerCallId,
              callData.fromNumber || null,
              callData.toNumber   || null,
              callData.durationSeconds ?? null,
              callData.status,
              callData.transcript  ?? null,
              callData.summary     ?? null,
              callData.recordingUrl ?? null,
              sentiment,
              callData.summary     ? extractSubject(callData.summary, '') : null,
              extractPriority([callData.summary, callData.transcript].filter(Boolean).join(' '),
                botConfig?.keyword_urgency ?? []),
              callData.extractedName  ?? null,
              callData.extractedEmail ?? null,
              JSON.stringify(callData.rawPayload),
              callData.startedAt ?? null,
              callData.endedAt   ?? null,
            ],
          );
          return r.rows;
        });

        if (!botCall) {
          // Duplicate call ID — already processed
          return reply.code(200).send({ received: true, processed: false, reason: 'duplicate' });
        }

        // Self-service check — if the detected intent is in the tenant's self-service list,
        // resolve the call without creating a ticket and mark resolution_type = 'self_service'.
        const selfServiceIntents: string[] = botConfig?.self_service_intents ?? [];
        const customIntents = await getCustomIntents(db, req.tenant.id);
        const detectedIntent = detectIntent(callData, customIntents);
        const isSelfService = selfServiceIntents.length > 0 &&
          selfServiceIntents.some(i => i.toLowerCase() === detectedIntent.toLowerCase());

        let ticketId: string | null = null;
        let resolutionType = 'ticket_created';

        if (isSelfService) {
          resolutionType = 'self_service';
          await db.withSuperAdmin(async (c) => {
            await c.query(
              `UPDATE voice_bot_calls
                 SET resolution_type = 'self_service',
                     self_service_response = $2
               WHERE id = $1`,
              [botCall.id, `Bot resolved: ${detectedIntent} query handled without agent`],
            );
          });
        } else if (botConfig?.auto_create_ticket !== false) {
          ticketId = await createTicketFromBotCall(
            db, eventBus, tenantId, botCall.id, callData, botConfig,
          );
        }

        return reply.code(200).send({
          received: true,
          processed: true,
          botCallId: botCall.id,
          ticketId,
          resolutionType,
        });
      });
    }

    // ══ Protected routes below ═══════════════════════════════════════════

    // ── Bot configuration ──────────────────────────────────────────────

    // Whether this user holds the delegated "Configure IVR flows & bot
    // settings" capability (voicebot:configure). Per product decision
    // 2026-07-19: WITHOUT it, a workspace user — including the tenant
    // admin — may only change the bot's name and greeting message. The
    // capability is allocated per workspace by the platform (Super Admin →
    // Manage Role Permissions → Admin role → Voice Bot), and a tenant
    // admin holding it can delegate it to their own users via Roles.
    // Checked live against the roles table (not the JWT) so an allocation
    // takes effect without re-login. Handles both permission shapes:
    // granular booleans ('voicebot:configure') and the legacy module map
    // ('voicebot': 'none'|'view'|'full').
    const readVoicebotConfigure = (p: any): boolean | null => {
      if (!p || typeof p !== 'object') return null;
      if (typeof p['voicebot:configure'] === 'boolean') return p['voicebot:configure'];
      if (typeof p['voicebot'] === 'string') return p['voicebot'] === 'full' || p['voicebot'] === 'write';
      return null;
    };
    const canConfigureVoicebot = async (req: any): Promise<boolean> => {
      if (req.user.role === 'super_admin') return true;
      const rows = await db.withTenant(req.tenant.id, async (c) =>
        (await c.query(
          `SELECT permissions, is_system FROM roles
            WHERE tenant_id = $1 AND (
              id = (SELECT custom_role_id FROM users WHERE id = $2)
              OR (is_system = true AND base_role = (SELECT role FROM users WHERE id = $2))
            )
            ORDER BY is_system ASC
            LIMIT 1`,
          [req.tenant.id, req.user.sub],
        )).rows);
      const fromRole = rows.length ? readVoicebotConfigure(rows[0].permissions) : null;
      if (fromRole !== null) return fromRole;
      return readVoicebotConfigure(req.user.permissions) ?? false;
    };
    const CONFIGURE_REQUIRED = {
      success: false,
      error: {
        code: 'VOICEBOT_CONFIGURE_REQUIRED',
        message: "Your account can change the bot's name and greeting only. Full Voice Bot configuration requires the 'Configure IVR flows & bot settings' permission — ask your administrator (or platform provider) to allocate it.",
      },
    };

    fastify.get('/config', { preHandler: requireScope('settings:read') }, async (req, reply) => {
      const configs = await db.withTenant(req.tenant.id, async (c) => {
        const r = await c.query(
          `SELECT vbc.*, tq.name AS queue_name
           FROM voice_bot_configs vbc
           LEFT JOIN ticket_queues tq ON vbc.default_queue_id = tq.id`,
        );
        return r.rows;
      });
      // "super_admin" ownership means this workspace's bot is centrally held —
      // the tenant admin's screen shows current values but can't save changes.
      const ownership = (req.tenant.settings as any)?.voice_bot_ownership ?? 'tenant_admin';
      const canConfigure = await canConfigureVoicebot(req);
      return reply.send({ success: true, data: configs, ownership, canConfigure });
    });

    const ConfigSchema = z.object({
      provider:           z.enum(['vapi', 'retell', 'bland', 'twilio_ai', 'livekit']),
      isActive:           z.boolean().optional(),
      assistantId:        z.string().optional(),
      phoneNumber:        z.string().optional(),
      greetingMessage:    z.string().optional(),
      systemPrompt:       z.string().optional(),
      language:           z.string().optional(),
      voiceId:            z.string().optional(),
      autoCreateTicket:   z.boolean().optional(),
      defaultQueueId:     z.string().uuid().optional().nullable(),
      defaultPriority:    z.enum(['urgent','high','medium','low']).optional(),
      keywordUrgency:     z.array(z.string()).optional(),
      sipUri:             z.string().optional(),
      ivrMenu:            z.array(z.object({
        option:      z.number().int().min(1).max(9),
        intent:      z.enum(['complaint', 'inquiry', 'sales', 'agent', 'self_service']),
        label:       z.string(),
        ticketType:  z.enum(['complaint', 'inquiry', 'sales']).optional(),
        queueId:     z.string().uuid().optional().nullable(),
        description: z.string().optional(),
      })).optional(),
      selfServiceIntents: z.array(z.string()).optional(),

      // LiveKit ("Nadia") self-hosted agent — Retell-style behaviour knobs.
      // Ignored (but harmless) for vapi/retell/bland, which have their own dashboards.
      botName:                 z.string().min(1).max(60).optional(),
      tone:                    z.enum(['professional', 'friendly', 'empathetic', 'formal']).optional(),
      speakingRate:            z.number().min(0.5).max(2.0).optional(),
      sttProvider:             z.enum(['whisper']).optional(),
      sttLanguageHint:         z.enum(['ur-en', 'ur', 'en']).optional(),
      ttsProvider:             z.enum(['uplift']).optional(),
      llmModel:                z.string().optional(),
      interruptionSensitivity: z.number().min(0).max(1).optional(),
      maxCallDurationSec:      z.number().int().min(30).max(3600).optional(),
      endCallPhrases:          z.array(z.string()).optional(),
      guardrails:              z.string().max(4000).optional(),
      recordingEnabled:        z.boolean().optional(),
      sipTrunkProvider:        z.string().optional(),
      sipTrunkNumber:          z.string().optional(),
      sipTrunkUsername:        z.string().optional(),
      sipTrunkPassword:        z.string().optional(),
      sipTrunkNickname:        z.string().optional(),
      outboundTransport:       z.enum(['TCP', 'UDP']).optional(),
      maxConcurrentCalls:      z.number().int().positive().optional().nullable(),
      humanTransferDestination: z.string().optional().nullable(),
    });

    fastify.put('/config', { preHandler: requireRole('tenant_admin', 'super_admin') }, async (req, reply) => {
      const ownership = (req.tenant.settings as any)?.voice_bot_ownership ?? 'tenant_admin';
      if (ownership === 'super_admin') {
        return reply.code(403).send({
          success: false,
          error: { code: 'CENTRALLY_MANAGED', message: 'This workspace\'s Voice Bot is centrally managed by your platform provider. Contact them to request changes.' },
        });
      }
      const body = ConfigSchema.parse(req.body);

      // Without the voicebot:configure capability, only the bot's name and
      // greeting may be changed — a separate limited UPDATE that touches
      // nothing else, so a restricted save can never blank other fields.
      if (!(await canConfigureVoicebot(req))) {
        const allowed = new Set(['provider', 'botName', 'greetingMessage']);
        const disallowed = Object.entries(body)
          .filter(([k, v]) => v !== undefined && !allowed.has(k))
          .map(([k]) => k);
        if (disallowed.length > 0) return reply.code(403).send(CONFIGURE_REQUIRED);
        const [limited] = await db.withTenant(req.tenant.id, async (c) =>
          (await c.query(
            `UPDATE voice_bot_configs SET
               bot_name         = COALESCE($3, bot_name),
               greeting_message = COALESCE($4, greeting_message),
               updated_at       = NOW()
             WHERE tenant_id = $1 AND provider = $2
             RETURNING *`,
            [req.tenant.id, body.provider, (body as any).botName ?? null, body.greetingMessage ?? null],
          )).rows);
        if (!limited) return reply.code(404).send({ success: false, error: { code: 'NOT_CONFIGURED', message: 'This workspace has no voice bot set up yet — contact your platform provider.' } });
        return reply.send({ success: true, data: limited });
      }

      // Licensing the Voice Bot module alone doesn't grant every provider —
      // each one must be individually allocated to the tenant.
      const entitledFeatures = ((req.tenant as any)?.entitled_features ?? []) as string[];
      if (!entitledFeatures.includes(`voice_bot.provider.${body.provider}`)) {
        return reply.code(402).send({
          success: false,
          error: { code: 'PROVIDER_NOT_LICENSED', message: `The '${body.provider}' voice bot provider is not enabled for your workspace. Contact your account manager to enable it.` },
        });
      }

      const [cfg] = await db.withTenant(req.tenant.id, async (c) => {
        const r = await c.query(
           `INSERT INTO voice_bot_configs
              (tenant_id, provider, is_active, assistant_id, phone_number,
               greeting_message, system_prompt, language, voice_id,
               auto_create_ticket, default_queue_id, default_priority, keyword_urgency,
               sip_uri, ivr_menu, self_service_intents,
               tone, speaking_rate, stt_provider, stt_language_hint, tts_provider,
               llm_model, interruption_sensitivity, max_call_duration_sec, end_call_phrases,
               sip_trunk_provider, sip_trunk_number, bot_name,
               sip_trunk_username, sip_trunk_password, sip_trunk_nickname, outbound_transport,
               guardrails, recording_enabled, max_concurrent_calls, human_transfer_destination)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                    $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36)
            ON CONFLICT (tenant_id, provider) DO UPDATE SET
              is_active             = EXCLUDED.is_active,
              assistant_id          = EXCLUDED.assistant_id,
              phone_number          = EXCLUDED.phone_number,
              greeting_message      = EXCLUDED.greeting_message,
              system_prompt         = EXCLUDED.system_prompt,
              language              = EXCLUDED.language,
              voice_id              = EXCLUDED.voice_id,
              auto_create_ticket    = EXCLUDED.auto_create_ticket,
              default_queue_id      = EXCLUDED.default_queue_id,
              default_priority      = EXCLUDED.default_priority,
              keyword_urgency       = EXCLUDED.keyword_urgency,
              sip_uri               = EXCLUDED.sip_uri,
              ivr_menu              = EXCLUDED.ivr_menu,
              self_service_intents  = EXCLUDED.self_service_intents,
              tone                  = EXCLUDED.tone,
              speaking_rate         = EXCLUDED.speaking_rate,
              stt_provider          = EXCLUDED.stt_provider,
              stt_language_hint     = EXCLUDED.stt_language_hint,
              tts_provider          = EXCLUDED.tts_provider,
              llm_model             = EXCLUDED.llm_model,
              interruption_sensitivity = EXCLUDED.interruption_sensitivity,
              max_call_duration_sec = EXCLUDED.max_call_duration_sec,
              end_call_phrases      = EXCLUDED.end_call_phrases,
              sip_trunk_provider    = EXCLUDED.sip_trunk_provider,
              sip_trunk_number      = EXCLUDED.sip_trunk_number,
              bot_name              = EXCLUDED.bot_name,
              sip_trunk_username    = EXCLUDED.sip_trunk_username,
              sip_trunk_password    = EXCLUDED.sip_trunk_password,
              sip_trunk_nickname    = EXCLUDED.sip_trunk_nickname,
              outbound_transport    = EXCLUDED.outbound_transport,
              guardrails            = EXCLUDED.guardrails,
              recording_enabled     = EXCLUDED.recording_enabled,
              max_concurrent_calls  = EXCLUDED.max_concurrent_calls,
              human_transfer_destination = EXCLUDED.human_transfer_destination,
              updated_at            = NOW()
            RETURNING *`,
           [
             req.tenant.id,
             body.provider,
             body.isActive ?? true,
             body.assistantId     ?? null,
             body.phoneNumber     ?? null,
             body.greetingMessage ?? null,
             body.systemPrompt    ?? null,
             body.language        ?? (body.provider === 'livekit' ? 'ur-PK' : 'en-US'),
             body.voiceId         ?? (body.provider === 'livekit' ? 'helpdesk-agent' : null),
             body.autoCreateTicket ?? true,
             body.defaultQueueId  ?? null,
             body.defaultPriority ?? 'medium',
             body.keywordUrgency  ?? URGENCY_KEYWORDS,
             body.sipUri          ?? null,
             JSON.stringify(body.ivrMenu ?? DEFAULT_IVR_MENU),
             body.selfServiceIntents ?? [],
             body.tone                    ?? 'professional',
             body.speakingRate            ?? 0.9,
             body.sttProvider             ?? 'whisper',
             body.sttLanguageHint         ?? 'ur-en',
             body.ttsProvider             ?? 'uplift',
             body.llmModel                ?? 'gpt-4o-mini',
             body.interruptionSensitivity ?? 0.5,
             body.maxCallDurationSec      ?? 600,
             body.endCallPhrases ?? ['اللہ حافظ', 'خدا حافظ', 'شکریہ، اللہ حافظ'],
             body.sipTrunkProvider        ?? null,
             body.sipTrunkNumber          ?? null,
             body.botName                 ?? 'Nadia',
             body.sipTrunkUsername        ?? null,
             body.sipTrunkPassword        ?? null,
             body.sipTrunkNickname        ?? null,
             body.outboundTransport       ?? 'TCP',
             body.guardrails              ?? null,
             body.recordingEnabled        ?? false,
             body.maxConcurrentCalls      ?? null,
             body.humanTransferDestination ?? null,
           ],
        );
        return r.rows;
      });

      return reply.send({ success: true, data: cfg });
    });

    // ── Voice catalog (shared across tenants; super admin manages the list) ──
    fastify.get('/voices', async (req, reply) => {
      const voices = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `SELECT id, provider, voice_id, label, description
             FROM voice_bot_voices WHERE is_active = true ORDER BY created_at ASC`,
        );
        return r.rows;
      });
      return reply.send({ success: true, data: voices });
    });

    fastify.post('/voices', { preHandler: requireRole('super_admin') }, async (req, reply) => {
      const body = z.object({
        provider:    z.enum(['livekit']).default('livekit'),
        voiceId:     z.string().min(1),
        label:       z.string().min(1),
        description: z.string().optional(),
      }).parse(req.body);

      const [voice] = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `INSERT INTO voice_bot_voices (provider, voice_id, label, description)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (provider, voice_id) DO UPDATE SET
             label = EXCLUDED.label, description = EXCLUDED.description, is_active = true
           RETURNING *`,
          [body.provider, body.voiceId, body.label, body.description ?? null],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: voice });
    });

    fastify.delete('/voices/:id', { preHandler: requireRole('super_admin') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withSuperAdmin(async (c) => {
        await c.query(`UPDATE voice_bot_voices SET is_active = false WHERE id = $1`, [id]);
      });
      return reply.send({ success: true });
    });

    // ── Custom self-service intents (per tenant — "answer, don't ticket" reasons) ──
    fastify.get('/custom-intents', { preHandler: requireScope('settings:read') }, async (req, reply) => {
      const intents = await db.withTenant(req.tenant.id, async (c) => {
        const r = await c.query(
          `SELECT id, intent_key, label, keywords, created_at
             FROM voice_bot_custom_intents WHERE tenant_id = $1 ORDER BY created_at ASC`,
          [req.tenant.id],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: intents });
    });

    fastify.post('/custom-intents', { preHandler: requireRole('tenant_admin', 'super_admin') }, async (req, reply) => {
      if (!(await canConfigureVoicebot(req))) return reply.code(403).send(CONFIGURE_REQUIRED);
      const body = z.object({
        label:    z.string().min(1).max(80),
        keywords: z.array(z.string().min(1)).min(1),
      }).parse(req.body);

      const intentKey = body.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (!intentKey) return reply.code(400).send({ success: false, error: 'Label must contain at least one letter or number' });

      const [intent] = await db.withTenant(req.tenant.id, async (c) => {
        const r = await c.query(
          `INSERT INTO voice_bot_custom_intents (tenant_id, intent_key, label, keywords, created_by)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (tenant_id, intent_key) DO UPDATE SET
             label = EXCLUDED.label, keywords = EXCLUDED.keywords
           RETURNING *`,
          [req.tenant.id, intentKey, body.label, body.keywords.map(k => k.toLowerCase()), req.user.sub],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: intent });
    });

    fastify.delete('/custom-intents/:id', { preHandler: requireRole('tenant_admin', 'super_admin') }, async (req, reply) => {
      if (!(await canConfigureVoicebot(req))) return reply.code(403).send(CONFIGURE_REQUIRED);
      const { id } = req.params as { id: string };
      await db.withTenant(req.tenant.id, async (c) => {
        await c.query(`DELETE FROM voice_bot_custom_intents WHERE id = $1 AND tenant_id = $2`, [id, req.tenant.id]);
      });
      return reply.send({ success: true });
    });

    // ── Knowledge base (Nadia admin portal item 6) ────────────────────────
    // Tenant admins add reference material three ways: typed text, an
    // uploaded PDF/DOCX (text extracted at upload time), or a URL (HTML
    // fetched and stripped to plain text at import time). At call time
    // Nadia matches the caller's question against `keywords` and gets the
    // matching entry's `content` injected into that turn's context — plain
    // keyword matching, no embeddings/vector store needed for this volume.

    fastify.get('/knowledge-base', { preHandler: requireScope('settings:read') }, async (req, reply) => {
      const entries = await db.withTenant(req.tenant.id, async (c) => {
        const r = await c.query(
          `SELECT id, title, content, keywords, source_type, source_url, source_filename,
                  is_active, created_at, updated_at
             FROM voice_bot_knowledge_entries
            WHERE tenant_id = $1
            ORDER BY created_at DESC`,
          [req.tenant.id],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: entries });
    });

    // Add a plain-text entry: tenant admin types a title, the answer content,
    // and a few keywords a caller might say that should trigger this entry.
    fastify.post('/knowledge-base', { preHandler: requireRole('tenant_admin', 'super_admin') }, async (req, reply) => {
      if (!(await canConfigureVoicebot(req))) return reply.code(403).send(CONFIGURE_REQUIRED);
      const body = z.object({
        title:    z.string().min(1).max(120),
        content:  z.string().min(1).max(5000),
        keywords: z.array(z.string().min(1)).min(1).max(20),
      }).parse(req.body);

      const [entry] = await db.withTenant(req.tenant.id, async (c) => {
        const r = await c.query(
          `INSERT INTO voice_bot_knowledge_entries
             (tenant_id, title, content, keywords, source_type, created_by)
           VALUES ($1, $2, $3, $4, 'text', $5)
           RETURNING *`,
          [req.tenant.id, body.title, body.content, body.keywords.map(k => k.toLowerCase()), req.user.sub],
        );
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: entry });
    });

    // Import from a URL: fetch the page, strip HTML down to plain text,
    // store the first chunk as content. Caller still sets title + keywords.
    fastify.post('/knowledge-base/import-url', { preHandler: requireRole('tenant_admin', 'super_admin') }, async (req, reply) => {
      if (!(await canConfigureVoicebot(req))) return reply.code(403).send(CONFIGURE_REQUIRED);
      const body = z.object({
        title:    z.string().min(1).max(120),
        url:      z.string().url(),
        keywords: z.array(z.string().min(1)).min(1).max(20),
      }).parse(req.body);

      let text: string;
      try {
        const res = await fetch(body.url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return reply.code(400).send({ success: false, error: `Could not fetch that URL (HTTP ${res.status})` });
        const html = await res.text();
        text = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 5000);
      } catch (err: any) {
        return reply.code(400).send({ success: false, error: `Could not fetch that URL: ${err.message}` });
      }
      if (!text) return reply.code(400).send({ success: false, error: 'No readable text found at that URL' });

      const [entry] = await db.withTenant(req.tenant.id, async (c) => {
        const r = await c.query(
          `INSERT INTO voice_bot_knowledge_entries
             (tenant_id, title, content, keywords, source_type, source_url, created_by)
           VALUES ($1, $2, $3, $4, 'url', $5, $6)
           RETURNING *`,
          [req.tenant.id, body.title, text, body.keywords.map(k => k.toLowerCase()), body.url, req.user.sub],
        );
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: entry });
    });

    // Upload a PDF or DOCX: extract its text, caller sets title + keywords
    // as separate multipart fields alongside the file.
    fastify.post('/knowledge-base/upload', { preHandler: requireRole('tenant_admin', 'super_admin') }, async (req, reply) => {
      if (!(await canConfigureVoicebot(req))) return reply.code(403).send(CONFIGURE_REQUIRED);
      const parts = req.parts();
      let fileBuffer: Buffer | null = null;
      let filename = '';
      let mimetype = '';
      let title = '';
      let keywordsRaw = '';
      for await (const part of parts) {
        if (part.type === 'file') {
          fileBuffer = await part.toBuffer();
          filename = part.filename;
          mimetype = part.mimetype;
        } else if (part.fieldname === 'title') {
          title = String(part.value);
        } else if (part.fieldname === 'keywords') {
          keywordsRaw = String(part.value);
        }
      }
      if (!fileBuffer) return reply.code(400).send({ success: false, error: 'No file uploaded' });
      if (!title.trim()) return reply.code(400).send({ success: false, error: 'Title is required' });
      const keywords = keywordsRaw.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
      if (keywords.length === 0) return reply.code(400).send({ success: false, error: 'At least one keyword is required' });

      let text: string;
      try {
        if (mimetype === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
          text = (await pdfParse(fileBuffer)).text;
        } else if (
          mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          || filename.toLowerCase().endsWith('.docx')
        ) {
          text = (await mammoth.extractRawText({ buffer: fileBuffer })).value;
        } else {
          return reply.code(400).send({ success: false, error: 'Only PDF or DOCX files are supported' });
        }
      } catch (err: any) {
        return reply.code(400).send({ success: false, error: `Could not read that file: ${err.message}` });
      }
      text = text.replace(/\s+/g, ' ').trim().slice(0, 5000);
      if (!text) return reply.code(400).send({ success: false, error: 'No readable text found in that file' });

      const [entry] = await db.withTenant(req.tenant.id, async (c) => {
        const r = await c.query(
          `INSERT INTO voice_bot_knowledge_entries
             (tenant_id, title, content, keywords, source_type, source_filename, created_by)
           VALUES ($1, $2, $3, $4, 'file', $5, $6)
           RETURNING *`,
          [req.tenant.id, title, text, keywords, filename, req.user.sub],
        );
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: entry });
    });

    fastify.put('/knowledge-base/:id', { preHandler: requireRole('tenant_admin', 'super_admin') }, async (req, reply) => {
      if (!(await canConfigureVoicebot(req))) return reply.code(403).send(CONFIGURE_REQUIRED);
      const { id } = req.params as { id: string };
      const body = z.object({
        title:     z.string().min(1).max(120).optional(),
        content:   z.string().min(1).max(5000).optional(),
        keywords:  z.array(z.string().min(1)).min(1).max(20).optional(),
        isActive:  z.boolean().optional(),
      }).parse(req.body);

      const [entry] = await db.withTenant(req.tenant.id, async (c) => {
        const r = await c.query(
          `UPDATE voice_bot_knowledge_entries SET
             title      = COALESCE($3, title),
             content    = COALESCE($4, content),
             keywords   = COALESCE($5, keywords),
             is_active  = COALESCE($6, is_active)
           WHERE id = $1 AND tenant_id = $2
           RETURNING *`,
          [id, req.tenant.id, body.title ?? null, body.content ?? null,
           body.keywords ? body.keywords.map(k => k.toLowerCase()) : null, body.isActive ?? null],
        );
        return r.rows;
      });
      if (!entry) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: entry });
    });

    fastify.delete('/knowledge-base/:id', { preHandler: requireRole('tenant_admin', 'super_admin') }, async (req, reply) => {
      if (!(await canConfigureVoicebot(req))) return reply.code(403).send(CONFIGURE_REQUIRED);
      const { id } = req.params as { id: string };
      await db.withTenant(req.tenant.id, async (c) => {
        await c.query(`DELETE FROM voice_bot_knowledge_entries WHERE id = $1 AND tenant_id = $2`, [id, req.tenant.id]);
      });
      return reply.send({ success: true });
    });

    // Called by the Nadia agent mid-call (server-side keyword match, not the
    // caller-facing config UI) — matches the caller's question against every
    // active entry's keywords, returns the best match's content.
    fastify.get('/knowledge-base/search', async (req, reply) => {
      if (!checkSecret(req)) return reply.code(401).send({ error: 'unauthorized' });
      const { tenantId, q } = req.query as { tenantId?: string; q?: string };
      if (!tenantId || !q) return reply.code(400).send({ success: false, error: 'tenantId and q are required' });

      const queryWords = q.toLowerCase().split(/\W+/).filter(w => w.length > 2);
      if (queryWords.length === 0) return reply.send({ success: true, data: null });

      const [best] = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `SELECT id, title, content, keywords,
                  cardinality(ARRAY(SELECT unnest(keywords) INTERSECT SELECT unnest($2::text[]))) AS matches
             FROM voice_bot_knowledge_entries
            WHERE tenant_id = $1 AND is_active = true
            ORDER BY matches DESC
            LIMIT 1`,
          [tenantId, queryWords],
        );
        return r.rows.filter((row: any) => row.matches > 0);
      });
      return reply.send({ success: true, data: best ?? null });
    });

    // ── Connector secret (stored in tenant.settings so webhooks can read it) ──
    fastify.put('/config/connector-secret', { preHandler: requireRole('tenant_admin', 'super_admin') }, async (req, reply) => {
      const { provider, webhookSecret } = z.object({
        provider:      z.enum(['vapi', 'retell', 'bland', 'livekit']),
        webhookSecret: z.string().min(8),
      }).parse(req.body);

      await db.withTenant(req.tenant.id, async (c) => {
        await c.query(
          `UPDATE tenants
             SET settings = jsonb_set(
               COALESCE(settings, '{}'::jsonb),
               ARRAY['connectors', $1],
               jsonb_build_object('webhookSecret', $2::text)
             )
           WHERE id = $3`,
          [provider, webhookSecret, req.tenant.id],
        );
      });
      return reply.send({ success: true, message: `Webhook secret for ${provider} saved.` });
    });

    // ── Simulated test call (authenticated — uses /config/simulate not /webhook/ prefix) ──
    fastify.post('/config/simulate', { preHandler: requireRole('tenant_admin', 'super_admin') }, async (req, reply) => {
      const body = z.object({
        provider:     z.enum(['vapi', 'retell', 'bland']).default('retell'),
        fromNumber:   z.string().default('+923001234567'),
        subject:      z.string().default('Test call from voice bot'),
        summary:      z.string().default('Customer called to test the voice bot integration.'),
        transcript:   z.string().default('Customer: Hello, I want to test this system. Bot: Sure, let me create a test ticket for you.'),
        ticketType:   z.enum(['complaint', 'inquiry', 'sales']).default('inquiry'),
        priority:     z.enum(['urgent', 'high', 'medium', 'low']).default('medium'),
      }).parse(req.body ?? {});

      const tenantId = req.tenant.id;

      const [botConfig] = await db.withTenant(tenantId, async (c) => {
        const r = await c.query('SELECT * FROM voice_bot_configs WHERE tenant_id = $1 AND provider = $2', [tenantId, body.provider]);
        return r.rows;
      });

      const fakeCallData = {
        providerCallId:      `test_${Date.now()}`,
        fromNumber:          body.fromNumber,
        toNumber:            '+922111111111',
        durationSeconds:     60,
        status:              'ended' as const,
        transcript:          body.transcript,
        summary:             body.summary,
        extractedName:       'Test Caller',
        extractedEmail:      undefined,
        startedAt:           new Date(Date.now() - 60000),
        endedAt:             new Date(),
        rawPayload:          { test: true, provider: body.provider },
        ticketType:          body.ticketType,
        extractedPriority:   body.priority,
        extractedSubject:    body.subject,
      };

      const sentiment = extractSentiment(body.summary);

      const [botCall] = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `INSERT INTO voice_bot_calls
             (tenant_id, provider, provider_call_id, from_number, to_number,
              duration_seconds, status, transcript, summary, sentiment,
              extracted_subject, extracted_priority, extracted_reporter_name,
              raw_payload, started_at, ended_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           RETURNING id`,
          [tenantId, body.provider, fakeCallData.providerCallId, fakeCallData.fromNumber, fakeCallData.toNumber,
           fakeCallData.durationSeconds, 'ended', fakeCallData.transcript, fakeCallData.summary, sentiment,
           fakeCallData.extractedSubject, fakeCallData.extractedPriority, 'Test Caller',
           JSON.stringify({ test: true }), fakeCallData.startedAt, fakeCallData.endedAt],
        );
        return r.rows;
      });

      // Apply same self-service logic as the real webhook path
      const selfServiceIntents: string[] = botConfig?.self_service_intents ?? [];
      const customIntents = await getCustomIntents(db, tenantId);
      const detectedIntent = detectIntent(fakeCallData, customIntents);
      const isSelfService = selfServiceIntents.length > 0 &&
        selfServiceIntents.some(i => i.toLowerCase() === detectedIntent.toLowerCase());

      let ticketId: string | null = null;
      let resolutionType = 'ticket_created';

      if (isSelfService) {
        resolutionType = 'self_service';
        await db.withSuperAdmin(async (c) => {
          await c.query(
            `UPDATE voice_bot_calls SET resolution_type='self_service', self_service_response=$2 WHERE id=$1`,
            [botCall.id, `Bot resolved: ${detectedIntent} query handled without agent`],
          );
        });
      } else {
        ticketId = await createTicketFromBotCall(db, eventBus, tenantId, botCall.id, fakeCallData, botConfig);
      }

      return reply.send({
        success: true,
        message: isSelfService
          ? `Self-service: bot resolved "${detectedIntent}" without creating a ticket`
          : 'Test call simulated — ticket created',
        botCallId: botCall.id,
        ticketId,
        resolutionType,
        detectedIntent,
        provider: body.provider,
      });
    });

    // ── Call list ──────────────────────────────────────────────────────

    // Transcripts & full call records are supervisor/manager only — agents see the ticket, not the raw call
    fastify.get('/calls', { preHandler: requireRole('super_admin', 'tenant_admin', 'manager') }, async (req, reply) => {
      const { provider, hasTicket, sentiment, search, page = 1, pageSize = 25 } =
        req.query as Record<string, string>;
      const offset = (Number(page) - 1) * Number(pageSize);

      const calls = await db.withTenant(req.tenant.id, async (c) => {
        const r = await c.query(
          `SELECT vbc.*,
             t.ticket_number, t.status AS ticket_status, t.priority AS ticket_priority,
             con.first_name || ' ' || COALESCE(con.last_name,'') AS contact_name
           FROM voice_bot_calls vbc
           LEFT JOIN tickets  t   ON vbc.ticket_id  = t.id
           LEFT JOIN contacts con ON vbc.contact_id = con.id
           WHERE 1=1
           ${provider  ? `AND vbc.provider  = '${provider}'`  : ''}
           ${sentiment ? `AND vbc.sentiment = '${sentiment}'` : ''}
           ${hasTicket === 'true'  ? 'AND vbc.ticket_id IS NOT NULL' : ''}
           ${hasTicket === 'false' ? 'AND vbc.ticket_id IS NULL'     : ''}
           ${search    ? `AND (vbc.from_number ILIKE '%${search.replace(/'/g,'')}%'
                           OR vbc.summary      ILIKE '%${search.replace(/'/g,'')}%'
                           OR vbc.extracted_reporter_name ILIKE '%${search.replace(/'/g,'')}%')` : ''}
           ORDER BY vbc.created_at DESC
           LIMIT $1 OFFSET $2`,
          [Number(pageSize), offset],
        );
        const cnt = await c.query(
          `SELECT COUNT(*) FROM voice_bot_calls WHERE tenant_id = current_setting('app.tenant_id',true)::uuid
           ${provider ? `AND provider = '${provider}'` : ''}`,
        );
        return { rows: r.rows, total: parseInt(cnt.rows[0].count) };
      });

      return reply.send({
        success: true,
        data: calls.rows,
        meta: { total: calls.total, page: Number(page), pageSize: Number(pageSize) },
      });
    });

    // ── Single call ────────────────────────────────────────────────────

    fastify.get('/calls/:id', { preHandler: requireRole('super_admin', 'tenant_admin', 'manager') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const [call] = await db.withTenant(req.tenant.id, async (c) => {
        const r = await c.query(
          `SELECT vbc.*,
             t.ticket_number, t.status AS ticket_status, t.subject AS ticket_subject,
             t.priority AS ticket_priority, t.assignee_id AS assigned_to,
             u.name AS assignee_name,
             con.first_name || ' ' || COALESCE(con.last_name,'') AS contact_name,
             con.email AS contact_email
           FROM voice_bot_calls vbc
           LEFT JOIN tickets  t   ON vbc.ticket_id  = t.id
           LEFT JOIN users    u   ON t.assignee_id  = u.id
           LEFT JOIN contacts con ON vbc.contact_id = con.id
           WHERE vbc.id = $1`,
          [id],
        );
        return r.rows;
      });

      if (!call) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND' } });
      return reply.send({ success: true, data: call });
    });

    // ── Manually create ticket from a call ─────────────────────────────

    fastify.post('/calls/:id/ticket', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const [botCall] = await db.withTenant(req.tenant.id, async (c) => {
        const r = await c.query('SELECT * FROM voice_bot_calls WHERE id = $1', [id]);
        return r.rows;
      });

      if (!botCall) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND' } });
      if (botCall.ticket_id) {
        return reply.code(409).send({
          success: false,
          error: { code: 'ALREADY_HAS_TICKET', message: 'A ticket already exists for this call' },
        });
      }

      const callData: NormalisedCall = {
        providerCallId: botCall.provider_call_id,
        fromNumber:     botCall.from_number ?? '',
        durationSeconds: botCall.duration_seconds,
        status: botCall.status,
        transcript: botCall.transcript,
        summary:    botCall.summary,
        recordingUrl: botCall.recording_url,
        extractedName:  botCall.extracted_reporter_name,
        extractedEmail: botCall.extracted_reporter_email,
        rawPayload: {},
      };

      const [botConfig] = await db.withTenant(req.tenant.id, async (c) => {
        const r = await c.query(
          `SELECT * FROM voice_bot_configs WHERE tenant_id = current_setting('app.tenant_id',true)::uuid
           AND provider = $1`,
          [botCall.provider],
        );
        return r.rows;
      });

      const ticketId = await createTicketFromBotCall(
        db, eventBus, req.tenant.id, id, callData, botConfig,
      );

      if (!ticketId) {
        return reply.code(500).send({ success: false, error: { code: 'TICKET_CREATION_FAILED' } });
      }

      return reply.code(201).send({ success: true, data: { ticketId } });
    });

    // ── Stats dashboard ────────────────────────────────────────────────

    fastify.get('/stats', { preHandler: requireScope('activities:read') }, async (req, reply) => {
      const { from, to } = req.query as { from?: string; to?: string };
      const fromDate = from ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
      const toDate   = to   ?? new Date().toISOString();

      const stats = await db.withTenant(req.tenant.id, async (c) => {
        const r = await c.query(
          `SELECT
             COUNT(*) FILTER (WHERE created_at >= $1 AND created_at <= $2)                   AS total_calls,
             COUNT(*) FILTER (WHERE ticket_id IS NOT NULL AND created_at >= $1 AND created_at <= $2) AS calls_with_tickets,
             COUNT(*) FILTER (WHERE sentiment = 'negative' AND created_at >= $1 AND created_at <= $2) AS negative_calls,
             COUNT(*) FILTER (WHERE sentiment = 'urgent'   AND created_at >= $1 AND created_at <= $2) AS urgent_calls,
             AVG(duration_seconds) FILTER (WHERE created_at >= $1 AND created_at <= $2)       AS avg_duration,
             COUNT(DISTINCT from_number) FILTER (WHERE created_at >= $1 AND created_at <= $2) AS unique_callers,
             COUNT(*) FILTER (WHERE extracted_priority = 'urgent' AND created_at >= $1 AND created_at <= $2) AS urgent_tickets,
             COUNT(*) FILTER (WHERE provider = 'vapi'   AND created_at >= $1 AND created_at <= $2) AS vapi_calls,
             COUNT(*) FILTER (WHERE provider = 'retell' AND created_at >= $1 AND created_at <= $2) AS retell_calls,
             COUNT(*) FILTER (WHERE provider = 'bland'  AND created_at >= $1 AND created_at <= $2) AS bland_calls,
             COUNT(*) FILTER (WHERE resolution_type = 'self_service' AND created_at >= $1 AND created_at <= $2) AS self_service_resolved,
             COUNT(*) FILTER (WHERE resolution_type = 'agent_transfer' AND created_at >= $1 AND created_at <= $2) AS agent_transfers
           FROM voice_bot_calls`,
          [fromDate, toDate],
        );

        const daily = await c.query(
          `SELECT DATE(created_at) AS date,
             COUNT(*) AS calls,
             COUNT(*) FILTER (WHERE ticket_id IS NOT NULL) AS tickets_created,
             AVG(duration_seconds) AS avg_duration
           FROM voice_bot_calls
           WHERE created_at >= $1 AND created_at <= $2
           GROUP BY DATE(created_at) ORDER BY date`,
          [fromDate, toDate],
        );

        const sentiments = await c.query(
          `SELECT sentiment, COUNT(*) AS count
           FROM voice_bot_calls
           WHERE created_at >= $1 AND created_at <= $2
           GROUP BY sentiment`,
          [fromDate, toDate],
        );

        return {
          summary: r.rows[0],
          daily: daily.rows,
          sentiments: sentiments.rows,
        };
      });

      return reply.send({ success: true, data: stats });
    });

    // ── Minutes usage — allocated (from super admin) vs consumed (from real calls) ──
    fastify.get('/usage', { preHandler: requireScope('activities:read') }, async (req, reply) => {
      const { period } = req.query as { period?: 'today' | '7d' | '30d' | 'month' | 'all' };
      const now = new Date();
      let fromDate: Date;
      switch (period) {
        case 'today': fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
        case '7d':    fromDate = new Date(now.getTime() - 7  * 86_400_000); break;
        case 'month': fromDate = new Date(now.getFullYear(), now.getMonth(), 1); break;
        case 'all':   fromDate = new Date(0); break;
        case '30d':
        default:      fromDate = new Date(now.getTime() - 30 * 86_400_000); break;
      }

      const usage = await db.withTenant(req.tenant.id, async (c) => {
        const quota = await c.query(
          `SELECT minutes_allocated FROM voice_bot_quotas WHERE tenant_id = $1`,
          [req.tenant.id],
        );
        const consumed = await c.query(
          `SELECT COALESCE(SUM(duration_seconds), 0) AS total_seconds, COUNT(*) AS call_count
             FROM voice_bot_calls WHERE tenant_id = $1 AND created_at >= $2`,
          [req.tenant.id, fromDate.toISOString()],
        );
        const consumedAllTime = await c.query(
          `SELECT COALESCE(SUM(duration_seconds), 0) AS total_seconds
             FROM voice_bot_calls WHERE tenant_id = $1`,
          [req.tenant.id],
        );
        const daily = await c.query(
          `SELECT DATE(created_at) AS date, COALESCE(SUM(duration_seconds), 0) / 60.0 AS minutes
             FROM voice_bot_calls WHERE tenant_id = $1 AND created_at >= $2
             GROUP BY DATE(created_at) ORDER BY date`,
          [req.tenant.id, fromDate.toISOString()],
        );
        return { quota: quota.rows[0], consumed: consumed.rows[0], consumedAllTime: consumedAllTime.rows[0], daily: daily.rows };
      });

      const allocated = Number(usage.quota?.minutes_allocated ?? 0);
      const consumedAllTimeMinutes = Number(usage.consumedAllTime.total_seconds) / 60;
      const remaining = allocated - consumedAllTimeMinutes;

      return reply.send({
        success: true,
        data: {
          allocatedMinutes: allocated,
          consumedMinutesAllTime: Number(consumedAllTimeMinutes.toFixed(2)),
          remainingMinutes: Number(remaining.toFixed(2)),
          period: {
            label: period ?? '30d',
            consumedMinutes: Number((Number(usage.consumed.total_seconds) / 60).toFixed(2)),
            callCount: Number(usage.consumed.call_count),
          },
          daily: usage.daily.map((d: any) => ({ date: d.date, minutes: Number(Number(d.minutes).toFixed(2)) })),
        },
      });
    });

    // ── Browser test call — dispatches Nadia into a fresh room and returns a
    //    join token, so a tenant admin can test the self-hosted bot from
    //    inside AmanahCX without a phone/SIP trunk. Distinct from /voice/web-call
    //    (which is blocked for tenant_admin by the operational-data wall) — this
    //    route lives under /voice-bot, which is deliberately exempt since it's
    //    settings/config work, not viewing real customer call data.
    fastify.post('/test-call-browser', { preHandler: requireRole('tenant_admin', 'super_admin') }, async (req, reply) => {
      const url = process.env.LIVEKIT_URL;
      const apiKey = process.env.LIVEKIT_API_KEY;
      const apiSecret = process.env.LIVEKIT_API_SECRET;
      if (!url || !apiKey || !apiSecret) {
        return reply.code(503).send({ success: false, error: { code: 'LIVEKIT_NOT_CONFIGURED', message: 'Voice calling is not configured yet.' } });
      }
      const agentName = process.env.LIVEKIT_AGENT_NAME || 'nadia';
      const room = `test-${req.tenant.id.slice(0, 8)}-${Date.now().toString(36)}`;
      const httpUrl = url.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
      const dispatchHost = process.env.LIVEKIT_DISPATCH_URL || httpUrl;

      try {
        const dispatchClient = new AgentDispatchClient(dispatchHost, apiKey, apiSecret);
        await dispatchClient.createDispatch(room, agentName, {
          metadata: JSON.stringify({ tenantId: req.tenant.id, startedBy: req.user.sub, source: 'voice_bot_admin_test' }),
        });
      } catch (err: any) {
        return reply.code(502).send({ success: false, error: { code: 'DISPATCH_FAILED', message: err?.message ?? 'agent dispatch failed' } });
      }

      const at = new AccessToken(apiKey, apiSecret, { identity: `test-${req.user.sub}`, name: 'Test Caller', ttl: '1h' });
      at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true });
      const token = await at.toJwt();

      return reply.send({ success: true, data: { url, token, room, agent: agentName } });
    });

    // ── Initiate a test call (Vapi / Retell) ───────────────────────────

    fastify.post('/test-call', { preHandler: requireRole('tenant_admin', 'super_admin') }, async (req, reply) => {
      const { provider, toNumber } = z.object({
        provider: z.enum(['vapi', 'retell', 'bland']),
        toNumber: z.string().min(5),
      }).parse(req.body);

      const [tenant] = await db.withSuperAdmin(async (c) => {
        const r = await c.query('SELECT settings FROM tenants WHERE id = $1', [req.tenant.id]);
        return r.rows;
      });
      const cfg: Record<string, string> = (tenant?.settings as any)?.connectors?.[provider] ?? {};

      if (!cfg.apiKey) {
        return reply.code(400).send({
          success: false,
          error: { code: 'NOT_CONFIGURED', message: `${provider} connector not configured` },
        });
      }

      try {
        let result: unknown;
        if (provider === 'vapi') {
          const res = await fetch('https://api.vapi.ai/call/phone', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${cfg.apiKey}`,
            },
            body: JSON.stringify({
              assistantId: cfg.assistantId,
              customer: { number: toNumber },
              phoneNumberId: cfg.phoneNumberId ?? undefined,
            }),
          });
          result = await res.json();
        } else if (provider === 'retell') {
          const res = await fetch('https://api.retellai.com/v2/create-phone-call', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${cfg.apiKey}`,
            },
            body: JSON.stringify({
              from_number: cfg.fromNumber,
              to_number: toNumber,
              agent_id: cfg.agentId,
            }),
          });
          result = await res.json();
        } else {
          const res = await fetch('https://api.bland.ai/v1/calls', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'authorization': cfg.apiKey,
            },
            body: JSON.stringify({
              phone_number: toNumber,
              from: cfg.phoneNumber ?? undefined,
              task: 'You are a customer support testing assistant. Say hello, ask the user to describe a test issue, then say goodbye.',
            }),
          });
          result = await res.json();
        }

        return reply.send({ success: true, data: result });
      } catch (err: any) {
        return reply.code(500).send({ success: false, error: { message: err.message } });
      }
    });

    // ══ LiveKit agent (Nadia) — structured ingestion ════════════════════════
    // Optional shared-secret: set LIVEKIT_INGEST_SECRET on the API; the agent
    // sends it as "Authorization: Bearer <secret>".
    const checkSecret = (req: any): boolean => {
      const secret = process.env.LIVEKIT_INGEST_SECRET;
      if (!secret) return true;
      return (req.headers['authorization'] || '') === `Bearer ${secret}`;
    };

    // Nadia's actual config fetch at the start of every call. The tenant-
    // side GET /config (above) requires a real logged-in user (requireScope)
    // and sits behind the global tenant-auth wall — Nadia has neither, so
    // every call to it was silently failing and falling back to
    // AgentSettings() defaults (bot_name "Nadia", the hardcoded HBL system
    // prompt) for EVERY tenant, discovered 2026-07-18 while verifying the
    // Agent Builder actually reaches a real call. Same public pattern as
    // the other /livekit/* routes — checked via the shared secret instead.
    fastify.get('/livekit/config', async (req, reply) => {
      const { tenantId } = req.query as { tenantId?: string };
      if (!tenantId) return reply.code(400).send({ error: 'tenantId query param required' });
      if (!checkSecret(req)) return reply.code(401).send({ error: 'unauthorized' });

      const configs = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `SELECT vbc.*, tq.name AS queue_name
             FROM voice_bot_configs vbc
             LEFT JOIN ticket_queues tq ON vbc.default_queue_id = tq.id
            WHERE vbc.tenant_id = $1`,
          [tenantId],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: configs });
    });

    // Branded hold audio bytes — Nadia downloads this once per call (when
    // the tenant has one uploaded) and plays it while doing back-office
    // work mid-call, stopping the instant she's ready to speak again.
    fastify.get('/livekit/hold-audio', async (req, reply) => {
      const { tenantId } = req.query as { tenantId?: string };
      if (!tenantId) return reply.code(400).send({ error: 'tenantId query param required' });
      if (!checkSecret(req)) return reply.code(401).send({ error: 'unauthorized' });

      const [row] = await db.withSuperAdmin(async (c) =>
        (await c.query(`SELECT filename, mimetype, data FROM voice_bot_hold_audio WHERE tenant_id = $1`, [tenantId])).rows);
      if (!row) return reply.code(404).send({ error: 'no_hold_audio' });
      reply.header('Content-Type', row.mimetype || 'audio/mpeg');
      reply.header('Content-Disposition', `attachment; filename="${row.filename}"`);
      return reply.send(row.data);
    });

    // Mid-call: create the complaint ticket from structured fields, return the TKT number.
    fastify.post('/livekit/complaint', async (req, reply) => {
      const { tenantId } = req.query as { tenantId?: string };
      if (!tenantId) return reply.code(400).send({ error: 'tenantId query param required' });
      if (!checkSecret(req)) return reply.code(401).send({ error: 'unauthorized' });

      const result = await createComplaintFromStructured(
        db, eventBus, tenantId, (req.body ?? {}) as StructuredComplaint,
      );
      if (!result) return reply.code(500).send({ success: false, error: 'ticket_creation_failed' });
      return reply.code(201).send({ success: true, ...result });
    });

    // Call-end: attach the final transcript / summary / recording to the call record.
    fastify.post('/livekit/call-ended', async (req, reply) => {
      const { tenantId } = req.query as { tenantId?: string };
      if (!tenantId) return reply.code(400).send({ error: 'tenantId query param required' });
      if (!checkSecret(req)) return reply.code(401).send({ error: 'unauthorized' });

      const b = (req.body ?? {}) as {
        voiceCallId?: string; transcript?: string; summary?: string;
        recordingUrl?: string; durationSeconds?: number; sentiment?: string;
      };
      if (!b.voiceCallId) return reply.code(400).send({ error: 'voiceCallId required' });

      // b.voiceCallId is the LiveKit room name, which the agent also stored as
      // provider_call_id when it raised a ticket mid-call — so match on that,
      // NOT the internal row id (they're different; matching by id silently
      // updated nothing, losing the full transcript + recording URL). Upsert
      // so calls that produced NO ticket (no row yet) still get their
      // transcript/recording saved and show up on the Bot Calls page.
      await db.withSuperAdmin(async (c) => {
        await c.query(
          `INSERT INTO voice_bot_calls
             (tenant_id, provider, provider_call_id, status, transcript, summary,
              recording_url, duration_seconds, sentiment, started_at, ended_at)
           VALUES ($1,'livekit',$2,'completed',$3,$4,$5,$6,$7,NOW(),NOW())
           ON CONFLICT (provider, provider_call_id) DO UPDATE SET
             transcript       = COALESCE(EXCLUDED.transcript,       voice_bot_calls.transcript),
             summary          = COALESCE(EXCLUDED.summary,          voice_bot_calls.summary),
             recording_url    = COALESCE(EXCLUDED.recording_url,    voice_bot_calls.recording_url),
             duration_seconds = COALESCE(EXCLUDED.duration_seconds, voice_bot_calls.duration_seconds),
             sentiment        = COALESCE(EXCLUDED.sentiment,        voice_bot_calls.sentiment),
             ended_at         = NOW()`,
          [tenantId, b.voiceCallId, b.transcript ?? null, b.summary ?? null,
           b.recordingUrl ?? null, b.durationSeconds ?? null, b.sentiment ?? null],
        );
      });
      await checkVoiceBotUsageThresholds(db, tenantId).catch(() => {
        // Never let a notification failure affect the call-ended response —
        // the transcript/recording save above already succeeded regardless.
      });
      // Free up the concurrency slot this call was holding. Best-effort —
      // stale rows also self-expire (see the 2-hour cutoff in the
      // concurrency-status query below), so a failure here never wedges
      // capacity permanently.
      await db.withSuperAdmin(async (c) => {
        await c.query(`DELETE FROM active_voice_calls WHERE call_id = $1`, [b.voiceCallId]);
      }).catch(() => {});
      return reply.send({ success: true });
    });

    // Nadia calls this the moment a call starts (before the greeting) to
    // register itself as "in progress" and find out whether it should
    // proceed normally or immediately hand off because either this
    // tenant's own fairness cap, or the whole VPS's hardware capacity,
    // is already full. Registering + checking in one call keeps this to a
    // single round trip on the call's critical path.
    fastify.post('/livekit/call-started', async (req, reply) => {
      const { tenantId } = req.query as { tenantId?: string };
      if (!tenantId) return reply.code(400).send({ error: 'tenantId query param required' });
      if (!checkSecret(req)) return reply.code(401).send({ error: 'unauthorized' });
      const { callId } = (req.body ?? {}) as { callId?: string };
      if (!callId) return reply.code(400).send({ error: 'callId required' });

      await db.withSuperAdmin(async (c) => {
        await c.query(
          `INSERT INTO active_voice_calls (tenant_id, call_id) VALUES ($1, $2)
           ON CONFLICT (call_id) DO NOTHING`,
          [tenantId, callId],
        );
      });

      // Crashed worker processes can leave a row behind forever without a
      // matching call-ended cleanup — anything older than 2 hours can't
      // possibly still be a live call, so it's excluded from both counts
      // rather than permanently eating into capacity.
      const [{ tenant_active }] = await db.withSuperAdmin(async (c) =>
        (await c.query(
          `SELECT COUNT(*)::int AS tenant_active FROM active_voice_calls
           WHERE tenant_id = $1 AND started_at > NOW() - INTERVAL '2 hours'`,
          [tenantId],
        )).rows);
      const [{ global_active }] = await db.withSuperAdmin(async (c) =>
        (await c.query(
          `SELECT COUNT(*)::int AS global_active FROM active_voice_calls
           WHERE started_at > NOW() - INTERVAL '2 hours'`,
        )).rows);
      const [config] = await db.withSuperAdmin(async (c) =>
        (await c.query(`SELECT max_concurrent_calls FROM voice_bot_configs WHERE tenant_id = $1`, [tenantId])).rows);

      const tenantMax = config?.max_concurrent_calls != null ? Number(config.max_concurrent_calls) : null;
      const globalMax = Number(process.env.NADIA_GLOBAL_MAX_CONCURRENT_CALLS || 15);

      let overCapacity = false;
      let reason: 'tenant_limit' | 'global_limit' | null = null;
      if (tenantMax != null && tenant_active > tenantMax) {
        overCapacity = true;
        reason = 'tenant_limit';
      } else if (global_active > globalMax) {
        overCapacity = true;
        reason = 'global_limit';
      }

      return reply.send({
        success: true, overCapacity, reason,
        tenantActive: tenant_active, tenantMax,
        globalActive: global_active, globalMax,
      });
    });

    // Nadia calls this at the start of every call to decide whether to
    // proceed normally or fall back (minutes exhausted). Same public
    // pattern as the other /livekit/* routes — excluded from the tenant
    // auth wall, checked via the shared secret instead.
    fastify.get('/livekit/minutes-status', async (req, reply) => {
      const { tenantId } = req.query as { tenantId?: string };
      if (!tenantId) return reply.code(400).send({ error: 'tenantId query param required' });
      if (!checkSecret(req)) return reply.code(401).send({ error: 'unauthorized' });

      const [quota] = await db.withSuperAdmin(async (c) =>
        (await c.query(`SELECT minutes_allocated FROM voice_bot_quotas WHERE tenant_id = $1`, [tenantId])).rows);
      // No quota row at all = no minutes have ever been allocated to this
      // tenant — treat as exhausted (zero available), not unlimited. The
      // voice bot must only be functional up to what's actually allocated;
      // with nothing allocated, every call hands off to a human. Reversed
      // 2026-07-20 — the previous "no row = unlimited" behaviour meant any
      // tenant a platform admin hadn't gotten around to allocating minutes
      // for got a fully working bot anyway, for every sector.
      if (!quota) return reply.send({ success: true, exhausted: true, remainingMinutes: 0 });

      const [consumed] = await db.withSuperAdmin(async (c) =>
        (await c.query(`SELECT COALESCE(SUM(duration_seconds), 0) AS total_seconds FROM voice_bot_calls WHERE tenant_id = $1`, [tenantId])).rows);
      const allocated = Number(quota.minutes_allocated);
      const consumedMinutes = Number(consumed.total_seconds) / 60;
      const remaining = allocated - consumedMinutes;
      return reply.send({ success: true, exhausted: remaining <= 0, remainingMinutes: Number(remaining.toFixed(1)) });
    });

    // Mid-call identity check — Nadia calls this the moment a caller shares
    // ANY ONE identifier (phone, NIC, or email), before she's collected
    // enough to file/update a ticket. Read-only: never creates a contact.
    // "strong" means two of the three identifiers agreed with the same
    // contact already on file; "weak" means only the one given identifier
    // matched, so Nadia should read back the first name and ask the caller
    // to confirm before relying on it (e.g. before quoting balance/order
    // details tied to that contact).
    fastify.get('/livekit/lookup-contact', async (req, reply) => {
      const { tenantId, phone, nic, email } = req.query as {
        tenantId?: string; phone?: string; nic?: string; email?: string;
      };
      if (!tenantId) return reply.code(400).send({ error: 'tenantId query param required' });
      if (!checkSecret(req)) return reply.code(401).send({ error: 'unauthorized' });
      if (!phone && !nic && !email) {
        return reply.send({ success: true, found: false });
      }

      const match = await db.withSuperAdmin(async (c) =>
        matchContact(c, tenantId, { phone, nic, email }));

      if (!match) return reply.send({ success: true, found: false });
      return reply.send({
        success: true, found: true,
        confidence: match.confidence,
        firstName: match.first_name ?? null,
      });
    });
  };
}
