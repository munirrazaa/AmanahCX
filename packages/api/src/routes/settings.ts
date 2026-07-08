import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient, RedisClient } from '@crm/core';
import { requireRole } from '../middlewares/auth.middleware';
import { revokeUserSessions } from './auth';
import { EmailService } from '../services/email.service';
import { MODULE_CATALOG } from './super-admin';

// ── Module permission definitions ─────────────────────────────────────────
// Each module can have access level: 'none' | 'view' | 'full'
// 'none' = module hidden, 'view' = read-only, 'full' = create/edit/delete

export const MODULE_DEFS = [
  { key: 'dashboard',    label: 'Dashboard',     levels: ['none', 'view'] },
  { key: 'contacts',     label: 'Contacts',      levels: ['none', 'view', 'full'] },
  { key: 'companies',    label: 'Companies',     levels: ['none', 'view', 'full'] },
  { key: 'deals',        label: 'Deals',         levels: ['none', 'view', 'full'] },
  { key: 'activities',   label: 'Activities',    levels: ['none', 'view', 'full'] },
  { key: 'tickets',      label: 'Tickets',       levels: ['none', 'view', 'full'] },
  { key: 'emails',       label: 'Emails',        levels: ['none', 'view', 'full'] },
  { key: 'analytics',    label: 'Analytics',     levels: ['none', 'view'] },
  { key: 'voice',        label: 'Voice Calls',   levels: ['none', 'view', 'full'] },
  { key: 'voicebot',     label: 'Voice Bot',     levels: ['none', 'view', 'full'] },
  { key: 'integrations', label: 'Integrations',  levels: ['none', 'view', 'full'] },
  { key: 'settings',     label: 'Settings',      levels: ['none', 'view'] },
  { key: 'billing',      label: 'Billing',       levels: ['none', 'view'] },
];

// Default permissions per role
export function defaultPermissions(role: string): Record<string, string> {
  switch (role) {
    case 'tenant_admin':
      return Object.fromEntries(MODULE_DEFS.map((m) => [m.key, m.levels[m.levels.length - 1]]));
    case 'manager':
      return {
        dashboard: 'view', contacts: 'full', companies: 'full', deals: 'full',
        activities: 'full', tickets: 'full', emails: 'full', analytics: 'view',
        voice: 'full', voicebot: 'view', integrations: 'view', settings: 'none', billing: 'none',
      };
    case 'agent':
    default:
      return {
        dashboard: 'view', contacts: 'full', companies: 'view', deals: 'view',
        activities: 'full', tickets: 'full', emails: 'full', analytics: 'none',
        voice: 'view', voicebot: 'none', integrations: 'none', settings: 'none', billing: 'none',
      };
  }
}

// ── Gap 8 fix: Department type enum (replaces fragile keyword matching) ───────
//
// Instead of substring-matching free-text department names, we use a
// structured `department_type` value stored alongside the department name.
// The invite & team-edit APIs accept an optional `departmentType` that maps
// directly to one of the six predefined override sets.  When no explicit type
// is supplied, we fall back to fuzzy keyword matching only as a last resort
// (e.g. for legacy rows that have no type stored yet).
//
// The six canonical types:
export const DEPT_TYPES = [
  'support',             // Customer support / service desk / helpdesk / complaint
  'sales',               // Sales / retail / commercial / revenue
  'compliance_audit',    // Compliance / audit / legal / risk
  'finance_billing',     // Finance / billing / payments / accounts
  'technical_operations',// Technical / IT / infrastructure / broadband
  'operations',          // Logistics / warehouse / dispatch / last-mile
] as const;
export type DeptType = typeof DEPT_TYPES[number];

// Permissions overlay per department type
const DEPT_OVERRIDES: Record<DeptType, Record<string, string>> = {
  support: {
    deals: 'none', voicebot: 'none', integrations: 'none', billing: 'none', settings: 'none',
  },
  sales: {
    tickets: 'none', voicebot: 'none', integrations: 'none', billing: 'none', settings: 'none',
  },
  compliance_audit: {
    contacts: 'view', companies: 'view', deals: 'view', activities: 'view',
    tickets: 'view', emails: 'view', voice: 'view', analytics: 'view',
    voicebot: 'none', integrations: 'none', billing: 'none', settings: 'none',
  },
  finance_billing: {
    deals: 'view', tickets: 'none', voicebot: 'none', integrations: 'none', settings: 'none',
  },
  technical_operations: {
    deals: 'none', voicebot: 'view', integrations: 'view', billing: 'none', settings: 'none',
  },
  operations: {
    deals: 'view', tickets: 'view', voicebot: 'none', integrations: 'none', billing: 'none', settings: 'none',
  },
};

