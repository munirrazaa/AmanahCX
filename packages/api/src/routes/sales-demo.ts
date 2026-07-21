/**
 * Sales Demo routes — /api/v1/sales-demo
 *
 * Standalone, product-agnostic "talk to Nadia" demo used for sales pitches.
 * Runs the SAME intent-capture logic as the real Nadia voice agent
 * (identify caller -> check knowledge base -> raise ticket), but over typed
 * text instead of a live phone call, so it works without a SIP trunk.
 *
 * It does NOT reimplement contact/ticket creation — it calls the existing
 * public /api/v1/voice-bot/livekit/* endpoints (the same contract Nadia's
 * Python agent already uses, see nadia-voice-agent/src/crm_client.py), so
 * behaviour never drifts from the real thing.
 *
 * Every contact/ticket this creates is tagged `sales_demo` (tag + a
 * demo_session_id in custom_fields) so a demo can be reset without
 * touching any real data, and so this never gets mistaken for a genuine
 * lead. Nothing about the real Voice Bot test-call widget is touched by
 * this file.
 *
 * Deliberately standalone: this module's only dependency on the rest of
 * the platform is that public /livekit/* HTTP contract — the same reason
 * it can be reused unchanged by any other product (e.g. CA Firm Platform)
 * that implements the same three endpoints.
 */

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import OpenAI from 'openai';
import type { DatabaseClient } from '@crm/core';
import { requireRole } from '../middlewares/auth.middleware';

// ── Pre-built scenarios (data, not code — add a sector/scenario by editing ──
// ── this list only; nothing else needs to change) ───────────────────────
export interface DemoScenario {
  id: string;
  sector: string;
  label: string;
  openingLine: string; // what the "customer" says first, pre-fills the input
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: 'banking-fraud',
    sector: 'Banking',
    label: 'Fraud Complaint',
    openingLine: "Hi, I just noticed a transaction on my account that I didn't make. I think someone accessed my account without permission.",
  },
  {
    id: 'banking-loan-inquiry',
    sector: 'Banking',
    label: 'Loan Product Inquiry',
    openingLine: "Hi, I'm interested in your business loan options. Can you tell me more about eligibility?",
  },
  {
    id: 'banking-service-complaint',
    sector: 'Banking',
    label: 'Branch Service Complaint',
    openingLine: 'I visited your branch yesterday and waited over an hour without being served. I want to file a complaint.',
  },
  {
    id: 'ca-firm-filing-delay',
    sector: 'CA Firm',
    label: 'Service Delay Complaint',
    openingLine: 'My tax filing was supposed to be done last week and nobody has updated me. I want to know what is going on.',
  },
  {
    id: 'ca-firm-new-client-inquiry',
    sector: 'CA Firm',
    label: 'New Client Inquiry',
    openingLine: "Hi, I'm starting a small business and I need help with bookkeeping and tax registration. Can you tell me what services you offer?",
  },
  {
    id: 'ca-firm-document-request',
    sector: 'CA Firm',
    label: 'Document Request',
    openingLine: 'I need a copy of last year’s audited financial statements for a bank loan application.',
  },
];

// ── In-memory session state (demo-only; not meant to survive a restart) ──
interface DemoEvent {
  type: 'intent' | 'category' | 'priority' | 'contact' | 'ticket' | 'kb_answer';
  label: string;
  value: string;
  at: string;
}

interface DemoSession {
  tenantId: string;
  scenarioId: string | null;
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; tool_calls?: any[]; name?: string }>;
  events: DemoEvent[];
  createdAt: number;
}

const sessions = new Map<string, DemoSession>();

// Stale sessions (left open in a browser tab) never need to live past an
// hour — bounds memory without needing a cron job for a demo-only feature.
const SESSION_TTL_MS = 60 * 60 * 1000;
function pruneStaleSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

