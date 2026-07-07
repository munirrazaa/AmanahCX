"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantService = void 0;
const shared_1 = require("@crm/shared");
const logger_1 = require("../config/logger");
const TENANT_CACHE_TTL = 300; // 5 minutes
class TenantService {
    db;
    redis;
    constructor(db, redis) {
        this.db = db;
        this.redis = redis;
    }
    async create(input) {
        const plan = input.plan ?? 'trial';
        const settings = {
            timezone: 'UTC',
            locale: 'en-US',
            currency: 'USD',
            features: shared_1.PLAN_FEATURES[plan] ?? shared_1.PLAN_FEATURES.free,
            limits: shared_1.PLAN_LIMITS[plan] ?? shared_1.PLAN_LIMITS.free,
        };
        const [tenant] = await this.db.withSuperAdmin(async (client) => {
            const result = await client.query(`INSERT INTO tenants (name, slug, plan, status, trial_ends_at, settings)
         VALUES ($1, $2, $3, 'trial', NOW() + INTERVAL '14 days', $4)
         RETURNING *`, [input.name, input.slug, plan, JSON.stringify(settings)]);
            return result.rows;
        });
        logger_1.logger.info('Tenant created', { tenantId: tenant.id, slug: input.slug });
        return tenant;
    }
    async findById(id) {
        const cacheKey = `tenant:${id}`;
        const cached = await this.redis.get(cacheKey);
        if (cached)
            return JSON.parse(cached);
        const [tenant] = await this.db.withSuperAdmin(async (client) => {
            const result = await client.query('SELECT * FROM tenants WHERE id = $1', [id]);
            return result.rows;
        });
        if (tenant) {
            await this.redis.setex(cacheKey, TENANT_CACHE_TTL, JSON.stringify(tenant));
        }
        return tenant ?? null;
    }
    async findBySlug(slug) {
        const cacheKey = `tenant:slug:${slug}`;
        const cached = await this.redis.get(cacheKey);
        if (cached)
            return JSON.parse(cached);
        const [tenant] = await this.db.withSuperAdmin(async (client) => {
            const result = await client.query('SELECT * FROM tenants WHERE slug = $1', [slug]);
            return result.rows;
        });
        if (tenant) {
            await this.redis.setex(cacheKey, TENANT_CACHE_TTL, JSON.stringify(tenant));
        }
        return tenant ?? null;
    }
    async findByDomain(domain) {
        const cacheKey = `tenant:domain:${domain}`;
        const cached = await this.redis.get(cacheKey);
        if (cached)
            return JSON.parse(cached);
        const [tenant] = await this.db.withSuperAdmin(async (client) => {
            const result = await client.query('SELECT * FROM tenants WHERE custom_domain = $1', [domain]);
            return result.rows;
        });
        if (tenant) {
            await this.redis.setex(cacheKey, TENANT_CACHE_TTL, JSON.stringify(tenant));
        }
        return tenant ?? null;
    }
    async updatePlan(tenantId, plan) {
        const settings = {
            features: shared_1.PLAN_FEATURES[plan],
            limits: shared_1.PLAN_LIMITS[plan],
        };
        await this.db.withSuperAdmin(async (client) => {
            await client.query(`UPDATE tenants SET plan = $1, settings = settings || $2::jsonb, updated_at = NOW()
         WHERE id = $3`, [plan, JSON.stringify(settings), tenantId]);
        });
        await this.invalidateCache(tenantId);
        logger_1.logger.info('Tenant plan updated', { tenantId, plan });
    }
    async suspend(tenantId) {
        await this.db.withSuperAdmin(async (client) => {
            await client.query(`UPDATE tenants SET status = 'suspended', updated_at = NOW() WHERE id = $1`, [tenantId]);
        });
        await this.invalidateCache(tenantId);
    }
    async checkLimit(tenantId, metric) {
        const tenant = await this.findById(tenantId);
        if (!tenant)
            throw new Error('Tenant not found');
        const limits = tenant.settings.limits;
        const limit = limits[metric] ?? 0;
        if (limit === -1)
            return { allowed: true, current: 0, limit: -1 }; // unlimited
        const period = new Date().toISOString().slice(0, 7); // YYYY-MM
        const cacheKey = `usage:${tenantId}:${metric}:${period}`;
        const cached = await this.redis.get(cacheKey);
        const current = cached ? parseInt(cached) : await this.getUsageFromDb(tenantId, metric, period);
        return { allowed: current < limit, current, limit };
    }
    async incrementUsage(tenantId, metric, by = 1) {
        const period = new Date().toISOString().slice(0, 7);
        const cacheKey = `usage:${tenantId}:${metric}:${period}`;
        await this.redis.incrby(cacheKey, by);
        await this.redis.expire(cacheKey, 86_400 * 32); // 32 days
        // Async write to DB (fire and forget)
        this.db.query(`INSERT INTO usage_metrics (tenant_id, metric, value, period)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, metric, period)
       DO UPDATE SET value = usage_metrics.value + $3, updated_at = NOW()`, [tenantId, metric, by, period]).catch((err) => logger_1.logger.error('Failed to persist usage metric', { error: err.message }));
    }
    async getUsageFromDb(tenantId, metric, period) {
        const [row] = await this.db.query(`SELECT value FROM usage_metrics WHERE tenant_id = $1 AND metric = $2 AND period = $3`, [tenantId, metric, period]);
        return row?.value ?? 0;
    }
    /** Public alias for invalidating a single tenant's cache by ID. */
    async invalidateCacheById(tenantId) {
        return this.invalidateCache(tenantId);
    }
    async invalidateCache(tenantId) {
        const tenant = await this.findById(tenantId);
        if (!tenant)
            return;
        await Promise.all([
            this.redis.del(`tenant:${tenantId}`),
            this.redis.del(`tenant:slug:${tenant.slug}`),
            tenant.customDomain ? this.redis.del(`tenant:domain:${tenant.customDomain}`) : Promise.resolve(),
        ]);
    }
}
exports.TenantService = TenantService;
//# sourceMappingURL=tenant.service.js.map