// Legacy keyword → department type mapping (used as fallback only for old rows)
const KEYWORD_TO_DEPT_TYPE: Array<{ keywords: string[]; type: DeptType }> = [
  { keywords: ['support', 'complaint', 'ticket', 'service desk', 'helpdesk'], type: 'support' },
  { keywords: ['sales', 'retail', 'new business', 'commercial', 'revenue'],   type: 'sales' },
  { keywords: ['compliance', 'audit', 'legal', 'risk'],                        type: 'compliance_audit' },
  { keywords: ['finance', 'billing', 'payment', 'accounts'],                   type: 'finance_billing' },
  { keywords: ['technical', 'tech support', 'it ', 'infrastructure', 'engineering', 'broadband'], type: 'technical_operations' },
  { keywords: ['operation', 'logistics', 'warehouse', 'last mile', 'customs', 'dispatch'],        type: 'operations' },
];

// Resolve the structured type from an explicit value, then fall back to keyword scan.
// Returns null if neither matches.
export function resolveDeptType(
  departmentType: string | null | undefined,
  departmentName: string | null | undefined,
): DeptType | null {
  // 1. Explicit structured type (preferred)
  if (departmentType && DEPT_TYPES.includes(departmentType as DeptType)) {
    return departmentType as DeptType;
  }
  // 2. Legacy keyword fallback — scan the department name (last resort)
  if (departmentName) {
    const lower = departmentName.toLowerCase();
    for (const { keywords, type } of KEYWORD_TO_DEPT_TYPE) {
      // Exact word-boundary match using \b to prevent "IT Support" matching both rules
      if (keywords.some((kw) => new RegExp(`\\b${kw.replace(/\s+/g, '\\s+')}\\b`).test(lower))) {
        return type;
      }
    }
  }
  return null;
}

// Returns permissions appropriate for the given department type + role.
// Admins and managers always receive their full role defaults.
export function departmentPermissions(
  department: string | null | undefined,
  role: string,
  departmentType?: string | null,
): Record<string, string> {
  const base = defaultPermissions(role);
  if (!department || role === 'tenant_admin' || role === 'manager') return base;

  const deptType = resolveDeptType(departmentType, department);
  if (!deptType) return base;

  return { ...base, ...DEPT_OVERRIDES[deptType] };
}

// Export for use in shared/frontend dropdowns
export const DEPT_TYPE_LABELS: Record<DeptType, string> = {
  support:              'Support / Service Desk',
  sales:                'Sales / Commercial',
  compliance_audit:     'Compliance / Audit / Legal',
  finance_billing:      'Finance / Billing',
  technical_operations: 'Technical / IT / Operations',
  operations:           'Operations / Logistics',
};

const WorkspaceSchema = z.object({
  name:       z.string().min(1).optional(),
  domain:     z.string().optional(),
  timezone:   z.string().optional(),
  dateFormat: z.string().optional(),
  currency:   z.string().length(3).optional(),
});

