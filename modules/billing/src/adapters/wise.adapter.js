"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WiseAdapter = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
// Wise (formerly TransferWise) — best for international B2B payments and
// cross-border USD/GBP → PKR transfers. Used when customers want to pay
// from outside Pakistan or companies doing international SaaS billing.
class WiseAdapter {
    name = 'wise';
    supportedCurrencies = ['USD', 'GBP', 'EUR', 'PKR', 'AED', 'SAR'];
    supportsRecurring = false; // Wise doesn't have native recurring; we handle via cron
    supportsRefunds = true;
    apiKey;
    profileId; // Wise Business profile ID
    webhookSecret;
    baseUrl;
    constructor(config) {
        this.apiKey = config.apiKey;
        this.profileId = config.profileId;
        this.webhookSecret = config.webhookSecret;
        // Use sandbox URL in non-production
        this.baseUrl = config.sandbox === 'true'
            ? 'https://api.sandbox.transferwise.tech'
            : 'https://api.wise.com';
    }
    async initiatePayment(input) {
        // Wise payment link flow:
        // 1. Create a quote for the amount
        // 2. Create a payment link the customer can pay via Wise balance or bank transfer
        const quoteRes = await this.fetch('/v3/quotes', 'POST', {
            sourceCurrency: input.currency,
            targetCurrency: input.currency,
            sourceAmount: input.amount / 100, // Wise uses decimal amounts
            payOut: 'BALANCE',
        });
        const linkRes = await this.fetch('/v2/payment-links', 'POST', {
            profileId: this.profileId,
            amount: {
                value: input.amount / 100,
                currency: input.currency,
            },
            description: input.description,
            reference: input.orderId,
            expiryDate: new Date(Date.now() + 7 * 86_400_000).toISOString().split('T')[0], // 7 days
            notificationUrl: input.webhookUrl,
            returnUrl: input.redirectUrl,
        });
        // Also provide bank transfer details as fallback for customers without Wise accounts
        const bankDetails = this.getBankTransferDetails(input.currency, input.orderId);
        return {
            paymentId: linkRes.id,
            status: 'pending',
            redirectUrl: linkRes.url,
            bankDetails,
            expiresAt: new Date(Date.now() + 7 * 86_400_000),
        };
    }
    // Wise-specific: get our own bank account details so customers can wire money
    getBankTransferDetails(currency, reference) {
        const accounts = {
            USD: {
                bankName: 'Wise (via US ACH)',
                accountTitle: 'Your CRM Platform Inc.',
                accountNumber: process.env.WISE_USD_ACCOUNT_NUMBER ?? '',
                routingNumber: process.env.WISE_USD_ROUTING ?? '',
                reference,
            },
            GBP: {
                bankName: 'Wise (UK)',
                accountTitle: 'Your CRM Platform Ltd.',
                accountNumber: process.env.WISE_GBP_ACCOUNT_NUMBER ?? '',
                iban: process.env.WISE_GBP_IBAN ?? '',
                reference,
            },
            PKR: {
                bankName: 'Wise (via Pakistan)',
                accountTitle: 'Your CRM Platform',
                accountNumber: process.env.WISE_PKR_ACCOUNT_NUMBER ?? '',
                iban: process.env.WISE_PKR_IBAN ?? '',
                reference,
            },
        };
        return (accounts[currency] ?? accounts.USD);
    }
    verifyWebhook(payload, headers, secret) {
        const signature = headers['x-signature-sha256'];
        if (!signature)
            return false;
        const expected = node_crypto_1.default
            .createHmac('sha256', secret)
            .update(JSON.stringify(payload))
            .digest('hex');
        return node_crypto_1.default.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    }
    normalizeWebhookEvent(payload) {
        const p = payload;
        const eventType = p.event_type ?? '';
        // Wise webhook events: balances#credit, transfers#state-change, payment-links#payment
        let status = 'pending';
        if (eventType.includes('payment') && p.data?.status === 'COMPLETED')
            status = 'succeeded';
        if (p.data?.status === 'FAILED' || p.data?.status === 'CANCELLED')
            status = 'failed';
        return {
            providerPaymentId: String(p.data?.id ?? ''),
            orderId: p.data?.reference ?? '',
            status,
            amount: Math.round((p.data?.amount?.value ?? 0) * 100),
            currency: (p.data?.amount?.currency ?? 'USD'),
        };
    }
    async refund(providerPaymentId) {
        // Wise refunds are done manually through the dashboard or via transfer back
        // For now, log the request — in production you'd initiate a transfer back
        throw new Error('Wise refunds must be initiated manually via Wise dashboard or a reverse transfer');
    }
    async fetch(path, method, body) {
        const res = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json();
        if (!res.ok)
            throw new Error(`Wise API error ${res.status}: ${JSON.stringify(data)}`);
        return data;
    }
}
exports.WiseAdapter = WiseAdapter;
//# sourceMappingURL=wise.adapter.js.map