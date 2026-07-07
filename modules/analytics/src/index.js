"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsModule = void 0;
const core_1 = require("@crm/core");
class AnalyticsModule {
    name = 'analytics';
    version = '1.0.0';
    description = 'Revenue analytics, pipeline funnel, and leaderboards';
    requiredPlan = 'starter';
    async onLoad(ctx) {
        const eventBus = ctx.eventBus;
        const redis = ctx.redis;
        // Invalidate dashboard cache on any meaningful event
        const invalidate = (tenantId) => redis.del(`analytics:dashboard:${tenantId}`).catch(() => { });
        eventBus.on(core_1.CRM_EVENTS.DEAL_WON, (e) => invalidate(e.tenantId));
        eventBus.on(core_1.CRM_EVENTS.DEAL_LOST, (e) => invalidate(e.tenantId));
        eventBus.on(core_1.CRM_EVENTS.DEAL_CREATED, (e) => invalidate(e.tenantId));
        eventBus.on(core_1.CRM_EVENTS.CONTACT_CREATED, (e) => invalidate(e.tenantId));
        eventBus.on(core_1.CRM_EVENTS.VOICE_CALL_COMPLETED, (e) => invalidate(e.tenantId));
    }
    async onUnload() { }
}
exports.AnalyticsModule = AnalyticsModule;
//# sourceMappingURL=index.js.map