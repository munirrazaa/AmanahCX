"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRM_EVENTS = exports.EventBus = void 0;
const node_events_1 = require("node:events");
const bullmq_1 = require("bullmq");
const logger_1 = require("../config/logger");
// Dual-mode event bus:
// - In-process: EventEmitter for same-process handlers (fast)
// - Durable: BullMQ for cross-service / async handlers (reliable)
class EventBus {
    redis;
    emitter = new node_events_1.EventEmitter();
    publishQueue = null;
    workers = [];
    durable;
    // Pass a real ioredis client to enable durable cross-process delivery via
    // BullMQ. Pass null (no Redis) to run purely in-process — handlers still fire
    // synchronously within this process, which is correct for a single node.
    constructor(redis) {
        this.redis = redis;
        this.emitter.setMaxListeners(100);
        this.durable = !!redis;
        if (this.durable && redis) {
            this.publishQueue = new bullmq_1.Queue('crm-events', {
                connection: redis,
                defaultJobOptions: {
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 1000 },
                    removeOnComplete: { count: 1000 },
                    removeOnFail: { count: 5000 },
                },
            });
        }
    }
    // Subscribe to events in-process
    on(eventType, handler) {
        this.emitter.on(eventType, handler);
    }
    // Subscribe to events. With Redis → durable BullMQ worker. Without Redis →
    // in-process delivery so the same subscribers still run.
    subscribe(eventType, handler, concurrency = 5) {
        if (!this.durable || !this.redis) {
            this.emitter.on(eventType, (event) => {
                handler(event).catch((err) => logger_1.logger.error('Event handler failed', { event: eventType, error: err.message }));
            });
            return;
        }
        const worker = new bullmq_1.Worker(`crm-events:${eventType}`, async (job) => {
            await handler(job.data);
        }, { connection: this.redis, concurrency });
        worker.on('failed', (job, err) => {
            logger_1.logger.error('Event handler failed', {
                event: eventType,
                jobId: job?.id,
                error: err.message,
            });
        });
        this.workers.push(worker);
    }
    async publish(tenantId, type, payload) {
        const event = {
            id: crypto.randomUUID(),
            tenantId,
            type,
            payload,
            timestamp: new Date(),
        };
        // Fire in-process immediately
        this.emitter.emit(type, event);
        this.emitter.emit('*', event); // catch-all listener
        // Enqueue durably for async subscribers (only when Redis is configured)
        if (this.durable && this.publishQueue) {
            try {
                await this.publishQueue.add(type, event, { jobId: event.id });
            }
            catch (err) {
                logger_1.logger.error('Durable event publish failed', { type, error: err.message });
            }
        }
    }
    async shutdown() {
        await Promise.all(this.workers.map((w) => w.close()));
        if (this.publishQueue)
            await this.publishQueue.close();
    }
}
exports.EventBus = EventBus;
// Well-known event types — extend as modules add their own
exports.CRM_EVENTS = {
    CONTACT_CREATED: 'contact.created',
    CONTACT_UPDATED: 'contact.updated',
    CONTACT_DELETED: 'contact.deleted',
    DEAL_CREATED: 'deal.created',
    DEAL_UPDATED: 'deal.updated',
    DEAL_STAGE_CHANGED: 'deal.stage_changed',
    DEAL_WON: 'deal.won',
    DEAL_LOST: 'deal.lost',
    ACTIVITY_CREATED: 'activity.created',
    ACTIVITY_COMPLETED: 'activity.completed',
    VOICE_CALL_STARTED: 'voice.call_started',
    VOICE_CALL_COMPLETED: 'voice.call_completed',
    VOICE_CALL_TRANSCRIBED: 'voice.call_transcribed',
    VOICE_TRANSFER_REQUESTED: 'voice.transfer_requested',
    EMAIL_SENT: 'email.sent',
    EMAIL_RECEIVED: 'email.received',
    WEBHOOK_FIRED: 'webhook.fired',
    TENANT_CREATED: 'tenant.created',
    TENANT_PLAN_CHANGED: 'tenant.plan_changed',
    // Ticketing
    TICKET_CREATED: 'ticket.created',
    TICKET_ASSIGNED: 'ticket.assigned',
    TICKET_ACCEPTED: 'ticket.accepted',
    TICKET_RESOLVED: 'ticket.resolved',
    TICKET_CLOSED: 'ticket.closed',
    TICKET_ESCALATED: 'ticket.escalated',
    TICKET_COMMENTED: 'ticket.commented',
    TICKET_RCA_SUBMITTED: 'ticket.rca_submitted',
    SLA_REMINDER: 'ticket.sla_reminder',
    SLA_BREACH: 'ticket.sla_breach',
    CSAT_SENT: 'csat.sent',
    CSAT_RECEIVED: 'csat.received',
};
//# sourceMappingURL=event-bus.js.map