const SYSTEM_PROMPT = `You are Nadia, a voice assistant for a business's helpline, running in a SALES DEMO so a salesperson can show a prospective client how you work. Stay in character as Nadia talking to a customer.

Your job:
1. Understand the customer's intent (complaint, inquiry, or sales interest).
2. If it's a general question you can answer from your knowledge base, call check_knowledge_base first.
3. Otherwise, collect: full name, phone number, and ideally email address, plus a clear description of the issue. Ask for these naturally, one or two at a time, not as a rigid form.
4. The moment you learn ANY of phone/email, call identify_caller so returning customers can be recognised.
5. Once you have name, phone, category, priority and a one-line subject, call raise_ticket exactly once per issue. Read back the real ticket number it returns.
6. Keep replies short and natural, like a real support call — 1-3 sentences.
7. For anything sounding urgent (fraud, safety, service outage), set priority to "urgent".`;

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'identify_caller',
      description: 'Look up whether this caller is an existing contact, the moment they share a phone number or email.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string' },
          email: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_knowledge_base',
      description: "Check the business's knowledge base for a direct answer before assuming something needs a ticket.",
      parameters: {
        type: 'object',
        properties: { question: { type: 'string' } },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'raise_ticket',
      description: 'Create a support ticket once enough details have been collected.',
      parameters: {
        type: 'object',
        properties: {
          reporter_name: { type: 'string' },
          reporter_phone: { type: 'string' },
          reporter_email: { type: 'string' },
          category: {
            type: 'string',
            enum: ['loan_issue', 'account_issue', 'staff_complaint', 'digital_banking', 'fraud', 'branch_service', 'inquiry', 'sales', 'other'],
          },
          priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
          subject: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['reporter_name', 'reporter_phone', 'category', 'priority', 'subject', 'description'],
      },
    },
  },
];

