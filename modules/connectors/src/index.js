"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectorsModule = void 0;
const core_1 = require("@crm/core");
class ConnectorsModule {
    name = 'connectors';
    version = '1.0.0';
    description = 'Third-party integrations: Slack, email, Zapier, generic webhooks';
    requiredPlan = 'starter';
    eventBus;
    async onLoad(ctx) {
        this.eventBus = ctx.eventBus;
        this.registerEventForwarding();
    }
    registerEventForwarding() {
        // Forward key CRM events to Zapier / Make.com style catch-all webhooks
        // Each tenant can configure which events trigger outbound webhooks
        // (handled by the webhooks route — this module handles the dispatch logic)
        // Slack notification on deal won
        this.eventBus.on(core_1.CRM_EVENTS.DEAL_WON, async (event) => {
            await this.notifySlack(event.tenantId, {
                text: `🎉 Deal won: *${event.payload.deal?.name}* — $${event.payload.deal?.amount ?? 0}`,
            });
        });
        // Slack notification on voice transfer request
        this.eventBus.on(core_1.CRM_EVENTS.VOICE_TRANSFER_REQUESTED, async (event) => {
            await this.notifySlack(event.tenantId, {
                text: `📞 Voice bot requesting transfer for call ${event.payload.callId} to agent ${event.payload.agentId}`,
            });
        });
    }
    async notifySlack(tenantId, message) {
        // Slack webhook URL is stored in tenant settings.voiceConfig or a connector config table
        // This is a no-op if not configured
    }
}
exports.ConnectorsModule = ConnectorsModule;
//# sourceMappingURL=index.js.map