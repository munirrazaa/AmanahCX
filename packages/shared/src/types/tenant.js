"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAN_FEATURES = exports.PLAN_LIMITS = void 0;
exports.PLAN_LIMITS = {
    free: {
        seats: 2,
        contacts: 500,
        storage: 100,
        apiCallsPerMonth: 1_000,
        voiceMinutesPerMonth: 0,
        pipelines: 1,
        customFields: 5,
    },
    starter: {
        seats: 5,
        contacts: 5_000,
        storage: 1_000,
        apiCallsPerMonth: 10_000,
        voiceMinutesPerMonth: 100,
        pipelines: 3,
        customFields: 20,
    },
    professional: {
        seats: 25,
        contacts: 50_000,
        storage: 10_000,
        apiCallsPerMonth: 100_000,
        voiceMinutesPerMonth: 1_000,
        pipelines: 10,
        customFields: 100,
    },
    enterprise: {
        seats: -1, // unlimited
        contacts: -1,
        storage: -1,
        apiCallsPerMonth: -1,
        voiceMinutesPerMonth: -1,
        pipelines: -1,
        customFields: -1,
    },
};
exports.PLAN_FEATURES = {
    free: {
        voiceBot: false,
        emailIntegration: true,
        analytics: false,
        customFields: true,
        apiAccess: false,
        webhooks: false,
        sso: false,
        auditLog: false,
        multiPipeline: false,
    },
    starter: {
        voiceBot: true,
        emailIntegration: true,
        analytics: true,
        customFields: true,
        apiAccess: true,
        webhooks: true,
        sso: false,
        auditLog: false,
        multiPipeline: true,
    },
    professional: {
        voiceBot: true,
        emailIntegration: true,
        analytics: true,
        customFields: true,
        apiAccess: true,
        webhooks: true,
        sso: true,
        auditLog: true,
        multiPipeline: true,
    },
    enterprise: {
        voiceBot: true,
        emailIntegration: true,
        analytics: true,
        customFields: true,
        apiAccess: true,
        webhooks: true,
        sso: true,
        auditLog: true,
        multiPipeline: true,
    },
};
//# sourceMappingURL=tenant.js.map