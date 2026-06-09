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

import type { DatabaseClient } from './database';
import { logger } from './config/logger';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SendSmsOpts {
  to: string;          // recipient phone (E.164 preferred: +923001234567)
  body: string;        // message text (max 160 chars per SMS segment)
  ticketId?: string;
}

export interface SendSmsResult {
  success: boolean;
  providerId?: string;
  error?: string;
}

interface TwilioSmsConfig {
  accountSid: string;
  authToken:  string;
  fromNumber: string;
}

interface HttpSmsConfig {
  apiUrl:     string;   // e.g. https://api.jazzsms.com/v1/send
  username:   string;
  password:   string;
  senderId:   string;   // Sender ID / mask shown to recipient
  method:     string;   // GET or POST
  // Field name overrides (providers differ on param names)
  toField?:      string;  // default: "to"
  messageField?: string;  // default: "message"
  senderField?:  string;  // default: "sender"
  userField?:    string;  // default: "username"
  passField?:    string;  // default: "password"
}

type SmsConnectorConfig =
  | { provider: 'twilio';   config: TwilioSmsConfig }
  | { provider: 'http_sms'; config: HttpSmsConfig }
  | { provider: null;        config: null };

// ── SmsService ────────────────────────────────────────────────────────────

export class SmsService {
  constructor(private readonly db: DatabaseClient) {}

  // ── Resolve provider from tenant connector settings ──────────────────

  async getConnectorConfig(tenantId: string): Promise<SmsConnectorConfig> {
    const [tenant] = await this.db.withSuperAdmin(async (client) => {
      const r = await client.query('SELECT settings FROM tenants WHERE id = $1', [tenantId]);
      return r.rows;
    });

    const connectors = tenant?.settings?.connectors ?? {};

    // Priority: twilio_sms → jazz_sms → telenor_sms → zong_sms → ufone_sms → http_sms
    const smsProviders = ['twilio_sms', 'jazz_sms', 'telenor_sms', 'zong_sms', 'ufone_sms', 'http_sms'];
    for (const key of smsProviders) {
      const cfg = connectors[key];
      if (!cfg) continue;

      if (key === 'twilio_sms') {
        if (cfg.accountSid && cfg.authToken && cfg.fromNumber) {
          return { provider: 'twilio', config: { accountSid: cfg.accountSid, authToken: cfg.authToken, fromNumber: cfg.fromNumber } };
        }
      } else {
        // All Pakistani gateways + generic HTTP_SMS use the same shape
        if (cfg.apiUrl && (cfg.username || cfg.apiKey) && cfg.senderId) {
          return {
            provider: 'http_sms',
            config: {
              apiUrl:      cfg.apiUrl,
              username:    cfg.username ?? cfg.apiKey ?? '',
              password:    cfg.password ?? cfg.apiSecret ?? '',
              senderId:    cfg.senderId,
              method:      cfg.method ?? 'POST',
              toField:     cfg.toField      ?? 'to',
              messageField: cfg.messageField ?? 'message',
              senderField: cfg.senderField  ?? 'sender',
              userField:   cfg.userField    ?? 'username',
              passField:   cfg.passField    ?? 'password',
            },
          };
        }
      }
    }

    return { provider: null, config: null };
  }

  // ── Send SMS ─────────────────────────────────────────────────────────

  async send(tenantId: string, opts: SendSmsOpts): Promise<SendSmsResult> {
    const { provider, config } = await this.getConnectorConfig(tenantId);

    if (!provider) {
      logger.warn('SmsService: no SMS connector configured', { tenantId });
      return { success: false, error: 'No SMS gateway configured' };
    }

    try {
      if (provider === 'twilio') {
        return await this.sendViaTwilio(config as TwilioSmsConfig, opts);
      } else {
        return await this.sendViaHttp(config as HttpSmsConfig, opts);
      }
    } catch (err: any) {
      logger.error('SmsService send error', { tenantId, error: err.message });
      return { success: false, error: err.message };
    }
  }

  // ── Twilio SMS ────────────────────────────────────────────────────────

  private async sendViaTwilio(config: TwilioSmsConfig, opts: SendSmsOpts): Promise<SendSmsResult> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
    const body = new URLSearchParams({
      To:   opts.to,
      From: config.fromNumber,
      Body: opts.body,
    });

    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const data = await res.json() as any;
    if (!res.ok) {
      throw new Error(data.message ?? `Twilio error ${res.status}`);
    }
    return { success: true, providerId: data.sid };
  }

  // ── Generic HTTP SMS Gateway (Jazz, Telenor, Zong, Ufone, custom) ────

  private async sendViaHttp(config: HttpSmsConfig, opts: SendSmsOpts): Promise<SendSmsResult> {
    const params: Record<string, string> = {
      [config.userField    ?? 'username']: config.username,
      [config.passField    ?? 'password']: config.password,
      [config.toField      ?? 'to']:       opts.to,
      [config.messageField ?? 'message']:  opts.body,
      [config.senderField  ?? 'sender']:   config.senderId,
    };

    let res: Response;
    if ((config.method ?? 'POST').toUpperCase() === 'GET') {
      const qs = new URLSearchParams(params).toString();
      res = await fetch(`${config.apiUrl}?${qs}`);
    } else {
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
    logger.info('SmsService: sent via HTTP gateway', { url: config.apiUrl, response: text.slice(0, 100) });
    return { success: true, providerId: text.trim().slice(0, 64) };
  }

  // ── Test connection ───────────────────────────────────────────────────
  // Sends a test message to a provided number to verify credentials.

  async testConnection(tenantId: string, testPhone: string): Promise<{ ok: boolean; error?: string }> {
    const result = await this.send(tenantId, {
      to:   testPhone,
      body: 'Vivid CRM: SMS gateway connection test successful. ✓',
    });
    return { ok: result.success, error: result.error };
  }
}
