"use strict";
/**
 * SmsService
 *
 * Dispatches SMS through the tenant's configured gateway.
 * Supported providers:
 *   - Twilio          (international + Pakistan)
 *   - Jazz SMS        (Mobilink/Jazz Pakistan HTTP gateway)
 *   - Telenor SMS     (Pakistan HTTP gateway)
 *   - Zong SMS        (Pakistan HTTP gateway)
 *   - Ufone SMS       (Pakistan HTTP gateway)
 *   - HTTP Gateway    (generic — covers any provider using standard HTTP API)
 *
 * Most Pakistani gateways share the same HTTP API shape:
 *   POST/GET {apiUrl}?username=X&password=X&to=X&message=X&sender=X
 * The "http_sms" connector is a generic adapter for all of them.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmsService = void 0;
const logger_1 = require("./config/logger");
// ── SmsService ────────────────────────────────────────────────────────────
class SmsService {
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
        // Priority: twilio_sms → jazz_sms → telenor_sms → zong_sms → ufone_sms → http_sms
        const smsProviders = ['twilio_sms', 'jazz_sms', 'telenor_sms', 'zong_sms', 'ufone_sms', 'http_sms'];
        for (const key of smsProviders) {
            const cfg = connectors[key];
            if (!cfg)
                continue;
            if (key === 'twilio_sms') {
                if (cfg.accountSid && cfg.authToken && cfg.fromNumber) {
                    return { provider: 'twilio', config: { accountSid: cfg.accountSid, authToken: cfg.authToken, fromNumber: cfg.fromNumber } };
                }
            }
            else {
                // All Pakistani gateways + generic HTTP_SMS use the same shape
                if (cfg.apiUrl && (cfg.username || cfg.apiKey) && cfg.senderId) {
                    return {
                        provider: 'http_sms',
                        config: {
                            apiUrl: cfg.apiUrl,
                            username: cfg.username ?? cfg.apiKey ?? '',
                            password: cfg.password ?? cfg.apiSecret ?? '',
                            senderId: cfg.senderId,
                            method: cfg.method ?? 'POST',
                            toField: cfg.toField ?? 'to',
                            messageField: cfg.messageField ?? 'message',
                            senderField: cfg.senderField ?? 'sender',
                            userField: cfg.userField ?? 'username',
                            passField: cfg.passField ?? 'password',
                        },
                    };
                }
            }
        }
        return { provider: null, config: null };
    }
    // ── Notify tenant admin when no SMS connector is configured ────────────
    // Throttled to once per 4 hours per tenant so admins aren't spammed.
    async notifyAdminNoConnector(tenantId, attemptedTo) {
        try {
            const admins = await this.db.withSuperAdmin(async (client) => {
                const r = await client.query(`SELECT id FROM users
           WHERE tenant_id = $1
             AND role IN ('tenant_admin','super_admin')
             AND is_active = true
           LIMIT 5`, [tenantId]);
                return r.rows;
            });
            if (!admins.length)
                return;
            // Throttle: skip if we already sent this alert within 4 hours
            const [recent] = await this.db.withSuperAdmin(async (client) => {
                const r = await client.query(`SELECT id FROM notifications
           WHERE tenant_id = $1
             AND type = 'sms_gateway_missing'
             AND created_at > NOW() - INTERVAL '4 hours'
           LIMIT 1`, [tenantId]);
                return r.rows;
            });
            if (recent)
                return;
            const title = '⚠️ SMS Gateway Not Configured';
            const message = `A message to ${attemptedTo} could not be sent — no SMS connector is configured for your workspace. Please configure one under Settings → Integrations (Twilio, Jazz SMS, Telenor, Zong, Ufone, or HTTP Gateway).`;
            await this.db.withSuperAdmin(async (client) => {
                for (const admin of admins) {
                    await client.query(`INSERT INTO notifications (tenant_id, user_id, type, title, body, is_read, created_at)
             VALUES ($1, $2, 'sms_gateway_missing', $3, $4, false, NOW())`, [tenantId, admin.id, title, message]);
                }
            });
            logger_1.logger.warn('SmsService: admin notified — SMS gateway missing', { tenantId });
        }
        catch (err) {
            logger_1.logger.error('SmsService: could not send admin alert', { error: err.message });
        }
    }
    // ── Send SMS ─────────────────────────────────────────────────────────
    async send(tenantId, opts) {
        const { provider, config } = await this.getConnectorConfig(tenantId);
        if (!provider) {
            logger_1.logger.warn('SmsService: no SMS connector configured', { tenantId, to: opts.to });
            // Fire-and-forget admin alert (throttled — won't spam)
            this.notifyAdminNoConnector(tenantId, opts.to).catch(() => { });
            return { success: false, error: 'No SMS gateway configured' };
        }
        try {
            if (provider === 'twilio') {
                return await this.sendViaTwilio(config, opts);
            }
            else {
                return await this.sendViaHttp(config, opts);
            }
        }
        catch (err) {
            logger_1.logger.error('SmsService send error', { tenantId, error: err.message });
            return { success: false, error: err.message };
        }
    }
    // ── Twilio SMS ────────────────────────────────────────────────────────
    async sendViaTwilio(config, opts) {
        const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
        const body = new URLSearchParams({
            To: opts.to,
            From: config.fromNumber,
            Body: opts.body,
        });
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body.toString(),
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.message ?? `Twilio error ${res.status}`);
        }
        return { success: true, providerId: data.sid };
    }
    // ── Generic HTTP SMS Gateway (Jazz, Telenor, Zong, Ufone, custom) ────
    async sendViaHttp(config, opts) {
        const params = {
            [config.userField ?? 'username']: config.username,
            [config.passField ?? 'password']: config.password,
            [config.toField ?? 'to']: opts.to,
            [config.messageField ?? 'message']: opts.body,
            [config.senderField ?? 'sender']: config.senderId,
        };
        let res;
        if ((config.method ?? 'POST').toUpperCase() === 'GET') {
            const qs = new URLSearchParams(params).toString();
            res = await fetch(`${config.apiUrl}?${qs}`);
        }
        else {
            res = await fetch(config.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams(params).toString(),
            });
        }
        const text = await res.text();
        if (!res.ok) {
            throw new Error(`HTTP SMS gateway error ${res.status}: ${text.slice(0, 200)}`);
        }
        // Most Pakistani gateways return a message ID or "OK" in the body
        logger_1.logger.info('SmsService: sent via HTTP gateway', { url: config.apiUrl, response: text.slice(0, 100) });
        return { success: true, providerId: text.trim().slice(0, 64) };
    }
    // ── Test connection ───────────────────────────────────────────────────
    // Sends a test message to a provided number to verify credentials.
    async testConnection(tenantId, testPhone) {
        const result = await this.send(tenantId, {
            to: testPhone,
            body: 'Vivid CRM: SMS gateway connection test successful. ✓',
        });
        return { ok: result.success, error: result.error };
    }
}
exports.SmsService = SmsService;
//# sourceMappingURL=sms.service.js.map