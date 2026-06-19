export type Currency = 'USD' | 'PKR' | 'GBP' | 'EUR' | 'AED' | 'SAR';
export type PaymentProvider = 'stripe' | 'wise' | 'jazzcash' | 'easypaisa' | 'raast' | 'payfast' | 'bank_transfer' | 'paypal';
export type PaymentStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'cancelled' | 'requires_action';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'unpaid';
export type BillingCycle = 'monthly' | 'annual';
export interface PlanPricing {
    plan: string;
    billingCycle: BillingCycle;
    currency: Currency;
    amount: number;
    displayAmount: number;
}
export declare const PLAN_PRICING: PlanPricing[];
export interface Subscription {
    id: string;
    tenantId: string;
    plan: string;
    billingCycle: BillingCycle;
    status: SubscriptionStatus;
    currency: Currency;
    amount: number;
    provider: PaymentProvider;
    providerSubscriptionId?: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    trialEnd?: Date;
    createdAt: Date;
    updatedAt: Date;
}
export interface Invoice {
    id: string;
    tenantId: string;
    subscriptionId: string;
    invoiceNumber: string;
    status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
    currency: Currency;
    subtotal: number;
    tax: number;
    taxRate: number;
    total: number;
    provider: PaymentProvider;
    providerInvoiceId?: string;
    paidAt?: Date;
    dueAt: Date;
    lineItems: InvoiceLineItem[];
    billingDetails: BillingDetails;
    createdAt: Date;
}
export interface InvoiceLineItem {
    description: string;
    quantity: number;
    unitAmount: number;
    total: number;
}
export interface BillingDetails {
    name: string;
    email: string;
    phone?: string;
    address?: {
        line1: string;
        line2?: string;
        city: string;
        state?: string;
        postalCode?: string;
        country: string;
    };
    taxId?: string;
    ntn?: string;
}
export interface Payment {
    id: string;
    tenantId: string;
    invoiceId?: string;
    provider: PaymentProvider;
    providerPaymentId: string;
    status: PaymentStatus;
    currency: Currency;
    amount: number;
    fee?: number;
    net?: number;
    failureReason?: string;
    metadata: Record<string, unknown>;
    createdAt: Date;
}
export interface InitiatePaymentInput {
    amount: number;
    currency: Currency;
    description: string;
    customerEmail: string;
    customerName: string;
    customerPhone?: string;
    orderId: string;
    redirectUrl: string;
    webhookUrl: string;
    metadata?: Record<string, string>;
}
export interface PaymentInitiateResult {
    paymentId: string;
    status: PaymentStatus;
    redirectUrl?: string;
    checkoutToken?: string;
    qrCode?: string;
    bankDetails?: BankTransferDetails;
    expiresAt?: Date;
}
export interface BankTransferDetails {
    bankName: string;
    accountTitle: string;
    accountNumber: string;
    iban?: string;
    swiftCode?: string;
    routingNumber?: string;
    reference: string;
}
//# sourceMappingURL=billing.d.ts.map