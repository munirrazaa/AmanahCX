"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StripeAdapter = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
// Stripe — global card payments. Best for international customers paying in USD/EUR/GBP.
// Also handles recurring subscriptions natively.
class StripeAdapter {
    name = 'stripe';
    supportedCurrencies = ['USD', 'GBP', 'EUR', 'AED', 'SAR'];
    supportsRecurring = true;
    supportsRefunds = true;
    secretKey;
    webhookSecret;
    baseUrl = 'https://api.stripe.com/v1';
    constructor(config) {
        this.secretKey = config.secretKey;
        this.webhookSecret = config.webhookSecret;
    }
    async initiatePayment(input) {
        const session = await this.fetch('/checkout/sessions', 'POST', {
            mode: 'payment',
            payment_method_types: ['card'],
            line_items: [{
                    price_data: {
                        currency: input.currency.toLowerCase(),
                        unit_amount: input.amount,
                        product_data: { name: input.description },
                    },
                    quantity: 1,
                }],
            customer_email: input.customerEmail,
            client_reference_id: input.orderId,
            success_url: `${input.redirectUrl}?status=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${input.redirectUrl}?status=cancelled`,
            metadata: input.metadata ?? {},
        });
        return {
            paymentId: session.payment_intent,
            status: 'pending',
            redirectUrl: session.url,
            checkoutToken: session.id,
        };
    }
    async createSubscription(input) {
        // Create or retrieve customer
        const customers = await this.fetch(`/customers?email=${encodeURIComponent(input.customerEmail)}&limit=1`, 'GET');
        let customerId;
        if (customers.data.length > 0) {
            customerId = customers.data[0].id;
        }
        else {
            const customer = await this.fetch('/customers', 'POST', {
                email: input.customerEmail,
                name: input.customerName,
                metadata: { tenantId: input.metadata?.tenantId },
            });
            customerId = customer.id;
        }
        const priceId = process.env[`STRIPE_PRICE_${input.planId.toUpperCase()}_${input.billingCycle.toUpperCase()}`];
        if (!priceId)
            throw new Error(`No Stripe price ID configured for plan ${input.planId} ${input.billingCycle}`);
        const subscription = await this.fetch('/subscriptions', 'POST', {
            customer: customerId,
            items: [{ price: priceId }],
            trial_period_days: input.trialDays,
            payment_behavior: 'default_incomplete',
            expand: ['latest_invoice.payment_intent'],
            metadata: input.metadata ?? {},
        });
        return {
            providerSubscriptionId: subscription.id,
            status: subscription.status,
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        };
    }
    async cancelSubscription(providerSubscriptionId) {
        await this.fetch(`/subscriptions/${providerSubscriptionId}`, 'DELETE', {
            cancel_at_period_end: true,
        });
    }
    async refund(providerPaymentId, amount) {
        await this.fetch('/refunds', 'POST', {
            payment_intent: providerPaymentId,
            ...(amount ? { amount } : {}),
        });
    }
    verifyWebhook(payload, headers, secret) {
        const sig = headers['stripe-signature'];
        if (!sig)
            return false;
        try {
            const parts = sig.split(',');
            const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2);
            const receivedSig = parts.find((p) => p.startsWith('v1='))?.slice(3);
            if (!timestamp || !receivedSig)
                return false;
            const expected = node_crypto_1.default
                .createHmac('sha256', this.webhookSecret)
                .update(`${timestamp}.${JSON.stringify(payload)}`)
                .digest('hex');
            return node_crypto_1.default.timingSafeEqual(Buffer.from(receivedSig), Buffer.from(expected));
        }
        catch {
            return false;
        }
    }
    normalizeWebhookEvent(payload) {
        const p = payload;
        const type = p.type ?? '';
        const obj = p.data?.object ?? {};
        const statusMap = {
            'payment_intent.succeeded': 'succeeded',
            'payment_intent.payment_failed': 'failed',
            'payment_intent.processing': 'processing',
            'charge.refunded': 'refunded',
            'invoice.paid': 'succeeded',
            'invoice.payment_failed': 'failed',
        };
        return {
            providerPaymentId: obj.id ?? obj.payment_intent,
            orderId: obj.client_reference_id ?? obj.metadata?.orderId ?? '',
            status: statusMap[type] ?? 'pending',
            amount: obj.amount_received ?? obj.amount_paid ?? obj.amount ?? 0,
            currency: (obj.currency?.toUpperCase() ?? 'USD'),
            fee: obj.balance_transaction?.fee,
            net: obj.balance_transaction?.net,
        };
    }
    async fetch(path, method, body) {
        const init = {
            method,
            headers: {
                Authorization: `Bearer ${this.secretKey}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        };
        if (body && method !== 'GET') {
            init.body = flattenToFormData(body);
        }
        const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
        const res = await fetch(url, init);
        const data = await res.json();
        if (!res.ok)
            throw new Error(`Stripe error ${res.status}: ${data.error?.message}`);
        return data;
    }
}
exports.StripeAdapter = StripeAdapter;
function flattenToFormData(obj, prefix = '') {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}[${k}]` : k;
        if (v !== null && v !== undefined) {
            if (typeof v === 'object' && !Array.isArray(v)) {
                const nested = flattenToFormData(v, key);
                for (const [nk, nv] of new URLSearchParams(nested)) {
                    params.set(nk, nv);
                }
            }
            else {
                params.set(key, String(v));
            }
        }
    }
    return params.toString();
}
//# sourceMappingURL=stripe.adapter.js.map