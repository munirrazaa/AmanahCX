"use strict";
/**
 * EmailService
 *
 * Reads tenant connector credentials (smtp or sendgrid) and dispatches
 * emails through the configured provider.  Every sent email is logged
 * to the `emails` table and cross-referenced as an activity so it appears
 * in contact / deal timelines.
 *
 * Providers
 *  • SMTP   — nodemailer (covers Gmail App Password, Outlook, Mailgun SMTP …)
 *  • SendGrid — v3 Mail Send REST API via native fetch (no SDK needed)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailService = void 0;
const logger_1 = require("./config/logger");
// ── Email Service ─────────────────────────────────────────────────────────
class EmailService {
    db;
    constructor(db) {
        this.db = db;
    }
    // ── Resolve provider from tenant connector settings ──────────────────
    async getConnectorConfig(tenantId) {
        const [tenant] = await this.db.withSuperAdmin(async (client) => {
            const r = await client.query('SELECT settings FROM tenants WHERE id = $1', [tenantId]);
            return r.rows;
        });
        const connectors = tenant?.settings?.connectors ?? {};
        // Priority: SendGrid > Microsoft 365 Graph > Gmail/SMTP
        if (connectors.sendgrid?.apiKey && connectors.sendgrid?.fromEmail) {
            return { provider: 'sendgrid', config: connectors.sendgrid };
        }
        if (connectors.microsoft365?.tenantId && connectors.microsoft365?.clientId && connectors.microsoft365?.clientSecret && connectors.microsoft365?.fromEmail) {
            return { provider: 'microsoft365', config: connectors.microsoft365 };
        }
        // Gmail connector stores in 'gmail' key but sends via SMTP
        if (connectors.gmail?.user && connectors.gmail?.password) {
            const gmailCfg = {
                host: connectors.gmail.host || 'smtp.gmail.com',
                port: connectors.gmail.port || '587',
                user: connectors.gmail.user,
                password: connectors.gmail.password,
                fromName: connectors.gmail.fromName,
                fromEmail: connectors.gmail.user,
            };
            return { provider: 'smtp', config: gmailCfg };
        }
        if (connectors.smtp?.host && connectors.smtp?.user && connectors.smtp?.password) {
            return { provider: 'smtp', config: connectors.smtp };
        }
        // System-level fallback: use platform SendGrid key when tenant has no connector
        const sysKey = process.env.SENDGRID_API_KEY;
        const sysFrom = process.env.SENDGRID_FROM_EMAIL;
        const sysName = process.env.SENDGRID_FROM_NAME;
        if (sysKey && sysFrom) {
            return { provider: 'sendgrid', config: { apiKey: sysKey, fromEmail: sysFrom, fromName: sysName } };
        }
        return { provider: null, config: null };
    }
    // ── Public send ───────────────────────────────────────────────────────
    async send(tenantId, opts) {
        const toList = Array.isArray(opts.to) ? opts.to : [opts.to];
        const toEmail = toList[0]; // primary recipient for DB record
        // ── 1. Create email record (status = queued) ──
        const emailId = await this.db.withSuperAdmin(async (client) => {
            // Bypass RLS — we need super-admin to write directly
            const r = await client.query(`INSERT INTO emails
           (tenant_id, from_email, from_name, to_email, to_name, cc, bcc, reply_to,
            subject, body_html, body_text, status, contact_id, deal_id, ticket_id, sent_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'queued',$12,$13,$14,$15)
         RETURNING id`, [
                tenantId,
                '', // from — filled in below once we know the provider
                '',
                toEmail,
                opts.toName ?? null,
                opts.cc ?? [],
                opts.bcc ?? [],
                opts.replyTo ?? null,
                opts.subject,
                opts.bodyHtml ?? null,
                opts.bodyText ?? null,
                opts.contactId ?? null,
                opts.dealId ?? null,
                opts.ticketId ?? null,
                opts.sentBy ?? null,
            ]);
            return r.rows[0].id;
        });
        // ── 2. Resolve connector ──────────────────────
        const { provider, config } = await this.getConnectorConfig(tenantId);
        if (!provider || !config) {
            await this.markFailed(emailId, 'No email connector configured. Please set up SMTP or SendGrid in Integrations.');
            return { emailId, status: 'failed', error: 'No email connector configured' };
        }
        // Compute from address
        let fromEmail;
        let fromName;
        if (provider === 'sendgrid') {
            fromEmail = config.fromEmail;
            fromName = config.fromName;
        }
        else if (provider === 'microsoft365') {
            fromEmail = config.fromEmail;
            fromName = config.fromName;
        }
        else {
            fromEmail = config.fromEmail || config.user;
            fromName = config.fromName;
        }
        // Update from fields in DB
        await this.db.withSuperAdmin(async (client) => {
            await client.query(`UPDATE emails SET from_email = $1, from_name = $2, provider = $3, status = 'sending', updated_at = NOW()
         WHERE id = $4`, [fromEmail, fromName ?? null, provider, emailId]);
        });
        // ── 3. Dispatch ───────────────────────────────
        try {
            let providerId;
            if (provider === 'smtp') {
                providerId = await this.sendViaSMTP(config, toList, opts, fromEmail, fromName);
            }
            else if (provider === 'microsoft365') {
                providerId = await this.sendViaMicrosoftGraph(config, toList, opts);
            }
            else {
                providerId = await this.sendViaSendGrid(config, toList, opts);
            }
            // ── 4. Mark delivered ────────────────────────
            await this.db.withSuperAdmin(async (client) => {
                await client.query(`UPDATE emails
           SET status = 'delivered', provider_id = $1, sent_at = NOW(), updated_at = NOW()
           WHERE id = $2`, [providerId ?? null, emailId]);
            });
            // ── 5. Log as activity (contact / deal timeline) ──
            if (opts.contactId || opts.dealId) {
                await this.db.withSuperAdmin(async (client) => {
                    await client.query(`INSERT INTO activities
               (tenant_id, type, subject, body, status, contact_id, deal_id, owner_id, completed_at, metadata)
             VALUES ($1,'email',$2,$3,'completed',$4,$5,
                    COALESCE($6,(SELECT id FROM users WHERE tenant_id=$1 AND role='tenant_admin' LIMIT 1)),
                    NOW(), $7)`, [
                        tenantId,
                        opts.subject,
                        opts.bodyText ?? (opts.bodyHtml ?? '').replace(/<[^>]*>/g, '').slice(0, 500),
                        opts.contactId ?? null,
                        opts.dealId ?? null,
                        opts.sentBy ?? null,
                        JSON.stringify({ emailId, to: toEmail, provider }),
                    ]);
                });
            }
            logger_1.logger.info('Email sent', { emailId, provider, to: toEmail });
            return { emailId, providerId, status: 'delivered' };
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            logger_1.logger.error('Email dispatch failed', { emailId, error: msg });
            await this.markFailed(emailId, msg);
            return { emailId, status: 'failed', error: msg };
        }
    }
    // ── SMTP via nodemailer ───────────────────────────────────────────────
    async sendViaSMTP(cfg, toList, opts, fromEmail, fromName) {
        // Dynamic import — nodemailer is optional dependency
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
            host: cfg.host,
            port: parseInt(cfg.port, 10),
            secure: parseInt(cfg.port, 10) === 465,
            auth: { user: cfg.user, pass: cfg.password },
        });
        const info = await transporter.sendMail({
            from: fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
            to: toList.join(', '),
            cc: (opts.cc ?? []).join(', ') || undefined,
            bcc: (opts.bcc ?? []).join(', ') || undefined,
            replyTo: opts.replyTo,
            subject: opts.subject,
            html: opts.bodyHtml,
            text: opts.bodyText,
        });
        return info.messageId;
    }
    // ── Microsoft Graph API (OAuth 2.0 client credentials) ───────────────
    async getMicrosoftGraphToken(cfg) {
        const res = await fetch(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: cfg.clientId,
                client_secret: cfg.clientSecret,
                scope: 'https://graph.microsoft.com/.default',
            }),
        });
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Microsoft OAuth token error ${res.status}: ${txt}`);
        }
        const data = await res.json();
        return data.access_token;
    }
    async sendViaMicrosoftGraph(cfg, toList, opts) {
        const token = await this.getMicrosoftGraphToken(cfg);
        const toRecipients = toList.map((e, i) => ({
            emailAddress: { address: e, name: i === 0 && opts.toName ? opts.toName : undefined },
        }));
        const message = {
            subject: opts.subject,
            from: { emailAddress: { address: cfg.fromEmail, name: cfg.fromName ?? undefined } },
            toRecipients,
            body: {
                contentType: opts.bodyHtml ? 'HTML' : 'Text',
                content: opts.bodyHtml ?? opts.bodyText ?? '',
            },
        };
        if (opts.cc?.length) {
            message.ccRecipients = opts.cc.map((e) => ({ emailAddress: { address: e } }));
        }
        if (opts.bcc?.length) {
            message.bccRecipients = opts.bcc.map((e) => ({ emailAddress: { address: e } }));
        }
        if (opts.replyTo) {
            message.replyTo = [{ emailAddress: { address: opts.replyTo } }];
        }
        const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.fromEmail)}/sendMail`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ message, saveToSentItems: true }),
        });
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Microsoft Graph sendMail ${res.status}: ${txt}`);
        }
        // Graph returns 202 with no body; use a synthetic ID
        return `graph-${Date.now()}`;
    }
    // ── SendGrid v3 REST API ──────────────────────────────────────────────
    async sendViaSendGrid(cfg, toList, opts) {
        const personalizations = [{
                to: toList.map((e, i) => ({
                    email: e,
                    ...(i === 0 && opts.toName ? { name: opts.toName } : {}),
                })),
                ...(opts.cc?.length ? { cc: opts.cc.map(e => ({ email: e })) } : {}),
                ...(opts.bcc?.length ? { bcc: opts.bcc.map(e => ({ email: e })) } : {}),
            }];
        const body = {
            personalizations,
            from: { email: cfg.fromEmail, name: cfg.fromName ?? undefined },
            subject: opts.subject,
            content: opts.bodyHtml
                ? [
                    ...(opts.bodyText ? [{ type: 'text/plain', value: opts.bodyText }] : []),
                    { type: 'text/html', value: opts.bodyHtml },
                ]
                : [{ type: 'text/plain', value: opts.bodyText ?? '' }],
        };
        if (opts.replyTo)
            body.reply_to = { email: opts.replyTo };
        const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${cfg.apiKey}`,
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`SendGrid ${res.status}: ${text}`);
        }
        // SendGrid returns 202; message-id is in X-Message-Id header
        return res.headers.get('X-Message-Id') ?? undefined;
    }
    // ── Helpers ───────────────────────────────────────────────────────────
    async markFailed(emailId, error) {
        await this.db.withSuperAdmin(async (client) => {
            await client.query(`UPDATE emails SET status = 'failed', error = $1, updated_at = NOW() WHERE id = $2`, [error.slice(0, 1000), emailId]);
        });
    }
    async testConnection(tenantId) {
        const { provider, config } = await this.getConnectorConfig(tenantId);
        if (!provider)
            return { ok: false, message: 'No email connector configured' };
        try {
            if (provider === 'smtp') {
                const nodemailer = require('nodemailer');
                const cfg = config;
                const t = nodemailer.createTransport({
                    host: cfg.host,
                    port: parseInt(cfg.port, 10),
                    secure: parseInt(cfg.port, 10) === 465,
                    auth: { user: cfg.user, pass: cfg.password },
                });
                await t.verify();
                return { ok: true, message: 'SMTP connection verified' };
            }
            if (provider === 'sendgrid') {
                const cfg = config;
                const r = await fetch('https://api.sendgrid.com/v3/scopes', {
                    headers: { Authorization: `Bearer ${cfg.apiKey}` },
                });
                if (!r.ok)
                    return { ok: false, message: `SendGrid API error: ${r.status}` };
                return { ok: true, message: 'SendGrid API key valid' };
            }
            if (provider === 'microsoft365') {
                const cfg = config;
                // Verify token acquisition and mailbox access
                const token = await this.getMicrosoftGraphToken(cfg);
                const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.fromEmail)}/mailboxSettings`, { headers: { Authorization: `Bearer ${token}` } });
                if (!r.ok) {
                    const txt = await r.text();
                    return { ok: false, message: `Mailbox access error ${r.status}: ${txt}` };
                }
                return { ok: true, message: `Microsoft 365 connected — mailbox ${cfg.fromEmail} accessible` };
            }
            return { ok: false, message: 'Unknown provider' };
        }
        catch (err) {
            return { ok: false, message: err.message };
        }
    }
}
exports.EmailService = EmailService;
//# sourceMappingURL=email.service.js.map