export function settingsRoutes(db: DatabaseClient, redis: RedisClient) {
  const emailSvc = new EmailService(db);

  return async function (fastify: FastifyInstance) {

    // Root — returns workspace + plan info
    fastify.get('/', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const [tenant] = await db.withSuperAdmin(async (client) => {
        const result = await client.query(
          'SELECT id, name, slug, plan, status, settings, billing_details FROM tenants WHERE id = $1',
          [req.tenant.id],
        );
        return result.rows;
      });
      return reply.send({ success: true, data: tenant });
    });

    // Get workspace settings
    fastify.get('/workspace', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const [tenant] = await db.withSuperAdmin(async (client) => {
        const result = await client.query(
          'SELECT id, name, slug, custom_domain, plan, status, sector, settings, billing_details FROM tenants WHERE id = $1',
          [req.tenant.id],
        );
        return result.rows;
      });
      return reply.send({ success: true, data: tenant });
    });

    // Update workspace settings
    fastify.patch('/workspace', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const body = WorkspaceSchema.parse(req.body);
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      if (body.name)       { sets.push(`name = $${i++}`);                          vals.push(body.name); }
      if (body.domain)     { sets.push(`custom_domain = $${i++}`);                 vals.push(body.domain); }
      if (body.timezone)   { sets.push(`settings = jsonb_set(COALESCE(settings,'{}'), '{timezone}', $${i++}::jsonb)`); vals.push(JSON.stringify(body.timezone)); }
      if (body.dateFormat) { sets.push(`settings = jsonb_set(COALESCE(settings,'{}'), '{dateFormat}', $${i++}::jsonb)`); vals.push(JSON.stringify(body.dateFormat)); }
      if (body.currency)   { sets.push(`settings = jsonb_set(COALESCE(settings,'{}'), '{currency}', $${i++}::jsonb)`); vals.push(JSON.stringify(body.currency)); }
      if (!sets.length) return reply.send({ success: true });

      vals.push(req.tenant.id);
      await db.withSuperAdmin(async (client) => {
        await client.query(`UPDATE tenants SET ${sets.join(', ')} WHERE id = $${i}`, vals);
      });
      return reply.send({ success: true });
    });

    /**
     * GET/PATCH /settings/routing
     * Ticket routing configuration:
     *   - per_agent_ticket_limit: max pending tickets per agent (0 = unlimited)
     *   - routing_method: random_capacity | round_robin | manual
     * CSAT configuration:
     *   - csat_expiry_days: survey link expiry (default 7)
     */
    fastify.get('/routing', { preHandler: requireRole('super_admin', 'tenant_admin', 'manager') }, async (req, reply) => {
      const [row] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`SELECT settings FROM tenants WHERE id = $1`, [req.tenant.id]);
        return r.rows;
      });
      const settings = row?.settings ?? {};
      return reply.send({
        success: true,
        data: {
          routing: {
            per_agent_ticket_limit: settings?.routing?.per_agent_ticket_limit ?? 0,
            routing_method:         settings?.routing?.routing_method ?? 'random_capacity',
            bot_default_priority:   settings?.routing?.bot_default_priority ?? 'medium',
          },
          csat: {
            expiry_days: settings?.csat_expiry_days ?? 7,
          },
        },
      });
    });

    fastify.patch('/routing', { preHandler: requireRole('super_admin', 'tenant_admin', 'manager') }, async (req, reply) => {
      const patcherRole = req.user.role;
      const body = z.object({
        per_agent_ticket_limit: z.number().int().min(0).max(500).optional(), // 0 = unlimited — criteria (manager+)
        routing_method:         z.enum(['random_capacity','round_robin','manual']).optional(), // algorithm — admin only
        csat_expiry_days:       z.number().int().min(1).max(90).optional(),
        bot_default_priority:   z.enum(['urgent','high','medium','low']).optional(), // criteria (manager+)
      }).parse(req.body);

      // routing_method (the algorithm) is admin-only — managers can configure criteria but not change the algorithm
      if (body.routing_method !== undefined && patcherRole === 'manager') {
        return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Only tenant admins can change the routing algorithm. Managers can adjust routing criteria (ticket limit, bot priority).' } });
      }

      await db.withSuperAdmin(async (client) => {
        if (body.per_agent_ticket_limit !== undefined || body.routing_method !== undefined || body.bot_default_priority !== undefined) {
          const current = (await client.query(`SELECT settings FROM tenants WHERE id = $1`, [req.tenant.id])).rows[0]?.settings ?? {};
          const routing = { ...(current?.routing ?? {}) };
          if (body.per_agent_ticket_limit !== undefined) routing.per_agent_ticket_limit = body.per_agent_ticket_limit;
          if (body.routing_method !== undefined)         routing.routing_method         = body.routing_method;
          if (body.bot_default_priority !== undefined)   routing.bot_default_priority   = body.bot_default_priority;
          await client.query(
            `UPDATE tenants SET settings = jsonb_set(COALESCE(settings,'{}'), '{routing}', $1::jsonb) WHERE id = $2`,
            [JSON.stringify(routing), req.tenant.id],
          );
        }
        if (body.csat_expiry_days !== undefined) {
          await client.query(
            `UPDATE tenants SET settings = jsonb_set(COALESCE(settings,'{}'), '{csat_expiry_days}', $1::jsonb) WHERE id = $2`,
            [body.csat_expiry_days, req.tenant.id],
          );
        }
      });
      return reply.send({ success: true, message: 'Routing configuration updated' });
    });

    // List team members (super_admin excluded — internal platform role)
    fastify.get('/team', { preHandler: requireRole('super_admin', 'tenant_admin', 'manager') }, async (req, reply) => {
      const { department, role: roleFilter } = req.query as { department?: string; role?: string };
      const params: unknown[] = [req.tenant.id];
      const filters: string[] = [];
      if (department) { params.push(department); filters.push(`u.department = $${params.length}`); }
      if (roleFilter)  { params.push(roleFilter);  filters.push(`u.role = $${params.length}`); }
      const whereExtra = filters.length ? `AND ${filters.join(' AND ')}` : '';
      const members = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT u.id, u.name, u.email, u.role, u.permissions, u.is_active, u.created_at,
                  u.last_login_at, u.custom_role_id, u.manager_id, u.department, u.department_type,
                  u.agent_status, u.agent_status_updated_at,
                  m.name AS manager_name,
                  r.name AS role_name, r.color AS role_color
           FROM users u
           LEFT JOIN users m ON m.id = u.manager_id AND m.tenant_id = $1
           LEFT JOIN roles r ON r.id = u.custom_role_id
           WHERE u.tenant_id = $1 AND u.role != 'super_admin' ${whereExtra}
           ORDER BY u.name ASC`,
          params,
        );
        return result.rows;
      });
      return reply.send({ success: true, data: members });
    });

    // Get direct reportees of the current user (or any user id for tenant_admin)
    fastify.get('/team/reportees', { preHandler: requireRole('super_admin', 'tenant_admin', 'manager') }, async (req, reply) => {
      const { userId } = req.query as { userId?: string };
      const targetId = userId ?? req.user.sub;
      const reportees = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT u.id, u.name, u.email, u.role, u.custom_role_id,
                  r.name AS role_name, r.color AS role_color
           FROM users u
           LEFT JOIN roles r ON r.id = u.custom_role_id
           WHERE u.tenant_id = $2 AND u.manager_id = $1 AND u.role != 'super_admin'
           ORDER BY u.name ASC`,
          [targetId, req.tenant.id],
        );
        return result.rows;
      });
      return reply.send({ success: true, data: reportees });
    });

    // Get module definitions (for permissions matrix UI)
    fastify.get('/team/modules', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (_req, reply) => {
      return reply.send({ success: true, data: MODULE_DEFS });
    });

    // ── Module management (tenant admin self-service within licensed set) ─────
    //
    // Two-tier model:
    //   active_modules (DB column)       = modules LICENSED by super admin (the ceiling)
    //   settings.enabled_modules (JSON)  = modules tenant admin has turned ON
    //                                      (subset of active_modules; defaults to all licensed)
    //
    // Tenant admin can only toggle modules that the super admin has licensed.
    // Attempting to enable an unlicensed module is rejected with 403.

    fastify.get('/workspace/modules', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const [row] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`SELECT active_modules, settings FROM tenants WHERE id = $1`, [req.tenant.id]);
        return r.rows;
      });
      const _stored: string[] | null = row?.active_modules;
      const licensedModules: string[] =
        (!_stored || (_stored.length === 1 && _stored[0] === 'crm'))
          ? ['crm', 'ticketing', 'emails', 'analytics']
          : _stored;
      // If tenant admin hasn't explicitly configured enabled_modules, default to all licensed
      const enabledModules: string[] = row?.settings?.enabled_modules ?? licensedModules;

      const result = MODULE_CATALOG.map(m => ({
        key:         m.key,
        label:       m.label,
        description: m.description,
        always:      m.always,
        licensed:    licensedModules.includes(m.key),  // set by super admin
        enabled:     m.always || (licensedModules.includes(m.key) && enabledModules.includes(m.key)),
      }));

      return reply.send({ success: true, data: result });
    });

    fastify.patch('/workspace/modules', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const body = z.object({
        // Map of module key → enable/disable boolean
        modules: z.record(z.string(), z.boolean()),
      }).parse(req.body);

      const [row] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`SELECT active_modules, settings FROM tenants WHERE id = $1`, [req.tenant.id]);
        return r.rows;
      });
      const CORE_DEFAULT = ['crm', 'ticketing', 'emails', 'analytics'];
      // Treat ['crm']-only as unset (old bootstrap default) — fall back to full core set
      const storedModules: string[] | null = row?.active_modules;
      const licensedModules: string[] =
        (!storedModules || (storedModules.length === 1 && storedModules[0] === 'crm'))
          ? CORE_DEFAULT
          : storedModules;
      // Start from current enabled state (or default to all licensed)
      const currentEnabled: string[] = row?.settings?.enabled_modules ?? [...licensedModules];
      let updatedEnabled = [...currentEnabled];

      for (const [mod, enable] of Object.entries(body.modules)) {
        // Never allow enabling modules that aren't licensed by super admin
        if (enable && !licensedModules.includes(mod)) {
          return reply.code(403).send({
            success: false,
            error: {
              code: 'MODULE_NOT_LICENSED',
              message: `Module '${mod}' is not licensed for this workspace. Contact your platform administrator.`,
            },
          });
        }
        if (enable) {
          if (!updatedEnabled.includes(mod)) updatedEnabled.push(mod);
        } else {
          updatedEnabled = updatedEnabled.filter(m => m !== mod);
        }
      }
      // 'crm' is always enabled
      if (!updatedEnabled.includes('crm')) updatedEnabled.unshift('crm');

      const settings = row?.settings ?? {};
      settings.enabled_modules = updatedEnabled;

      await db.withSuperAdmin(async (client) => {
        await client.query(
          `UPDATE tenants SET settings = $1, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify(settings), req.tenant.id],
        );
      });

      return reply.send({ success: true, data: { enabledModules: updatedEnabled, licensedModules } });
    });

    // ── Helper: enforce licensed modules on a user permissions map ───────
    // Modules that aren't in the tenant's active_modules are forced to 'none'
    // so no user can gain access to an unlicensed module regardless of what
    // permissions were submitted.
    const applyModuleLicensing = async (
      tenantId: string,
      permissions: Record<string, string>,
    ): Promise<Record<string, string>> => {
      const [row] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`SELECT active_modules FROM tenants WHERE id = $1`, [tenantId]);
        return r.rows;
      });
      const _am: string[] | null = row?.active_modules;
      const licensed: string[] =
        (!_am || (_am.length === 1 && _am[0] === 'crm'))
          ? ['crm', 'ticketing', 'emails', 'analytics']
          : _am;
      // Map of module key → top-level permission key(s) in the permissions object
      // This tells us which permissions control each module so we can enforce 'none'
      const MODULE_PERMISSION_KEYS: Record<string, string[]> = {
        voice:        ['voice'],
        voicebot:     ['voicebot'],
        ticketing:    ['tickets'],
        emails:       ['emails'],
        integrations: ['integrations'],
        analytics:    ['analytics'],
      };
      const updated = { ...permissions };
      for (const [moduleKey, permKeys] of Object.entries(MODULE_PERMISSION_KEYS)) {
        if (!licensed.includes(moduleKey)) {
          for (const pk of permKeys) {
            if (updated[pk] !== undefined) updated[pk] = 'none';
          }
        }
      }
      return updated;
    };

    // Return available department types for the invite / edit UI (Gap 8)
    fastify.get('/team/department-types', { preHandler: requireRole('super_admin', 'tenant_admin', 'manager') }, async (_req, reply) => {
      return reply.send({
        success: true,
        data: DEPT_TYPES.map(t => ({ value: t, label: DEPT_TYPE_LABELS[t] })),
      });
    });

    // Invite team member
    fastify.post('/team/invite', { preHandler: requireRole('super_admin', 'tenant_admin', 'manager') }, async (req, reply) => {
      const inviterRole = req.user.role;
      const InviteSchema = z.object({
        email:           z.string().email(),
        name:            z.string().max(100).optional(),
        // Tenant admins can assign up to manager; managers can only assign agent/viewer/policy_admin
        role:                  z.enum(['tenant_admin', 'manager', 'agent', 'viewer', 'policy_admin']).optional(),
        custom_role_id:        z.string().uuid().optional(),
        permissions:           z.record(z.string()).optional(),
        department:            z.string().max(100).optional(),
        departmentId:          z.string().uuid().optional(),   // camelCase alias — looked up to name
        // Gap 8: explicit dept type — prevents fragile keyword matching on ambiguous dept names
        departmentType:        z.enum(DEPT_TYPES).optional(),
        manager_id:            z.string().uuid().nullable().optional(),
        managerId:             z.string().uuid().nullable().optional(), // camelCase alias
        governed_departments:  z.array(z.string()).optional(),
      });
      const parsed = InviteSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ success: false, error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid input' } });
      }
      let { email, name, role, custom_role_id, permissions: customPermissions, department, departmentType, manager_id, governed_departments } = parsed.data;
      // Resolve camelCase aliases
      const managerId_alias = parsed.data.managerId;
      if (!manager_id && managerId_alias) manager_id = managerId_alias;
      const departmentId = parsed.data.departmentId;
      if (!department && departmentId) {
        const [dRow] = await db.withTenant(req.tenant.id, async (c) => {
          const r = await c.query('SELECT name FROM departments WHERE id = $1 AND tenant_id = $2', [departmentId, req.tenant.id]);
          return r.rows;
        });
        if (dRow) department = dRow.name;
      }

      // Delegated administration: managers can only invite roles below their own level
      if (inviterRole === 'manager') {
        const allowedRoles = ['agent', 'viewer', 'policy_admin'];
        if (!allowedRoles.includes(role ?? 'agent')) {
          return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Managers can only invite agents, viewers, or policy admins' } });
        }
        // Enforce department scope — invitee must be in manager's own department
        const [inviter] = await db.withTenant(req.tenant.id, async (c) => {
          const r = await c.query('SELECT department, department_type FROM users WHERE id = $1 AND tenant_id = $2', [req.user.sub, req.tenant.id]);
          return r.rows;
        });
        if (inviter?.department && department && inviter.department !== department) {
          return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'You can only invite team members to your own department' } });
        }
      }

      const displayName  = name?.trim() || email.split('@')[0];
      const assignedRole = role ?? 'agent';
      // policy_admin: governance-only — can read tickets, nothing else operational
      const policyAdminPerms: Record<string, string> = {
        dashboard: 'view', tickets: 'view', settings: 'none',
        contacts: 'none', companies: 'none', deals: 'none',
        activities: 'none', emails: 'none', voice: 'none',
        voicebot: 'none', analytics: 'none', integrations: 'none', billing: 'none',
      };
      // Explicit permissions override department defaults; department defaults override role defaults
      const rawPerms = customPermissions
        ?? (assignedRole === 'policy_admin' ? policyAdminPerms : departmentPermissions(department, assignedRole, departmentType));
      // Enforce: any module not licensed by super admin is forced to 'none'
      const perms = await applyModuleLicensing(req.tenant.id, rawPerms);

      // 1. Create (or update) user account with role + permissions + department.
      //    On conflict (re-invite), only overwrite fields the caller explicitly provided —
      //    role/name/permissions are preserved from the existing record if omitted.
      const [user] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `INSERT INTO users (tenant_id, email, name, role, password_hash, permissions, custom_role_id, department, department_type, manager_id, governed_departments)
           VALUES ($1, $2, $3, $4, 'INVITE_PENDING', $5, $6, $7, $8, $9, $10)
           ON CONFLICT (tenant_id, email) DO UPDATE
             SET role        = CASE WHEN $11 THEN EXCLUDED.role        ELSE users.role        END,
                 name        = CASE WHEN $12 THEN EXCLUDED.name        ELSE users.name        END,
                 permissions = CASE WHEN $11 THEN EXCLUDED.permissions ELSE users.permissions END,
                 custom_role_id   = COALESCE(EXCLUDED.custom_role_id, users.custom_role_id),
                 department       = COALESCE(EXCLUDED.department,      users.department),
                 department_type  = COALESCE(EXCLUDED.department_type, users.department_type),
                 manager_id       = COALESCE(EXCLUDED.manager_id,      users.manager_id),
                 governed_departments = EXCLUDED.governed_departments
           RETURNING id, email, name, role, permissions, custom_role_id, department, department_type, manager_id, governed_departments`,
          [req.tenant.id, email, displayName, assignedRole, JSON.stringify(perms), custom_role_id ?? null, department ?? null, departmentType ?? null, manager_id ?? null, governed_departments ?? [],
           role !== undefined,  // $11: was role explicitly provided?
           name !== undefined,  // $12: was name explicitly provided?
          ],
        );
        return result.rows;
      });

      // 2. Generate a password-setup token (reuses the reset-password flow)
      const rawToken  = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await db.withSuperAdmin(async (client) => {
        await client.query(
          `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET token_hash = $2, expires_at = $3, used = false`,
          [user.id, tokenHash, expiresAt],
        );
      });

      // 3. Build invite link
      const appUrl    = process.env.APP_URL ?? 'http://localhost:5173';
      const inviteUrl = `${appUrl}/reset-password?token=${rawToken}&tenant=${req.tenant.slug}`;

      // 4. Send invite email (best-effort — don't fail the request if email isn't configured)
      const [tenantRow] = await db.withSuperAdmin(async (client) => {
        const r = await client.query('SELECT name, slug FROM tenants WHERE id = $1', [req.tenant.id]);
        return r.rows;
      });
      const workspaceName = tenantRow?.name ?? 'your workspace';

      // Look up inviter name from users table
      const [inviterRow] = await db.withSuperAdmin(async (client) => {
        const r = await client.query('SELECT name FROM users WHERE id = $1', [req.user.sub]);
        return r.rows;
      });
      const inviterName = inviterRow?.name ?? 'Your admin';

      try {
        await emailSvc.send(req.tenant.id, {
          to:        email,
          toName:    displayName,
          subject:   `You've been invited to ${workspaceName} CRM`,
          bodyHtml: `
            <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9fafb;border-radius:12px;">
              <div style="text-align:center;margin-bottom:28px;">
                <div style="display:inline-block;background:linear-gradient(135deg,#29ABE2,#4D8B3C);border-radius:16px;padding:14px 18px;">
                  <span style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-1px;">Vivid CRM</span>
                </div>
              </div>
              <div style="background:#fff;border-radius:10px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
                <h2 style="margin:0 0 8px;color:#111827;font-size:22px;">You're invited! 🎉</h2>
                <p style="color:#6b7280;margin:0 0 20px;line-height:1.6;">
                  <strong>${inviterName}</strong> has invited you to join <strong>${workspaceName}</strong> on Vivid CRM as <strong>${role ?? 'agent'}</strong>.
                </p>
                <p style="color:#6b7280;margin:0 0 28px;line-height:1.6;">
                  Click the button below to set your password and get started. This link is valid for <strong>7 days</strong>.
                </p>
                <div style="text-align:center;margin-bottom:28px;">
                  <a href="${inviteUrl}"
                     style="display:inline-block;background:linear-gradient(135deg,#29ABE2,#1a8cbf);color:#fff;
                            text-decoration:none;font-weight:700;font-size:15px;padding:14px 36px;
                            border-radius:8px;box-shadow:0 4px 14px rgba(41,171,226,0.35);">
                    Accept Invitation &amp; Set Password
                  </a>
                </div>
                <p style="color:#9ca3af;font-size:12px;margin:0;text-align:center;">
                  Or copy this link: <a href="${inviteUrl}" style="color:#29ABE2;">${inviteUrl}</a>
                </p>
              </div>
              <p style="text-align:center;color:#9ca3af;font-size:11px;margin-top:20px;">
                © ${new Date().getFullYear()} AmanahCX. If you didn't expect this invitation, you can ignore this email.
              </p>
            </div>
          `,
          bodyText: `You've been invited to join ${workspaceName} on Vivid CRM as ${role ?? 'agent'}.\n\nSet your password here: ${inviteUrl}\n\nThis link expires in 7 days.`,
        });
      } catch {
        // Email failure should not block the invite — user is created, admin can resend
      }

      return reply.code(201).send({ success: true, data: user, invite_url: inviteUrl });
    });

    // Remove team member
    fastify.delete('/team/:userId', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const { userId } = req.params as { userId: string };
      if (userId === req.user.sub) {
        return reply.code(400).send({ success: false, error: { code: 'CANNOT_REMOVE_SELF', message: 'Cannot remove your own account' } });
      }
      await db.withTenant(req.tenant.id, async (client) => {
        // Explicit tenant_id guard as defence-in-depth alongside RLS
        await client.query('DELETE FROM users WHERE id = $1 AND tenant_id = $2', [userId, req.tenant.id]);
      });
      return reply.code(204).send();
    });

    // Update team member role and/or permissions
    fastify.patch('/team/:userId', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const { userId } = req.params as { userId: string };
      const PatchSchema = z.object({
        name:           z.string().min(1).max(100).optional(),
        // Restrict to tenant-level roles only — super_admin cannot be self-assigned
        role:           z.enum(['tenant_admin', 'manager', 'agent', 'viewer']).optional(),
        department:     z.string().max(100).nullable().optional(),
        departmentType: z.enum(DEPT_TYPES).nullable().optional(), // Gap 8
        permissions:    z.record(z.string()).optional(),
        manager_id:     z.string().uuid().nullable().optional(),
        custom_role_id: z.string().uuid().nullable().optional(),
        is_active:      z.boolean().optional(),
      });
      const parsed = PatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ success: false, error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid input' } });
      }
      const { name: patchName, role, department, departmentType, permissions: customPermissions, manager_id, custom_role_id, is_active } = parsed.data;

      const [user] = await db.withTenant(req.tenant.id, async (client) => {
        // Build dynamic update
        const updates: string[] = [];
        const vals: any[] = [];
        let i = 1;

        // Fetch current user state to derive permissions when only department changes
        const [current] = (await client.query('SELECT role, department, department_type FROM users WHERE id = $1 AND tenant_id = $2', [userId, req.tenant.id])).rows;
        const effectiveRole     = role ?? current?.role ?? 'agent';
        const effectiveDept     = department !== undefined ? department : current?.department;
        const effectiveDeptType = departmentType !== undefined ? departmentType : current?.department_type;

        if (patchName !== undefined) {
          updates.push(`name = $${i++}`);
          vals.push(patchName);
        }
        if (role !== undefined) {
          updates.push(`role = $${i++}`);
          vals.push(role);
        }
        if (department !== undefined) {
          updates.push(`department = $${i++}`);
          vals.push(department);
        }
        if (departmentType !== undefined) {
          updates.push(`department_type = $${i++}`);
          vals.push(departmentType);
        }
        // Recalculate permissions when role or department changes, unless caller supplies explicit permissions
        if (!customPermissions && (role !== undefined || department !== undefined || departmentType !== undefined)) {
          const rawPerms = departmentPermissions(effectiveDept, effectiveRole, effectiveDeptType);
          const enforcedPerms = await applyModuleLicensing(req.tenant.id, rawPerms);
          updates.push(`permissions = $${i++}`);
          vals.push(JSON.stringify(enforcedPerms));
        }
        if (customPermissions !== undefined) {
          const enforcedPerms = await applyModuleLicensing(req.tenant.id, customPermissions);
          updates.push(`permissions = $${i++}`);
          vals.push(JSON.stringify(enforcedPerms));
        }
        if (manager_id !== undefined) {
          updates.push(`manager_id = $${i++}`);
          vals.push(manager_id);
        }
        if (custom_role_id !== undefined) {
          updates.push(`custom_role_id = $${i++}`);
          vals.push(custom_role_id);
        }
        if (is_active !== undefined) {
          updates.push(`is_active = $${i++}`);
          vals.push(is_active);
        }

        if (updates.length === 0) return [null];

        vals.push(userId);
        const result = await client.query(
          `UPDATE users SET ${updates.join(', ')}, updated_at = NOW()
           WHERE id = $${i} RETURNING id, name, email, role, department, department_type, permissions, manager_id, custom_role_id, is_active`,
          vals,
        );
        return result.rows;
      });

      if (!user) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });

      // G-R3 — ISO 27001 A.9.2.6: immediately revoke all live tokens when deactivating.
      // On reactivation clear the revocation key so the user can log in again.
      if (is_active === false) {
        revokeUserSessions(redis, userId, new Date()).catch(() => {});
      } else if (is_active === true) {
        revokeUserSessions(redis, userId, null).catch(() => {});
      }

      return reply.send({ success: true, data: user });
    });


    // ── Milestone Templates ───────────────────────────────────────────────
    // GET  /settings/milestone-templates
    // PUT  /settings/milestone-templates/:ticketType
    fastify.get('/milestone-templates', { preHandler: requireRole('super_admin', 'tenant_admin', 'manager') }, async (req, reply) => {
      const templates = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `SELECT * FROM ticket_milestone_templates WHERE tenant_id = $1 ORDER BY ticket_type`,
          [req.tenant.id],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: templates });
    });

    fastify.put('/milestone-templates/:ticketType', { preHandler: requireRole('super_admin','tenant_admin') }, async (req, reply) => {
      const { ticketType } = req.params as { ticketType: string };
      const { name, steps } = req.body as { name?: string; steps: Array<{ id: string; label: string; description?: string; order: number }> };

      const [tmpl] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `INSERT INTO ticket_milestone_templates (tenant_id, ticket_type, name, steps)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (tenant_id, ticket_type) DO UPDATE
             SET name = EXCLUDED.name, steps = EXCLUDED.steps, updated_at = NOW()
           RETURNING *`,
          [req.tenant.id, ticketType, name ?? ticketType, JSON.stringify(steps)],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: tmpl });
    });

    fastify.delete('/milestone-templates/:ticketType', { preHandler: requireRole('super_admin','tenant_admin') }, async (req, reply) => {
      const { ticketType } = req.params as { ticketType: string };
      await db.withSuperAdmin(async (client) => {
        await client.query(
          `DELETE FROM ticket_milestone_templates WHERE tenant_id = $1 AND ticket_type = $2`,
          [req.tenant.id, ticketType],
        );
      });
      return reply.code(204).send();
    });

    // ── Queue routing config ──────────────────────────────────────────────
    fastify.patch('/team/queues/:queueId/routing', { preHandler: requireRole('super_admin','tenant_admin') }, async (req, reply) => {
      const { queueId } = req.params as { queueId: string };
      const { routingMethod, routingCriteria } = req.body as { routingMethod: string; routingCriteria?: Record<string, unknown> };

      await db.withTenant(req.tenant.id, async (client) => {
        await client.query(
          `UPDATE ticket_queues SET routing_method = $1, routing_criteria = $2::jsonb WHERE id = $3`,
          [routingMethod, JSON.stringify(routingCriteria ?? {}), queueId],
        );
      });
      return reply.send({ success: true });
    });

    // Change password
    fastify.post('/security/change-password', async (req, reply) => {
      const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
      if (!newPassword || newPassword.length < 8) {
        return reply.code(400).send({ success: false, error: { code: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters' } });
      }
      const bcrypt = (await import('bcryptjs')).default;
      const [user] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query('SELECT password_hash FROM users WHERE id = $1 AND tenant_id = $2', [req.user.sub, req.tenant.id]);
        return result.rows;
      });
      if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
        return reply.code(400).send({ success: false, error: { code: 'WRONG_PASSWORD', message: 'Current password is incorrect' } });
      }
      const hash = await bcrypt.hash(newPassword, 12);
      await db.withTenant(req.tenant.id, async (client) => {
        await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.sub]);
      });
      return reply.send({ success: true });
    });

    // PATCH /api/v1/settings/tenant — update arbitrary tenant settings flags (e.g. dismiss banners)
    fastify.patch('/tenant', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      for (const [key, value] of Object.entries(body)) {
        const jsonVal = JSON.stringify(value);
        await db.withSuperAdmin(async (client) => {
          await client.query(
            `UPDATE tenants SET settings = jsonb_set(COALESCE(settings,'{}'), $1, $2::jsonb) WHERE id = $3`,
            [`{${key}}`, jsonVal, req.tenant.id],
          );
        });
      }
      return reply.send({ success: true });
    });

    // GET /api/v1/settings/me/status — return current agent status
    fastify.get('/me/status', async (req, reply) => {
      const [row] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(`SELECT agent_status FROM users WHERE id = $1 AND tenant_id = $2`, [req.user.sub, req.tenant.id]);
        return r.rows;
      });
      return reply.send({ success: true, data: { status: row?.agent_status ?? 'offline' } });
    });

    // PATCH /api/v1/settings/me/status — agent sets their own presence status
    fastify.patch('/me/status', async (req, reply) => {
      const { status } = req.body as { status: string };
      const valid = ['online', 'away', 'busy', 'offline'];
      if (!valid.includes(status)) {
        return reply.code(400).send({ success: false, error: { code: 'INVALID_STATUS', message: `Status must be one of: ${valid.join(', ')}` } });
      }
      await db.withTenant(req.tenant.id, async (client) => {
        await client.query(
          `UPDATE users SET agent_status = $1, agent_status_updated_at = NOW() WHERE id = $2`,
          [status, req.user.sub],
        );
      });
      return reply.send({ success: true, data: { status } });
    });

    // GET /api/v1/settings/team/online — managers see who is online right now
    fastify.get('/team/online', { preHandler: requireRole('super_admin', 'tenant_admin', 'manager') }, async (req, reply) => {
      const members = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT u.id, u.name, u.email, u.role, u.department, u.agent_status, u.agent_status_updated_at,
                  r.name AS role_name, r.color AS role_color
           FROM users u
           LEFT JOIN roles r ON r.id = u.custom_role_id
           WHERE u.tenant_id = $1 AND u.role NOT IN ('super_admin','tenant_admin')
           ORDER BY
             CASE u.agent_status WHEN 'online' THEN 1 WHEN 'busy' THEN 2 WHEN 'away' THEN 3 ELSE 4 END,
             u.name ASC`,
          [req.tenant.id],
        );
        return result.rows;
      });
      return reply.send({ success: true, data: members });
    });
  };
}
