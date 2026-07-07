"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContactsModule = void 0;
const core_1 = require("@crm/core");
class ContactsModule {
    name = 'contacts';
    version = '1.0.0';
    description = 'Contacts and Companies management with lead scoring';
    requiredPlan = 'free';
    eventBus;
    async onLoad(ctx) {
        this.eventBus = ctx.eventBus;
        // Auto-bump contact score when a call completes
        this.eventBus.on(core_1.CRM_EVENTS.VOICE_CALL_COMPLETED, async (event) => {
            const { contactId } = event.payload;
            if (!contactId)
                return;
            const db = ctx.db;
            await db.withTenant(event.tenantId, async (client) => {
                await client.query(`UPDATE contacts
           SET score = LEAST(score + 5, 100),
               last_contacted_at = NOW()
           WHERE id = $1`, [contactId]);
            });
        });
        // Create contact from voice bot if caller not matched
        this.eventBus.on('voice.qualified_lead', async (event) => {
            const { callId, intent, entities } = event.payload;
            const db = ctx.db;
            const phone = entities?.phone ?? entities?.caller_number;
            if (!phone)
                return;
            await db.withTenant(event.tenantId, async (client) => {
                await client.query(`INSERT INTO contacts
             (tenant_id, first_name, phone, source, status, tags, score)
           VALUES ($1, $2, $3, 'voice_bot', 'lead', ARRAY[$4], 20)
           ON CONFLICT DO NOTHING`, [event.tenantId, entities?.name ?? 'Unknown', phone, intent]);
            });
        });
    }
    async onUnload() { }
}
exports.ContactsModule = ContactsModule;
//# sourceMappingURL=index.js.map