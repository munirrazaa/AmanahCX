export type Plan = 'free' | 'starter' | 'professional' | 'enterprise';
export interface Tenant {
    id: string;
    name: string;
    slug: string;
    customDomain?: string;
    plan: Plan;
    status: 'active' | 'suspended' | 'trial' | 'cancelled';
    trialEndsAt?: Date;
    settings: TenantSettings;
    /**
     * Active platform module IDs for this tenant.
     * Stored as a text[] column in DB. Defaults to ['crm'].
     * Maps to active_modules in the database.
     */
    activeModules?: string[];
    createdAt: Date;
    updatedAt: Date;
}
export interface TenantSettings {
    timezone: string;
    locale: string;
    currency: string;
    logo?: string;
    primaryColor?: string;
    features: FeatureFlags;
    limits: PlanLimits;
    voiceProvider?: 'twilio' | 'vonage' | 'plivo' | 'custom';
    voiceConfig?: Record<string, string>;
    /**
     * List of active platform module IDs for this tenant.
     * Defaults to ['crm'] — the core CRM module is always included.
     * Add 'voice', 'ticketing', etc. to enable additional modules.
     */
    activeModules?: string[];
}
export interface FeatureFlags {
    voiceBot: boolean;
    emailIntegration: boolean;
    analytics: boolean;
    customFields: boolean;
    apiAccess: boolean;
    webhooks: boolean;
    sso: boolean;
    auditLog: boolean;
    multiPipeline: boolean;
}
export interface PlanLimits {
    seats: number;
    contacts: number;
    storage: number;
    apiCallsPerMonth: number;
    voiceMinutesPerMonth: number;
    pipelines: number;
    customFields: number;
}
export declare const PLAN_LIMITS: Record<Plan, PlanLimits>;
export declare const PLAN_FEATURES: Record<Plan, FeatureFlags>;
//# sourceMappingURL=tenant.d.ts.map