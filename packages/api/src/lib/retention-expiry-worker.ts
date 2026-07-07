/**
 * Retention Expiry Worker
 *
 * Runs once daily (every 24h).
 * Finds published recording_retention_policies where expires_at is within 30 days
 * and last_warned_at is null or > 30 days ago, then emails the tenant admin(s).
 */

import type { DatabaseClient } from '@crm/core';

async function sendSystemEmail(opts: {
  to: string; toName: string; subject: string; bodyHtml: string; bodyText: string;
}): Promise<boolean> {
  const sg     = process.env.SENDGRID_API_KEY;
  const sgFrom = process.env.SENDGRID_FROM_EMAIL;
  if (!sg || !sgFrom) return false;
  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sg}` },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: opts.to, name: opts.toName }] }],
        from: { email: sgFrom, name: process.env.SENDGRID_FROM_NAME ?? 'AmanahCX Platform' },
        subject: opts.subject,
        content: [
          { type: 'text/plain', value: opts.bodyText },
          { type: 'text/html',  value: opts.bodyHtml  },
        ],
      }),
    });
    return res.ok || res.status === 202;
  } catch { return false; }
}

async function checkExpiringPolicies(db: DatabaseClient) {
  // Policies expiring within 30 days that haven't been warned recently
  const expiring = await db.query<{
    id: number; tenant_id: string; policy_name: string; expires_at: string;
    retention_days: number;
  }>(
    `SELECT id, tenant_id, policy_name, expires_at, retention_days
     FROM recording_retention_policies
     WHERE policy_status = 'published'
       AND expires_at IS NOT NULL
       AND expires_at <= NOW() + INTERVAL '30 days'
       AND (last_warned_at IS NULL OR last_warned_at < NOW() - INTERVAL '29 days')`,
    [],
  );

  for (const policy of expiring) {
    const daysLeft = Math.ceil(
      (new Date(policy.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );

    // Get tenant admin emails for this tenant
    const admins = await db.query<{ email: string; name: string }>(
      `SELECT u.email, u.name
       FROM users u
       WHERE u.tenant_id = $1 AND u.role = 'tenant_admin' AND u.is_active = TRUE
       LIMIT 5`,
      [policy.tenant_id],
    );

    const subject = daysLeft <= 0
      ? `⚠️ Recording Retention Period Has Expired — Action Required`
      : `⚠️ Recording Retention Expiring in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;

    const bodyText = daysLeft <= 0
      ? `Your voice recording retention policy "${policy.policy_name}" has expired. New recordings may not be retained until you extend the policy. Please log in and raise a Storage Extension order.`
      : `Your voice recording retention policy "${policy.policy_name}" will expire in ${daysLeft} days (${new Date(policy.expires_at).toLocaleDateString()}). After expiry, new recordings will not be retained under this policy.\n\nTo extend: log in → Governance → Orders → New Order → Storage Extension.`;

    const bodyHtml = daysLeft <= 0
      ? `<p>Your voice recording retention policy <strong>"${policy.policy_name}"</strong> has <strong>expired</strong>.</p><p>New recordings may not be retained until you extend the policy.</p><p>Log in → Governance → Orders → <strong>New Order → Storage Extension</strong> to request an extension.</p>`
      : `<p>Your voice recording retention policy <strong>"${policy.policy_name}"</strong> will expire in <strong>${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong> on ${new Date(policy.expires_at).toLocaleDateString()}.</p><p>After expiry, new recordings will not be retained under this policy.</p><p>Log in → Governance → Orders → <strong>New Order → Storage Extension</strong> to request an extension.</p>`;

    let sent = false;
    for (const admin of admins) {
      const ok = await sendSystemEmail({ to: admin.email, toName: admin.name, subject, bodyText, bodyHtml });
      if (ok) sent = true;
    }

    if (sent || admins.length === 0) {
      // Mark warned so we don't spam daily
      await db.query(
        `UPDATE recording_retention_policies SET last_warned_at = NOW() WHERE id = $1`,
        [policy.id],
      );
    }
  }

  if (expiring.length > 0) {
    console.info(`[retention-worker] Warned ${expiring.length} expiring policy(ies).`);
  }
}

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function startRetentionExpiryWorker(db: DatabaseClient): () => void {
  // Run immediately on boot, then every 24h
  checkExpiringPolicies(db).catch(e =>
    console.error('[retention-worker] Boot check failed:', e?.message),
  );
  const timer = setInterval(() => {
    checkExpiringPolicies(db).catch(e =>
      console.error('[retention-worker] Daily check failed:', e?.message),
    );
  }, INTERVAL_MS);

  return () => clearInterval(timer);
}
