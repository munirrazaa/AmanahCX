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
  const type   = (body.type ?? body.message?.type ?? '') as string;
  const call   = (body.call ?? body.message?.call ?? body) as any;
  const analysis = (body.analysis ?? body.message?.analysis ?? {}) as any;

  if (!['end-of-call-report', 'call-ended', 'call.ended'].includes(type) && !call?.id) return null;

  const transcript = (body.transcript ?? body.message?.transcript ?? call?.transcript ?? '') as string;
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
    extractedName:  (body.variables?.customer_name ?? body.metadata?.customer_name) as string | undefined,
    extractedEmail: (body.variables?.customer_email ?? body.metadata?.customer_email) as string | undefined,
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

    // These five lookups/inserts are mutually independent — none needs
    // another's result — so run them concurrently instead of one at a time.
    // Each `db.withSuperAdmin` round-trips to a REMOTE (Supabase) database;
    // sequentially that was 5 of the 7 total round-trips in this function,
    // the dominant cost in the ~5s+ ticket-creation delay reported live
    // 2026-07-13. Cuts this function from 7 sequential round-trips to 3.
    const [[contact], [{ next_val }], [queueRow], [slaRow], [botCall], [config]] = await Promise.all([
      db.withSuperAdmin(async (c) => {
        const normalised = s.reporterPhone?.replace(/\D/g, '').slice(-10) ?? null;
        const addressFields = s.reporterAddress || s.reporterCity
          ? { address: s.reporterAddress ?? null, city: s.reporterCity ?? null }
          : null;

        if (normalised) {
          const r = await c.query(
            `SELECT id, email, nic_number, custom_fields FROM contacts
             WHERE tenant_id=$1 AND (phone ILIKE $2 OR mobile ILIKE $2) LIMIT 1`,
            [tenantId, `%${normalised}%`],
          );
          if (r.rows.length) {
            // Existing caller — fill in any details we didn't have before,
            // never overwrite something already on file.
            const existing = r.rows[0];
            const mergedCustomFields = addressFields
              ? { ...addressFields, ...existing.custom_fields }
              : existing.custom_fields;
            await c.query(
              `UPDATE contacts SET
                 email = COALESCE(email, $2),
                 nic_number = COALESCE(nic_number, $3),
                 custom_fields = $4::jsonb
               WHERE id = $1`,
              [existing.id, s.reporterEmail ?? null, s.reporterNic ?? null, JSON.stringify(mergedCustomFields ?? {})],
            );
            return [{ id: existing.id }];
          }
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
          `INSERT INTO voice_bot_calls
             (tenant_id, provider, provider_call_id, from_number, status, transcript, summary,
              sentiment, extracted_subject, extracted_priority, extracted_reporter_name,
              extracted_reporter_email, raw_payload)
           VALUES ($1,'livekit',$2,$3,'completed',$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
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
    const ivrMenu = config?.ivr_menu ?? DEFAULT_IVR_MENU;
    const text = ((s.category ?? '') + ' ' + (s.subject ?? '') + ' ' + (s.description ?? '') + ' ' + (s.transcript ?? '')).toLowerCase();
    let ticketType = 'complaint';
    if (text.includes('sales') || text.includes('buy') || text.includes('purchase') || text.includes('price') || text.includes('offer')) {
      ticketType = 'sales';
    } else if (text.includes('inquiry') || text.includes('enquiry') || text.includes('information') || text.includes('product') || text.includes('service')) {
      ticketType = 'inquiry';
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
         VALUES ($1,$2,$3,$4,'open',$5,'voice_bot',$6,$7,$8,$9,$10,$11,'complaint',$12,$13::jsonb)
         RETURNING id`,
        [tenantId, ticketNumber, subject, description, priority,
         resolvedQueueId, slaRow?.id ?? null, contact?.id ?? null,
         s.reporterPhone ?? null, s.reporterName ?? null, s.reporterEmail ?? null,
         [s.category ?? 'other'],
         JSON.stringify({ category: s.category, fraud_amount: s.fraudAmount, agent: 'nadia' })],
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

    fastify.get('/config', { preHandler: requireScope('settings:read') }, async (req, reply) => {
      const configs = await db.withTenant(req.tenant.id, async (c) => {
        const r = await c.query(
          `SELECT vbc.*, tq.name AS queue_name
           FROM voice_bot_configs vbc
           LEFT JOIN ticket_queues tq ON vbc.default_queue_id = tq.id`,
        );
        return r.rows;
      });
      return reply.send({ success: true, data: configs });
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
    });

    fastify.put('/config', { preHandler: requireRole('tenant_admin', 'super_admin') }, async (req, reply) => {
      const body = ConfigSchema.parse(req.body);

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
               guardrails, recording_enabled)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                    $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34)
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
      const { id } = req.params as { id: string };
      await db.withTenant(req.tenant.id, async (c) => {
        await c.query(`DELETE FROM voice_bot_custom_intents WHERE id = $1 AND tenant_id = $2`, [id, req.tenant.id]);
      });
      return reply.send({ success: true });
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
        extractedEmail:      null,
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
      return reply.send({ success: true });
    });
  };
}
