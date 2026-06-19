export type ActivityType = 'call' | 'voice_bot_call' | 'email' | 'meeting' | 'task' | 'note' | 'whatsapp' | 'sms' | 'demo' | 'proposal' | 'deal_stage_change' | 'contact_created' | 'deal_created';
export interface Activity {
    id: string;
    tenantId: string;
    type: ActivityType;
    subject: string;
    body?: string;
    status: 'pending' | 'completed' | 'cancelled';
    priority: 'low' | 'normal' | 'high' | 'urgent';
    contactId?: string;
    companyId?: string;
    dealId?: string;
    ownerId: string;
    scheduledAt?: Date;
    completedAt?: Date;
    dueAt?: Date;
    duration?: number;
    outcome?: string;
    metadata?: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}
//# sourceMappingURL=activity.d.ts.map