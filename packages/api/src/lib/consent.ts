/**
 * Per-channel consent helpers (CB-04).
 *
 * Meta's WhatsApp Business API requires provable customer opt-in before
 * business-initiated messages; violations can suspend the tenant's WhatsApp
 * account. Every outbound WhatsApp/SMS send path should consult
 * getChannelConsent() before dispatching, and customer actions that imply
 * consent (e.g. choosing WhatsApp as their preferred contact channel on a
 * ticket) should be recorded via recordChannelConsent() so the audit trail
 * exists.
 */

import type { DatabaseClient } from '@crm/core';

export type ConsentChannel = 'whatsapp' | 'sms' | 'email';

/**
 * Latest consent state for a contact+channel.
 * Returns true (opted in), false (explicitly opted out), or null (no record).
 */
export async function getChannelConsent(
  db: DatabaseClient,
  tenantId: string,
  contactId: string,
  channel: ConsentChannel,
): Promise<boolean | null> {
  const [row] = await db.withTenant(tenantId, async (client) => {
    const r = await client.query<{ opted_in: boolean }>(
      `SELECT opted_in FROM contact_channel_consent
       WHERE contact_id = $1 AND channel = $2
       ORDER BY consented_at DESC LIMIT 1`,
      [contactId, channel],
    );
    return r.rows;
  });
  return row ? row.opted_in : null;
}

/**
 * Record a consent event. Never overwrites — each call appends a new row.
 * Use source 'form' for customer-initiated choices (e.g. preferred channel on
 * a ticket), 'reply' for inbound-message-derived opt-ins, 'manual' for staff
 * toggles (the Contact Detail UI uses 'manual' directly via the API route).
 */
export async function recordChannelConsent(
  db: DatabaseClient,
  opts: {
    tenantId:   string;
    contactId:  string;
    channel:    ConsentChannel;
    optedIn:    boolean;
    source:     'manual' | 'reply' | 'form' | 'import' | 'api';
    recordedBy?: string | null;
    notes?:      string | null;
  },
): Promise<void> {
  await db.withTenant(opts.tenantId, async (client) => {
    await client.query(
      `INSERT INTO contact_channel_consent
         (tenant_id, contact_id, channel, opted_in, source, recorded_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [opts.tenantId, opts.contactId, opts.channel, opts.optedIn, opts.source,
       opts.recordedBy ?? null, opts.notes ?? null],
    );
  });
}
