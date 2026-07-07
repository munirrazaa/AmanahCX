"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceModule = void 0;
const core_1 = require("@crm/core");
class VoiceModule {
    name = 'voice';
    version = '1.0.0';
    description = 'Voice bot integration — provider-agnostic call management';
    requiredPlan = 'starter';
    dependencies = ['contacts', 'activities'];
    async onLoad(ctx) {
        const eventBus = ctx.eventBus;
        const db = ctx.db;
        const redis = ctx.redis;
        // Cache live call state in Redis for real-time WebSocket streaming
        eventBus.on(core_1.CRM_EVENTS.VOICE_CALL_STARTED, async (event) => {
            const callData = event.payload;
            await redis.setex(`live_call:${event.tenantId}:${callData.externalCallId}`, 3600, JSON.stringify(callData));
        });
        // Remove from live cache when call ends
        eventBus.on(core_1.CRM_EVENTS.VOICE_CALL_COMPLETED, async (event) => {
            const call = event.payload.call;
            if (call?.external_call_id) {
                await redis.del(`live_call:${event.tenantId}:${call.external_call_id}`);
            }
        });
        // When transcription arrives, push to WebSocket subscribers
        eventBus.on(core_1.CRM_EVENTS.VOICE_CALL_TRANSCRIBED, async (event) => {
            const { callId, transcript } = event.payload;
            // Push to stream channel — picked up by WebSocket handler in voice route
            await redis.native.publish(`voice:stream:${event.tenantId}:${callId}`, JSON.stringify({ type: 'transcript', data: transcript }));
        });
    }
    async onUnload() { }
}
exports.VoiceModule = VoiceModule;
//# sourceMappingURL=index.js.map