"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseClient = void 0;
const pg_1 = require("pg");
const logger_1 = require("../config/logger");
class DatabaseClient {
    pool;
    constructor(connectionString) {
        // Managed Postgres (e.g. Supabase) requires TLS, but its pooler presents a
        // certificate that isn't in the default CA chain. Encrypt without strict
        // verification for Supabase; plain/local Postgres connects without SSL.
        const useSsl = /supabase\.(co|com)/.test(connectionString) || process.env.DATABASE_SSL === 'require';
        this.pool = new pg_1.Pool({
            connectionString,
            ssl: useSsl ? { rejectUnauthorized: false } : undefined,
            max: 20,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 10_000,
        });
        this.pool.on('error', (err) => {
            logger_1.logger.error('Unexpected database pool error', { error: err.message });
        });
    }
    async connect() {
        const client = await this.pool.connect();
        client.release();
        logger_1.logger.info('Database connected');
    }
    // Returns a connection scoped to the given tenant using RLS session variable.
    // Every query on this connection is automatically filtered by tenant_id via RLS.
    async withTenant(tenantId, fn) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            // Set RLS context — PostgreSQL RLS policies read this variable
            await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
    }
    // For super-admin queries that bypass tenant isolation
    async withSuperAdmin(fn) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`SET LOCAL app.bypass_rls = 'on'`);
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
    }
    async query(sql, params) {
        const result = await this.pool.query(sql, params);
        return result.rows;
    }
    async end() {
        await this.pool.end();
    }
}
exports.DatabaseClient = DatabaseClient;
//# sourceMappingURL=client.js.map