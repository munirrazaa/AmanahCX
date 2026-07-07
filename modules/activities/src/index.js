"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActivitiesModule = void 0;
const core_1 = require("@crm/core");
const bullmq_1 = require("bullmq");
class ActivitiesModule {
    name = 'activities';
    version = '1.0.0';
    description = 'Tasks, calls, emails and timeline activities';
    requiredPlan = 'free';
    dependencies = ['contacts'];
    reminderQueue;
    async onLoad(ctx) {
        const eventBus = ctx.eventBus;
        const db = ctx.db;
        const redis = ctx.redis;
        const hasRealRedis = !!(redis?.native && typeof redis.native.defineCommand === 'function');
        // BullMQ queue for delayed task reminders (only when a real Redis is present;
        // otherwise BullMQ would endlessly try to reach localhost:6379)
        if (hasRealRedis) {
            this.reminderQueue = new bullmq_1.Queue('activity-reminders', {
                connection: redis.native,
            });
        }
        // Log voice call as a completed activity
        eventBus.on(core_1.CRM_EVENTS.VOICE_CALL_COMPLETED, async (event) => {
            const { call } = event.payload;
            if (!call)
                return;
            await db.withTenant(event.tenantId, async (client) => {
                await client.query(`INSERT INTO activities
             (tenant_id, type, subject, status, contact_id, deal_id,
              owner_id, completed_at, duration, metadata)
           VALUES ($1, 'voice_bot_call', $2, 'completed', $3, $4, $5, NOW(), $6, $7::jsonb)`, [
                    event.tenantId,
                    `${call.direction === 'inbound' ? 'Inbound' : 'Outbound'} call — ${call.status}`,
                    call.contact_id,
                    call.deal_id,
                    call.agent_id,
                    call.duration,
                    JSON.stringify({ callId: call.id, provider: call.provider, botHandled: call.bot_handled }),
                ]);
            });
        });
        // Schedule reminders for due tasks
        eventBus.on(core_1.CRM_EVENTS.ACTIVITY_CREATED, async (event) => {
            const { activity } = event.payload;
            if (activity?.due_at && activity.type === 'task' && this.reminderQueue) {
                const delay = new Date(activity.due_at).getTime() - Date.now() - 15 * 60_000; // 15 min before
                if (delay > 0) {
                    await this.reminderQueue.add('remind', { activityId: activity.id, tenantId: event.tenantId }, { delay });
                }
            }
        });
    }
    async onUnload() {
        await this.reminderQueue?.close();
    }
}
exports.ActivitiesModule = ActivitiesModule;
//# sourceMappingURL=index.js.map