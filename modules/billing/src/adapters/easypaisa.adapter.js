"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EasypaisaAdapter = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
// Easypaisa — Telenor Pakistan's mobile wallet.
// Covers non-Jazz subscribers. Together with JazzCash they cover ~80% of
// Pakistan mobile wallet users.
// Integration: REST API with HMAC-SHA256 signed requests.
// Docs: https://easypaisa.com.pk/merchant-portal/
class EasypaisaAdapter {
    name = 'easypaisa';
    supportedCurrencies = ['PKR'];
    supportsRecurring = false;
    supportsRefunds = false;
    storeId;
    hashKey;
    username;
    password;
    baseUrl;
    constructor(config) {
        this.storeId = config.storeId;
        this.hashKey = config.hashKey;
        this.username = config.username;
        this.password = config.password;
        this.baseUrl = config.sandbox === 'true'
            ? 'https://easypaisasandbox.com/ma/PaymentExecution'
            : 'https://easypaisa.com.pk/ma/PaymentExecution';
    }
    async initiatePayment(input) {
        if (input.currency !== 'PKR')
            throw new Error('Easypaisa only supports PKR');
        const orderId = input.orderId.replace(/-/g, '').slice(0, 15);
        const amount = (input.amount / 100).toFixed(2); // PKR decimal
        const expiryDate = new Date(Date.now() + 3600_000);
        const expiryStr = formatEPDate(expiryDate);
        const txnDateTime = formatEPDate(new Date());
        // HMAC payload: amount|email|expiryDate|orderRefNum|paymentMethod|postBackURL|storeId|timestamp
        const hashPayload = [
            amount,
            input.customerEmail,
            expiryStr,
            orderId,
            'MA', // Mobile Account
            input.redirectUrl,
            this.storeId,
            txnDateTime,
        ].join('&');
        const requestHash = node_crypto_1.default
            .createHmac('sha256', this.hashKey)
            .update(hashPayload)
            .digest('base64');
        const body = {
            storeId: this.storeId,
            amount,
            postBackURL: input.redirectUrl,
            orderRefNum: orderId,
            expiryDate: expiryStr,
            autoRedirect: 1,
            username: this.username,
            password: Buffer.from(this.password).toString('base64'),
            emailAddr: input.customerEmail,
            mobileNum: input.customerPhone?.replace(/^\+92/, '0').replace(/\D/g, '') ?? '',
            paymentMethod: 'MA',
            tokenExpiry: expiryStr,
            requestHash,
        };
        const res = await fetch(`${this.baseUrl}/initiate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.responseCode !== '0000') {
            throw new Error(`Easypaisa error ${data.responseCode}: ${data.responseDesc}`);
        }
        return {
            paymentId: orderId,
            status: 'pending',
            redirectUrl: data.redirectUrl ?? `${this.baseUrl}?${new URLSearchParams(body)}`,
            expiresAt: expiryDate,
        };
    }
    verifyWebhook(payload, headers, secret) {
        const p = payload;
        if (!p.requestHash)
            return false;
        const verifyPayload = [
            p.amount,
            p.orderRefNum,
            p.paymentMethod,
            p.responseCode,
            p.storeId,
        ].join('&');
        const expected = node_crypto_1.default
            .createHmac('sha256', this.hashKey)
            .update(verifyPayload)
            .digest('base64');
        return node_crypto_1.default.timingSafeEqual(Buffer.from(p.requestHash), Buffer.from(expected));
    }
    normalizeWebhookEvent(payload) {
        const p = payload;
        const succeeded = p.responseCode === '0000';
        return {
            providerPaymentId: p.transactionId ?? p.orderRefNum,
            orderId: p.orderRefNum,
            status: succeeded ? 'succeeded' : 'failed',
            amount: Math.round(parseFloat(p.amount ?? '0') * 100),
            currency: 'PKR',
            metadata: {
                responseCode: p.responseCode,
                responseDesc: p.responseDesc,
                mobileAccountNo: p.mobileAccountNo,
                transactionDateTime: p.transactionDateTime,
            },
        };
    }
}
exports.EasypaisaAdapter = EasypaisaAdapter;
function formatEPDate(d) {
    // Easypaisa format: yyyyMMdd HHmmss
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
//# sourceMappingURL=easypaisa.adapter.js.map