function internalHeaders(): Record<string, string> {
  const secret = process.env.LIVEKIT_INGEST_SECRET;
  return secret ? { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

function apiBase(): string {
  // Internal loopback call — the demo backend calls the same public
  // /livekit/* contract Nadia's own agent uses, over the network the API
  // is already listening on. Same host:port this process bound to.
  return process.env.INTERNAL_API_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4000}`;
}

export function salesDemoRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {
    // Demo is a sales tool, not a tenant feature — restrict to admins so it
    // can never surface for an ordinary agent/rep login.
    fastify.addHook('preHandler', requireRole('tenant_admin', 'super_admin'));

    fastify.get('/scenarios', async (_req, reply) => {
      return reply.send({ success: true, data: DEMO_SCENARIOS });
    });

    fastify.post('/start', async (req, reply) => {
      pruneStaleSessions();
      const body = z.object({ scenarioId: z.string().optional() }).parse(req.body ?? {});
      const scenario = DEMO_SCENARIOS.find(s => s.id === body.scenarioId) ?? null;

      const sessionId = randomUUID();
      sessions.set(sessionId, {
        tenantId: req.tenant.id,
        scenarioId: scenario?.id ?? null,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }],
        events: [],
        createdAt: Date.now(),
      });

      return reply.send({
        success: true,
        sessionId,
        openingLine: scenario?.openingLine ?? null,
      });
    });

    fastify.post('/message', async (req, reply) => {
      const body = z.object({ sessionId: z.string(), text: z.string().min(1) }).parse(req.body);
      const session = sessions.get(body.sessionId);
      if (!session) return reply.code(404).send({ success: false, error: 'session_expired' });
      if (session.tenantId !== req.tenant.id) return reply.code(403).send({ success: false, error: 'forbidden' });

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return reply.code(500).send({ success: false, error: 'OPENAI_API_KEY not configured' });
      const openai = new OpenAI({ apiKey });

      session.messages.push({ role: 'user', content: body.text });

      // Tool-calling loop: keep letting the model call tools until it
      // produces a plain reply, same pattern as Nadia's agent.py.
      let reply_text = '';
      for (let iterations = 0; iterations < 5; iterations++) {
        const completion = await openai.chat.completions.create({
          model: process.env.SALES_DEMO_LLM_MODEL || 'gpt-4o-mini',
          messages: session.messages as any,
          tools: TOOLS,
        });
        const choice = completion.choices[0].message;
        session.messages.push({ role: 'assistant', content: choice.content ?? '', tool_calls: choice.tool_calls } as any);

        if (!choice.tool_calls || choice.tool_calls.length === 0) {
          reply_text = choice.content ?? '';
          break;
        }

        for (const call of choice.tool_calls) {
          const args = JSON.parse(call.function.arguments || '{}');
          const result = await runTool(call.function.name, args, session, req.tenant.id, body.sessionId);
          session.messages.push({ role: 'tool', tool_call_id: call.id, content: result, name: call.function.name } as any);
        }
      }

      return reply.send({ success: true, reply: reply_text, events: session.events });
    });

    fastify.post('/reset', async (req, reply) => {
      const body = z.object({ sessionId: z.string() }).parse(req.body);
      const session = sessions.get(body.sessionId);
      if (session && session.tenantId !== req.tenant.id) return reply.code(403).send({ success: false, error: 'forbidden' });

      await db.withSuperAdmin(async (c) => {
        await c.query(
          `DELETE FROM tickets WHERE tenant_id = $1 AND custom_fields->>'demo_session_id' = $2`,
          [req.tenant.id, body.sessionId],
        );
        await c.query(
          `DELETE FROM contacts WHERE tenant_id = $1 AND $2 = ANY(tags) AND custom_fields->>'demo_session_id' = $3`,
          [req.tenant.id, 'sales_demo', body.sessionId],
        );
        await c.query(
          `DELETE FROM voice_bot_calls WHERE tenant_id = $1 AND provider_call_id = $2`,
          [req.tenant.id, `demo_${body.sessionId}`],
        );
      });

      sessions.delete(body.sessionId);
      return reply.send({ success: true });
    });
  };
}

async function runTool(
  name: string,
  args: Record<string, any>,
  session: DemoSession,
  tenantId: string,
  sessionId: string,
): Promise<string> {
  const now = new Date().toISOString();

  if (name === 'identify_caller') {
    try {
      const params = new URLSearchParams({ tenantId });
      if (args.phone) params.set('phone', args.phone);
      if (args.email) params.set('email', args.email);
      const resp = await fetch(`${apiBase()}/api/v1/voice-bot/livekit/lookup-contact?${params}`, { headers: internalHeaders() });
      const data = await resp.json();
      if (data?.found) {
        session.events.push({ type: 'contact', label: 'Contact matched', value: data.firstName || 'existing contact', at: now });
        return `Found existing contact: ${data.firstName || 'caller'} (confidence: ${data.confidence}).`;
      }
      return 'No existing record — continue normally.';
    } catch {
      return 'Lookup unavailable — continue normally.';
    }
  }

  if (name === 'check_knowledge_base') {
    try {
      const params = new URLSearchParams({ tenantId, q: args.question || '' });
      const resp = await fetch(`${apiBase()}/api/v1/voice-bot/knowledge-base/search?${params}`, { headers: internalHeaders() });
      const data = await resp.json();
      if (data?.data) {
        session.events.push({ type: 'kb_answer', label: 'Answered from knowledge base', value: data.data.title || args.question, at: now });
        return `Found in knowledge base: ${data.data.content}`;
      }
      return 'No match found — continue normally.';
    } catch {
      return 'Knowledge base unavailable — continue normally.';
    }
  }

  if (name === 'raise_ticket') {
    session.events.push({ type: 'intent', label: 'Intent captured', value: args.category, at: now });
    session.events.push({ type: 'category', label: 'Category', value: args.category, at: now });
    session.events.push({ type: 'priority', label: 'Priority', value: args.priority, at: now });

    try {
      const resp = await fetch(`${apiBase()}/api/v1/voice-bot/livekit/complaint?tenantId=${encodeURIComponent(tenantId)}`, {
        method: 'POST',
        headers: internalHeaders(),
        body: JSON.stringify({
          callId: `demo_${sessionId}`,
          reporterName: args.reporter_name,
          reporterPhone: args.reporter_phone,
          reporterEmail: args.reporter_email,
          category: args.category,
          priority: args.priority,
          subject: args.subject,
          description: args.description,
          // Tags this ticket/contact as demo data so /reset can find and
          // remove it without touching real records.
          demoSessionId: sessionId,
          demoTag: 'sales_demo',
        }),
      });
      const data = await resp.json();
      if (!data?.success) return 'Ticket creation failed — apologise and say a representative will follow up.';

      session.events.push({ type: 'ticket', label: 'Ticket created', value: data.ticketNumber, at: now });
      return `Ticket ${data.ticketNumber} created.`;
    } catch {
      return 'Ticket creation failed — apologise and say a representative will follow up.';
    }
  }

  return 'Unknown tool.';
}
