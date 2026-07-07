"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingService = void 0;
const shared_1 = require("@crm/shared");
const stripe_adapter_1 = require("./adapters/stripe.adapter");
const wise_adapter_1 = require("./adapters/wise.adapter");
const jazzcash_adapter_1 = require("./adapters/jazzcash.adapter");
const easypaisa_adapter_1 = require("./adapters/easypaisa.adapter");
const raast_adapter_1 = require("./adapters/raast.adapter");
const logger_1 = require("../../../packages/core/src/config/logger");
class BillingService {
    db;
    eventBus;
    adapters = new Map();
    constructor(db, eventBus, config) {
        this.db = db;
        this.eventBus = eventBus;
        this.registerAdapters(config);
    }
    registerAdapters(config) {
        if (config.STRIPE_SECRET_KEY) {
            this.adapters.set('stripe', new stripe_adapter_1.StripeAdapter({
                secretKey: config.STRIPE_SECRET_KEY,
                webhookSecret: config.STRIPE_WEBHOOK_SECRET ?? '',
            }));
        }
        if (config.WISE_API_KEY) {
            this.adapters.set('wise', new wise_adapter_1.WiseAdapter({
                apiKey: config.WISE_API_KEY,
                profileId: config.WISE_PROFILE_ID ?? '',
                webhookSecret: config.WISE_WEBHOOK_SECRET ?? '',
                sandbox: config.WISE_SANDBOX ?? 'false',
            }));
        }
        if (config.JAZZCASH_MERCHANT_ID) {
            this.adapters.set('jazzcash', new jazzcash_adapter_1.JazzCashAdapter({
                merchantId: config.JAZZCASH_MERCHANT_ID,
                password: config.JAZZCASH_PASSWORD ?? '',
                integrityKey: config.JAZZCASH_INTEGRITY_KEY ?? '',
                sandbox: config.JAZZCASH_SANDBOX ?? 'false',
            }));
        }
        if (config.EASYPAISA_STORE_ID) {
            this.adapters.set('easypaisa', new easypaisa_adapter_1.EasypaisaAdapter({
                storeId: config.EASYPAISA_STORE_ID,
                hashKey: config.EASYPAISA_HASH_KEY ?? '',
                username: config.EASYPAISA_USERNAME ?? '',
                password: config.EASYPAISA_PASSWORD ?? '',
                sandbox: config.EASYPAISA_SANDBOX ?? 'false',
            }));
        }
        if (config.RAAST_CLIENT_ID) {
            this.adapters.set('raast', new raast_adapter_1.RaastAdapter({
                clientId: config.RAAST_CLIENT_ID,
                clientSecret: config.RAAST_CLIENT_SECRET ?? '',
                merchantIban: config.RAAST_MERCHANT_IBAN ?? '',
                merchantAlias: config.RAAST_MERCHANT_ALIAS ?? '',
                sandbox: config.RAAST_SANDBOX ?? 'false',
            }));
        }
    }
    getAdapter(provider) {
        const adapter = this.adapters.get(provider);
        if (!adapter)
            throw new Error(`Payment provider '${provider}' is not configured`);
        return adapter;
    }
    getAvailableProviders(currency) {
        return [...this.adapters.values()]
            .filter((a) => a.supportedCurrencies.includes(currency))
            .map((a) => a.name);
    }
    async createCheckoutSession(input) {
        const pricing = shared_1.PLAN_PRICING.find((p) => p.plan === input.plan && p.billingCycle === input.billingCycle && p.currency === input.currency);
        if (!pricing)
            throw new Error(`No pricing found for ${input.plan} / ${input.billingCycle} / ${input.currency}`);
        // Calculate GST if Pakistan customer
        const isPKR = input.currency === 'PKR';
        const taxRate = isPKR ? 0.18 : 0; // Pakistan GST: 18% on SaaS (FBR ruling)
        const subtotal = pricing.amount;
        const tax = Math.round(subtotal * taxRate);
        const total = subtotal + tax;
        const invoiceNumber = await this.nextInvoiceNumber(input.tenantId);
        const [invoice] = await this.db.withTenant(input.tenantId, async (client) => {
            const result = await client.query(`INSERT INTO invoices
           (tenant_id, invoice_number, status, currency, subtotal, tax, tax_rate, total,
            provider, due_at, line_items, billing_details)
         VALUES ($1,$2,'open',$3,$4,$5,$6,$7,$8, NOW() + INTERVAL '7 days', $9::jsonb, $10::jsonb)
         RETURNING *`, [
                input.tenantId, invoiceNumber, input.currency, subtotal, tax, taxRate, total,
                input.provider,
                JSON.stringify([{
                        description: `${input.plan.charAt(0).toUpperCase() + input.plan.slice(1)} Plan — ${input.billingCycle}`,
                        quantity: 1,
                        unitAmount: subtotal,
                        total: subtotal,
                    }]),
                JSON.stringify(input.billingDetails),
            ]);
            return result.rows;
        });
        const adapter = this.getAdapter(input.provider);
        if (!adapter.supportedCurrencies.includes(input.currency)) {
            throw new Error(`${input.provider} does not support ${input.currency}. ` +
                `Use: ${this.getAvailableProviders(input.currency).join(', ')}`);
        }
        const paymentInput = {
            amount: total,
            currency: input.currency,
            description: `CRM Platform — ${input.plan} (${invoiceNumber})`,
            customerEmail: input.billingDetails.email,
            customerName: input.billingDetails.name,
            customerPhone: input.billingDetails.phone,
            orderId: invoice.id,
            redirectUrl: `${input.baseUrl}/billing/result`,
            webhookUrl: `${input.baseUrl}/api/v1/billing/webhook/${input.provider}`,
            metadata: { tenantId: input.tenantId, invoiceId: invoice.id },
        };
        const payment = await adapter.initiatePayment(paymentInput);
        // Record payment attempt
        await this.db.withTenant(input.tenantId, async (client) => {
            await client.query(`INSERT INTO payments (tenant_id, invoice_id, provider, provider_payment_id, status, currency, amount, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [input.tenantId, invoice.id, input.provider, payment.paymentId,
                payment.status, input.currency, total, JSON.stringify(payment)]);
        });
        logger_1.logger.info('Checkout session created', {
            tenantId: input.tenantId, provider: input.provider, invoiceId: invoice.id, amount: total, currency: input.currency,
        });
        return { invoice, payment };
    }
    async handleWebhook(provider, payload, headers) {
        const adapter = this.getAdapter(provider);
        const secret = process.env[`${provider.toUpperCase()}_WEBHOOK_SECRET`] ?? '';
        if (!adapter.verifyWebhook(payload, headers, secret)) {
            throw new Error('Invalid webhook signature');
        }
        const event = adapter.normalizeWebhookEvent(payload);
        logger_1.logger.info('Payment webhook received', { provider, status: event.status, orderId: event.orderId });
        // Find invoice by ID (orderId is our invoice ID)
        const [payment] = await this.db.withSuperAdmin(async (client) => {
            const result = await client.query(`SELECT p.*, i.tenant_id FROM payments p
         JOIN invoices i ON p.invoice_id = i.id
         WHERE p.provider_payment_id = $1 OR i.id = $2
         LIMIT 1`, [event.providerPaymentId, event.orderId]);
            return result.rows;
        });
        if (!payment) {
            logger_1.logger.warn('Webhook for unknown payment', { provider, paymentId: event.providerPaymentId });
            return;
        }
        const tenantId = payment.tenant_id;
        // Update payment record
        await this.db.withTenant(tenantId, async (client) => {
            await client.query(`UPDATE payments SET status = $1, metadata = metadata || $2::jsonb WHERE id = $3`, [event.status, JSON.stringify(event.metadata ?? {}), payment.id]);
        });
        if (event.status === 'succeeded') {
            await this.markInvoicePaid(tenantId, payment.invoice_id, provider);
        }
        else if (event.status === 'failed') {
            await this.handlePaymentFailed(tenantId, payment.invoice_id);
        }
    }
    async markInvoicePaid(tenantId, invoiceId, provider) {
        const [invoice] = await this.db.withTenant(tenantId, async (client) => {
            const result = await client.query(`UPDATE invoices SET status = 'paid', paid_at = NOW() WHERE id = $1 RETURNING *`, [invoiceId]);
            return result.rows;
        });
        // Activate/extend the subscription
        const lineItem = invoice.lineItems[0].description;
        const plan = lineItem.toLowerCase().includes('professional') ? 'professional' : 'starter';
        await this.db.withSuperAdmin(async (client) => {
            await client.query(`UPDATE tenants SET plan = $1, status = 'active', updated_at = NOW() WHERE id = $2`, [plan, tenantId]);
        });
        await this.eventBus.publish(tenantId, 'billing.payment_succeeded', { invoiceId, plan, provider });
        logger_1.logger.info('Invoice paid, tenant activated', { tenantId, invoiceId, plan });
    }
    async handlePaymentFailed(tenantId, invoiceId) {
        await this.db.withTenant(tenantId, async (client) => {
            await client.query(`UPDATE invoices SET status = 'open' WHERE id = $1`, [invoiceId]);
        });
        await this.eventBus.publish(tenantId, 'billing.payment_failed', { invoiceId });
    }
    async nextInvoiceNumber(tenantId) {
        const year = new Date().getFullYear();
        const [row] = await this.db.withTenant(tenantId, async (client) => {
            const result = await client.query(`SELECT COUNT(*) as count FROM invoices WHERE EXTRACT(YEAR FROM created_at) = $1`, [year]);
            return result.rows;
        });
        const seq = String(parseInt(row.count) + 1).padStart(4, '0');
        return `INV-${year}-${seq}`;
    }
}
exports.BillingService = BillingService;
//# sourceMappingURL=billing.service.js.map