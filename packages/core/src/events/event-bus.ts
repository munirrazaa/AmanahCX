import { EventEmitter } from 'node:events';
import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { logger } from '../config/logger';

export interface CRMEvent {
  id: string;
  tenantId: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: Date;
}

type EventHandler = (event: CRMEvent) => Promise<void>;

// Dual-mode event bus:
// - In-process: EventEmitter for same-process handlers (fast)
// - Durable: BullMQ for cross-service / async handlers (reliable)
export class EventBus {
  private emitter = new EventEmitter();
  private publishQueue: Queue;
  private workers: Worker[] = [];

  constructor(private redis: Redis) {
    this.emitter.setMaxListeners(100);
    this.publishQueue = new Queue('crm-events', {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }

  // Subscribe to events in-process
  on(eventType: string, handler: EventHandler): void {
    this.emitter.on(eventType, handler);
  }

  // Subscribe to events via durable queue (survives restarts)
  subscribe(eventType: string, handler: EventHandler, concurrency = 5): void {
    const worker = new Worker(
      `crm-events:${eventType}`,
      async (job: Job<CRMEvent>) => {
        await handler(job.data);
      },
      { connection: this.redis, concurrency },
    );

    worker.on('failed', (job, err) => {
      logger.error('Event handler failed', {
        event: eventType,
        jobId: job?.id,
        error: err.message,
      });
    });

    this.workers.push(worker);
  }

  async publish(tenantId: string, type: string, payload: Record<string, unknown>): Promise<void> {
    const event: CRMEvent = {
      id: crypto.randomUUID(),
      tenantId,
      type,
      payload,
      timestamp: new Date(),
    };

    // Fire in-process immediately
    this.emitter.emit(type, event);
    this.emitter.emit('*', event); // catch-all listener

    // Enqueue durably for async subscribers
    await this.publishQueue.add(type, event, {
      jobId: event.id,
    });
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await this.publishQueue.close();
  }
}

// Well-known event types — extend as modules add their own
export const CRM_EVENTS = {
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
  TICKET_CREATED:    'ticket.created',
  TICKET_ASSIGNED:   'ticket.assigned',
  TICKET_ACCEPTED:   'ticket.accepted',
  TICKET_RESOLVED:   'ticket.resolved',
  TICKET_CLOSED:     'ticket.closed',
  TICKET_ESCALATED:  'ticket.escalated',
  TICKET_COMMENTED:  'ticket.commented',
  TICKET_RCA_SUBMITTED: 'ticket.rca_submitted',
  SLA_REMINDER:      'ticket.sla_reminder',
  SLA_BREACH:        'ticket.sla_breach',
  CSAT_SENT:         'csat.sent',
  CSAT_RECEIVED:     'csat.received',
} as const;
