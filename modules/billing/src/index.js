"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingModule = void 0;
class BillingModule {
    name = 'billing';
    version = '1.0.0';
    description = 'Subscription billing — Stripe, Wise, JazzCash, Easypaisa, Raast';
    requiredPlan = 'free';
    async onLoad(ctx) {
        const eventBus = ctx.eventBus;
        // When a tenant's trial ends, suspend or send reminder
        eventBus.on('billing.payment_failed', async (event) => {
            const db = ctx.db;
            // Mark as past_due after 3 failed attempts (webhook handles retry logic)
            await db.withSuperAdmin(async (client) => {
                await client.query(`UPDATE tenants SET status = 'past_due' WHERE id = $1`, [event.tenantId]);
            });
        });
        eventBus.on('billing.payment_succeeded', async (event) => {
            const db = ctx.db;
            // Ensure status is active after successful payment
            await db.withSuperAdmin(async (client) => {
                await client.query(`UPDATE tenants SET status = 'active' WHERE id = $1`, [event.tenantId]);
            });
        });
    }
    async onUnload() { }
}
exports.BillingModule = BillingModule;
//# sourceMappingURL=index.js.map