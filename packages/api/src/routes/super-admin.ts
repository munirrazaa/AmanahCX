import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient, TenantService } from '@crm/core';
import type { Plan } from '@crm/shared';
import { getSector } from '@crm/shared';
import { requireRole, requirePlatformPermission } from '../middlewares/auth.middleware';
import { defaultPermissions } from './roles';
import { ensureDefaultPipeline } from '../lib/default-pipeline';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

// The four standard roles auto-seeded into every new workspace. Their default
// permissions come from defaultPermissions(); the tenant admin tailors them later.
const SYSTEM_ROLES_SEED = [
  { base_role: 'tenant_admin', name: 'Admin',   color: '#dc2626' },
  { base_role: 'manager',      name: 'Manager', color: '#d97706' },
  { base_role: 'agent',        name: 'Agent',   color: '#2563eb' },
  { base_role: 'viewer',       name: 'Viewer',  color: '#6b7280' },
];

// Full module catalog — the SINGLE SOURCE OF TRUTH shared with the frontend.
//
// Each module lists its `features` (the functional areas inside it). At workspace
// creation the super admin allocates modules + the specific features agreed with the
// customer. To offer a NEW module in future, add it here with its features — it then
// flows automatically into the creation selection, with no other code changes.
export const MODULE_CATALOG = [
  { key: 'crm', label: 'Core CRM', always: true, included_in_plans: ['free','starter','professional','enterprise'],
    description: 'The core customer record: contacts, companies, deals and activities.',
    features: [
      { key: 'crm.contacts',   label: 'Contacts' },
      { key: 'crm.companies',  label: 'Companies' },
      { key: 'crm.deals',      label: 'Deals & Pipeline' },
      { key: 'crm.activities', label: 'Activities & Tasks' },
    ] },
  { key: 'ticketing', label: 'Ticketing & Support', always: false, included_in_plans: ['starter','professional','enterprise'],
    description: 'Multi-department helpdesk with SLA timers, queues, routing and CSAT.',
    features: [
      { key: 'ticketing.tickets',  label: 'Tickets & Queues' },
      { key: 'ticketing.sla',      label: 'SLA Policies' },
      { key: 'ticketing.csat',     label: 'CSAT Surveys' },
    ] },
  { key: 'voice_bot', label: 'Voice Bot', always: false, included_in_plans: ['professional','enterprise'],
    description: 'AI voice layer over SIP — connects Retell AI, Vapi or Bland.ai.',
    features: [
      { key: 'voice_bot.calls',    label: 'Inbound Calls & Transcripts' },
      { key: 'voice_bot.config',   label: 'Bot Configuration' },
      // Per-provider allocation — licensing the voice_bot module alone no longer
      // exposes every provider; each one must be individually granted so a tenant
      // only sees/uses the specific provider(s) they were actually given.
      { key: 'voice_bot.provider.livekit', label: 'Provider: Build-Your-Own (Nadia / LiveKit)' },
      { key: 'voice_bot.provider.vapi',    label: 'Provider: Vapi' },
      { key: 'voice_bot.provider.retell',  label: 'Provider: Retell AI' },
      { key: 'voice_bot.provider.bland',   label: 'Provider: Bland.ai' },
    ] },
  { key: 'sales', label: 'Sales & Invoicing', always: false, included_in_plans: ['professional','enterprise'],
    description: 'Quote-to-cash: invoicing, payments and sales reporting.',
    features: [
      { key: 'sales.invoices',  label: 'Invoices' },
      { key: 'sales.contacts',  label: 'Billing Contacts' },
      { key: 'sales.payments',  label: 'Payments' },
      { key: 'sales.reports',   label: 'Sales Reports' },
      { key: 'sales.templates', label: 'Invoice Templates' },
      { key: 'sales.settings',  label: 'Sales Settings' },
    ] },
  { key: 'emails', label: 'Email Inbox', always: false, included_in_plans: ['starter','professional','enterprise'],
    description: 'Shared team email inbox with assignment, threading and SLA tracking.',
    features: [
      { key: 'emails.inbox',   label: 'Shared Inbox' },
      { key: 'emails.compose', label: 'Compose & Reply' },
    ] },
  { key: 'integrations', label: 'Integrations', always: false, included_in_plans: ['professional','enterprise'],
    description: 'SMS gateways, webhooks, Zapier/Make connectors and third-party API bridges.',
    features: [
      { key: 'integrations.connectors', label: 'Connectors & Apps' },
      { key: 'integrations.webhooks',   label: 'Webhooks & API' },
    ] },
  { key: 'analytics', label: 'Advanced Analytics', always: false, included_in_plans: ['professional','enterprise'],
    description: 'Cross-module reports, heatmaps, funnels and department performance dashboards.',
    features: [
      { key: 'analytics.reports', label: 'Reports & Dashboards' },
      { key: 'analytics.export',  label: 'Data Export' },
    ] },
] as const;
export type ModuleKey = typeof MODULE_CATALOG[number]['key'];
export const ALL_MODULE_KEYS = MODULE_CATALOG.map(m => m.key) as ModuleKey[];
// Flat list of every valid feature key — used to validate entitlement payloads.
export const ALL_FEATURE_KEYS = MODULE_CATALOG.flatMap(m => m.features.map(f => f.key)) as string[];

const RolePayloadSchema = z.object({
  base_role:   z.string(),
  name:        z.string(),
  color:       z.string().optional(),
  permissions: z.record(z.boolean()),
});

const CreateTenantSchema = z.object({
  name:          z.string().min(2),
  slug:          z.string().min(2).regex(/^[a-z0-9-]+$/),
  plan:          z.enum(['free', 'starter', 'professional', 'enterprise']).default('starter'),
  adminEmail:    z.string().email(),
  adminName:     z.string().min(1),
  // Optional — if omitted a secure temporary password is generated and returned once.
  adminPassword: z.string().min(8).optional(),
  customDomain:  z.string().optional(),
  modules:       z.array(z.enum(ALL_MODULE_KEYS as [ModuleKey, ...ModuleKey[]])).default(['crm']),
  // The agreed feature-areas within the licensed modules (e.g. ['crm.contacts','sales.invoices']).
  entitledFeatures: z.array(z.string()).default([]),
  roles:         z.array(RolePayloadSchema).optional(),
  sector:        z.string().default('other'),
});

async function seedSectorFields(db: DatabaseClient, tenantId: string, sector: string) {
  const cfg = getSector(sector as any);
  const entityFieldMap = [
    { entity: 'contact', fields: cfg.fields ?? [] },
    { entity: 'company', fields: (cfg as any).companyFields ?? [] },
    { entity: 'deal',    fields: (cfg as any).dealFields    ?? [] },
    { entity: 'ticket',  fields: (cfg as any).ticketFields  ?? [] },
  ];
  await db.withSuperAdmin(async (client) => {
    for (const { entity, fields } of entityFieldMap) {
      for (const field of fields as any[]) {
        await client.query(
          `INSERT INTO custom_field_definitions
             (tenant_id, entity, name, label, field_type, options, is_required, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (tenant_id, entity, name) DO NOTHING`,
          [
            tenantId, entity,
            field.name, field.label, field.field_type,
            field.options ? JSON.stringify(field.options) : null,
            field.is_required ?? false, field.sort_order ?? 0,
          ],
        );
      }
    }
    // Also update the sector column
    await client.query('UPDATE tenants SET sector = $1 WHERE id = $2', [sector, tenantId]);
  });
}

// Generate a readable but strong temporary password e.g. "Wм-7Kp2q-Rt9x".
function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const block = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${block()}-${block()}-${block()}`;
}

// Platform-level system email — uses env-var SMTP or SendGrid config.
// Completely independent of tenant connectors; used for welcome / password-reset emails.
// Returns true if the email was dispatched, false if no system email is configured (non-fatal).
async function sendSystemEmail(opts: {
  to: string;
  toName: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
}): Promise<boolean> {
  const sg = process.env.SENDGRID_API_KEY;
  const sgFrom = process.env.SENDGRID_FROM_EMAIL;
  if (sg && sgFrom) {
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sg}` },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: opts.to, name: opts.toName }] }],
          from: { email: sgFrom, name: process.env.SENDGRID_FROM_NAME ?? 'Platform' },
          subject: opts.subject,
          content: [
            { type: 'text/plain', value: opts.bodyText },
            { type: 'text/html', value: opts.bodyHtml },
          ],
        }),
      });
      return res.ok || res.status === 202;
    } catch { return false; }
  }

  const smtpHost = process.env.SYSTEM_SMTP_HOST;
  const smtpUser = process.env.SYSTEM_SMTP_USER;
  const smtpPass = process.env.SYSTEM_SMTP_PASS;
  const smtpFrom = process.env.SYSTEM_SMTP_FROM ?? smtpUser ?? '';
  if (smtpHost && smtpUser && smtpPass) {
    try {
      const nodemailer = require('nodemailer');
      const port = parseInt(process.env.SYSTEM_SMTP_PORT ?? '587', 10);
      const transporter = nodemailer.createTransport({
        host: smtpHost, port, secure: port === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });
      await transporter.sendMail({
        from: process.env.SYSTEM_SMTP_FROM_NAME ? `"${process.env.SYSTEM_SMTP_FROM_NAME}" <${smtpFrom}>` : smtpFrom,
        to: `"${opts.toName}" <${opts.to}>`,
        subject: opts.subject,
        html: opts.bodyHtml,
        text: opts.bodyText,
      });
      return true;
    } catch { return false; }
  }

  return false; // no system email configured — caller shows password on screen instead
}

export function superAdminRoutes(db: DatabaseClient, tenantService: TenantService) {
  return async function (fastify: FastifyInstance) {
    // All super-admin routes require super_admin OR a delegated platform_admin
    // (Sub-Admin Roles) account. Base gate only checks the DB role column — the
    // per-route requirePlatformPermission() preHandlers below then narrow a
    // platform_admin to exactly what their assigned platform_roles matrix grants.
    // A true super_admin (no platformRoleId in their token) bypasses those checks.
    fastify.addHook('preHandler', requireRole('super_admin', 'platform_admin'));

    // List all tenants
    fastify.get('/tenants', { preHandler: requirePlatformPermission('tenants:view') }, async (req, reply) => {
      const QuerySchema = z.object({
        page:     z.coerce.number().int().min(1).default(1),
        // 500 (not 100) — several picker/filter dropdowns across Super Admin (Reports,
        // Alerts, Sub-Admins tenant filters) fetch the full tenant list with pageSize=200
        // to populate a <select>, not a paginated table; 100 broke them with a 400.
        pageSize: z.coerce.number().int().min(1).max(500).default(25),
        search:   z.string().max(100).optional(),
        plan:     z.enum(['free', 'starter', 'professional', 'enterprise']).optional(),
        status:   z.enum(['active', 'trial', 'suspended', 'cancelled']).optional(),
      });
      const q = QuerySchema.parse(req.query);
      const offset = (q.page - 1) * q.pageSize;

      // Build parameterised conditions — never interpolate user input into SQL
      const conditions: string[] = ['1=1'];
      const params: any[]        = [];

      if (q.search) {
        params.push(`%${q.search}%`);
        conditions.push(`(name ILIKE $${params.length} OR slug ILIKE $${params.length})`);
      }
      if (q.plan) {
        params.push(q.plan);
        conditions.push(`plan = $${params.length}`);
      }
      if (q.status) {
        params.push(q.status);
        conditions.push(`status = $${params.length}`);
      }
      const where = conditions.join(' AND ');

      const [{ count }] = await db.withSuperAdmin(async (client) => {
        const result = await client.query(
          `SELECT COUNT(*) FROM tenants WHERE ${where}`,
          params,
        );
        return result.rows;
      });

      const tenants = await db.withSuperAdmin(async (client) => {
        const result = await client.query(
          `SELECT t.*,
            (SELECT COUNT(*) FROM users WHERE tenant_id = t.id) as user_count,
            (SELECT COUNT(*) FROM contacts WHERE tenant_id = t.id) as contact_count,
            (SELECT COUNT(*) FROM deals WHERE tenant_id = t.id AND status = 'open') as open_deals
           FROM tenants t WHERE ${where.replace(/\bname\b/g, 't.name').replace(/\bslug\b/g, 't.slug').replace(/\bplan\b/g, 't.plan').replace(/\bstatus\b/g, 't.status')}
           ORDER BY t.created_at DESC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, q.pageSize, offset],
        );
        return result.rows;
      });

      return reply.send({
        success: true,
        data: tenants,
        meta: { total: parseInt(count), page: q.page, pageSize: q.pageSize },
      });
    });

    // Get tenant details + usage
    fastify.get('/tenants/:id', { preHandler: requirePlatformPermission('tenants:view') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const [tenant] = await db.withSuperAdmin(async (client) => {
        const result = await client.query('SELECT * FROM tenants WHERE id = $1', [id]);
        return result.rows;
      });
      if (!tenant) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Tenant not found' } });

      const usage = await db.withSuperAdmin(async (client) => {
        const result = await client.query(
          `SELECT metric, value, period FROM usage_metrics
           WHERE tenant_id = $1 AND period = $2`,
          [id, new Date().toISOString().slice(0, 7)],
        );
        return result.rows;
      });

      return reply.send({ success: true, data: { ...tenant, usage } });
    });

    // Full module catalog — so the frontend can render it without hard-coding
    fastify.get('/modules', { preHandler: requirePlatformPermission('tenants:view') }, async (_req, reply) => {
      return reply.send({ success: true, data: MODULE_CATALOG });
    });

    // Create tenant (when a new customer signs up)
    fastify.post('/tenants', { preHandler: requirePlatformPermission('tenants:create') }, async (req, reply) => {
      const body = CreateTenantSchema.parse(req.body);

      // Auto-provisioning: the sector picked for this tenant carries a recommended
      // module/feature set (packages/shared/src/config/sectors.ts). We seed the
      // tenant with those defaults so it's usable immediately, and simply union in
      // anything explicitly requested on top — the super admin can still adjust via
      // PATCH /tenants/:id/modules afterwards, this is just a sensible starting point.
      const sectorDefaults = getSector(body.sector);
      const requestedFeatures = Array.from(new Set([...sectorDefaults.defaultFeatures, ...body.entitledFeatures]));
      const requestedModules = Array.from(new Set([...sectorDefaults.defaultModules, ...body.modules]));

      // Validate & normalise the entitled features against the catalog, then derive
      // which top-level modules are licensed (a module is licensed if ≥1 of its
      // features was selected). 'crm' is always included.
      const entitledFeatures = requestedFeatures.filter((f) => ALL_FEATURE_KEYS.includes(f));
      const modulesFromFeatures = MODULE_CATALOG
        .filter((m) => m.features.some((f) => entitledFeatures.includes(f.key)))
        .map((m) => m.key as string);
      const licensedModules = Array.from(new Set(['crm', ...requestedModules, ...modulesFromFeatures]));

      const tenant = await tenantService.create({
        name: body.name,
        slug: body.slug,
        plan: body.plan as Plan,
        adminEmail: body.adminEmail,
        adminName: body.adminName,
      });

      await db.withSuperAdmin(async (client) => {
        await client.query(
          `UPDATE tenants SET active_modules = $1, entitled_features = $2 WHERE id = $3`,
          [licensedModules, JSON.stringify(entitledFeatures), tenant.id],
        );
        if (body.customDomain) {
          await client.query('UPDATE tenants SET custom_domain = $1 WHERE id = $2', [body.customDomain, tenant.id]);
        }
      });

      // Auto-seed the standard system roles with sensible default permissions.
      // The super admin only licenses modules/features — deciding who (Manager/Agent/
      // Viewer) may do what inside them is the tenant admin's job, done later in Roles.
      // If an explicit roles payload is supplied (legacy), it overrides the defaults.
      const rolesToSeed = body.roles?.length
        ? body.roles
        : SYSTEM_ROLES_SEED.map((r) => ({ ...r, permissions: defaultPermissions(r.base_role) }));
      await db.withSuperAdmin(async (client) => {
        for (const r of rolesToSeed) {
          await client.query(
            `INSERT INTO roles (tenant_id, name, color, is_system, base_role, permissions)
             VALUES ($1, $2, $3, true, $4, $5)
             ON CONFLICT (tenant_id, base_role) WHERE is_system = true
             DO UPDATE SET permissions = EXCLUDED.permissions, name = EXCLUDED.name`,
            [tenant.id, r.name, r.color ?? '#6366f1', r.base_role, JSON.stringify(r.permissions)],
          );
        }
      });

      // Seed a default sales pipeline so the Deals feature (and sales-ticket →
      // deal conversion) works from day one. Without this, convert-to-deal fails.
      await db.withSuperAdmin(async (client) => {
        await ensureDefaultPipeline(client, tenant.id);
      });

      // Seed sector-specific custom fields for all entity types
      await seedSectorFields(db, tenant.id, body.sector);

      // Provision the first tenant admin so the new customer can log in immediately.
      // If no password was supplied, generate a temporary one and return it once.
      const tempPassword = body.adminPassword ?? generateTempPassword();
      const bcrypt = (await import('bcryptjs')).default;
      const adminHash = await bcrypt.hash(tempPassword, 12);
      const [adminUser] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `INSERT INTO users (tenant_id, name, email, role, password_hash, is_active)
           VALUES ($1, $2, $3, 'tenant_admin', $4, true)
           RETURNING id, name, email, role`,
          [tenant.id, body.adminName, body.adminEmail, adminHash],
        );
        await client.query(
          `INSERT INTO super_admin_password_log (tenant_id, user_id, action, changed_by, notes)
           VALUES ($1, $2, 'created', $3, $4) ON CONFLICT DO NOTHING`,
          [tenant.id, r.rows[0]?.id, (req as any).user?.userId, 'Tenant admin created at workspace setup'],
        ).catch(() => {}); // log table optional
        return r.rows;
      });

      // Invalidate cache so the new active_modules are visible immediately
      await tenantService.invalidateCacheById(tenant.id);

      const [updated] = await db.withSuperAdmin(async (client) => {
        const r = await client.query('SELECT * FROM tenants WHERE id = $1', [tenant.id]);
        return r.rows;
      });

      // Email the temporary password to the new admin — non-blocking.
      const wasAutoGenerated = !body.adminPassword;
      let emailSent = false;
      if (wasAutoGenerated) {
        const loginUrl = `${process.env.APP_URL ?? 'http://localhost:5173'}/login`;
        emailSent = await sendSystemEmail({
          to: body.adminEmail,
          toName: body.adminName,
          subject: `Your ${body.name} workspace is ready`,
          bodyHtml: `
            <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9fafb;border-radius:12px;">
              <div style="text-align:center;margin-bottom:28px;">
                <div style="display:inline-block;background:linear-gradient(135deg,#29ABE2,#4D8B3C);border-radius:16px;padding:14px 18px;">
                  <span style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-1px;">Vivid CRM</span>
                </div>
              </div>
              <div style="background:#fff;border-radius:10px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
                <h2 style="margin:0 0 8px;color:#111827;font-size:22px;">Your workspace is ready 🎉</h2>
                <p style="color:#6b7280;margin:0 0 20px;line-height:1.6;">Hi ${body.adminName}, your <strong>${body.name}</strong> workspace has been set up on Vivid CRM. Here are your login details:</p>
                <table style="border-collapse:collapse;margin:0 0 24px;width:100%;">
                  <tr><td style="padding:6px 12px 6px 0;color:#6b7280;width:160px;">Workspace</td><td style="font-weight:600;color:#111827;">${body.name}</td></tr>
                  <tr><td style="padding:6px 12px 6px 0;color:#6b7280;">Email</td><td style="color:#111827;">${body.adminEmail}</td></tr>
                  <tr><td style="padding:6px 12px 6px 0;color:#6b7280;">Temporary Password</td><td><span style="font-family:monospace;font-size:1.05em;background:#fef3c7;padding:3px 10px;border-radius:4px;color:#92400e;">${tempPassword}</span></td></tr>
                </table>
                <div style="text-align:center;margin-bottom:24px;">
                  <a href="${loginUrl}" style="display:inline-block;background:linear-gradient(135deg,#29ABE2,#1a8cbf);color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 36px;border-radius:8px;box-shadow:0 4px 14px rgba(41,171,226,0.35);">
                    Log In to ${body.name}
                  </a>
                </div>
                <p style="color:#9ca3af;font-size:12px;margin:0;text-align:center;">Or visit: <a href="${loginUrl}" style="color:#29ABE2;">${loginUrl}</a></p>
                <p style="color:#ef4444;font-size:12px;margin:16px 0 0;text-align:center;">Please change your password immediately after logging in.</p>
              </div>
              <p style="text-align:center;color:#9ca3af;font-size:11px;margin-top:20px;">© ${new Date().getFullYear()} AmanahCX.</p>
            </div>
          `,
          bodyText: `Hi ${body.adminName},\n\nYour workspace "${body.name}" is ready.\n\nEmail: ${body.adminEmail}\nTemporary Password: ${tempPassword}\n\nLog in here: ${loginUrl}\n\nPlease change your password immediately after logging in.`,
        });
      }

      return reply.code(201).send({
        success: true,
        data: {
          ...updated,
          admin: adminUser,
          // Surface temp password in the response so the UI can show it once.
          // If email was sent, still include it (UI shows amber banner with both confirmations).
          tempPassword: wasAutoGenerated ? tempPassword : undefined,
          emailSent,
        },
      });
    });

    // Upgrade / downgrade plan
    fastify.patch('/tenants/:id/plan', { preHandler: requirePlatformPermission('plans:manage') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const { plan } = req.body as { plan: Plan };
      await tenantService.updatePlan(id, plan);
      return reply.send({ success: true, message: `Plan updated to ${plan}` });
    });

    // Update licensed modules for a tenant (super admin sets the ceiling)
    // e.g. PATCH /super-admin/tenants/:id/modules { "modules": ["crm","voice","ticketing"] }
    fastify.patch('/tenants/:id/modules', { preHandler: requirePlatformPermission('modules:manage') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({
        modules: z.array(z.string()).min(1),
      }).parse(req.body);

      // Always ensure 'crm' is included
      const licensedModules = Array.from(new Set(['crm', ...body.modules]));

      await db.withSuperAdmin(async (client) => {
        // Keep entitled_features in sync with the licensed modules — API
        // routes gate via requireEntitlement(feature), so licensing a module
        // without granting its features would show it in nav but 403 on use.
        // Rule: drop features of unlicensed modules; grant the FULL feature
        // set of any newly-licensed module. Legacy tenants with an empty
        // entitled_features list stay empty (middleware allows everything
        // for them, nothing to sync).
        const [cur] = (await client.query(
          `SELECT active_modules, entitled_features FROM tenants WHERE id = $1`, [id],
        )).rows;
        if (cur && Array.isArray(cur.entitled_features) && cur.entitled_features.length > 0) {
          const prevModules: string[] = cur.active_modules ?? [];
          const kept = (cur.entitled_features as string[]).filter((f) =>
            licensedModules.includes(f.split('.')[0]));
          const newlyLicensed = licensedModules.filter((m) => !prevModules.includes(m));
          const granted = MODULE_CATALOG
            .filter((m) => newlyLicensed.includes(m.key))
            .flatMap((m) => m.features.map((f) => f.key));
          const nextFeatures = Array.from(new Set([...kept, ...granted]));
          await client.query(
            `UPDATE tenants SET entitled_features = $1 WHERE id = $2`,
            [JSON.stringify(nextFeatures), id],
          );
        }

        // Update licensed modules
        await client.query(
          `UPDATE tenants SET active_modules = $1, updated_at = NOW() WHERE id = $2`,
          [licensedModules, id],
        );
        // Prune any now-unlicensed modules from the tenant admin's enabled_modules setting
        // so tenants can't retain access to modules that were revoked
        const [row] = (await client.query(`SELECT settings FROM tenants WHERE id = $1`, [id])).rows;
        const settings = row?.settings ?? {};
        if (settings.enabled_modules) {
          settings.enabled_modules = (settings.enabled_modules as string[]).filter(
            (m: string) => licensedModules.includes(m),
          );
          await client.query(
            `UPDATE tenants SET settings = $1 WHERE id = $2`,
            [JSON.stringify(settings), id],
          );
        }
      });

      // Invalidate tenant cache
      await tenantService.invalidateCacheById(id);
      return reply.send({ success: true, data: { licensedModules } });
    });

    // GET /super-admin/tenants/:id/roles — fetch this tenant's system role permissions
    fastify.get('/tenants/:id/roles', { preHandler: requirePlatformPermission('tenants:view') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT id, name, color, is_system, base_role, permissions
           FROM roles WHERE tenant_id = $1 AND is_system = true ORDER BY base_role`,
          [id],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // POST /super-admin/tenants/:id/roles — upsert system role permissions for a tenant
    fastify.post('/tenants/:id/roles', { preHandler: requirePlatformPermission('roles:manage') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const { roles } = z.object({ roles: z.array(RolePayloadSchema) }).parse(req.body);
      await db.withSuperAdmin(async (client) => {
        for (const r of roles) {
          await client.query(
            `INSERT INTO roles (tenant_id, name, color, is_system, base_role, permissions)
             VALUES ($1, $2, $3, true, $4, $5)
             ON CONFLICT (tenant_id, base_role) WHERE is_system = true
             DO UPDATE SET permissions = EXCLUDED.permissions, name = EXCLUDED.name`,
            [id, r.name, r.color ?? '#6366f1', r.base_role, JSON.stringify(r.permissions)],
          );
        }
      });
      return reply.send({ success: true });
    });

    // Suspend tenant
    fastify.post('/tenants/:id/suspend', { preHandler: requirePlatformPermission('tenants:suspend') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await tenantService.suspend(id);
      return reply.send({ success: true });
    });

    // Reactivate tenant
    fastify.post('/tenants/:id/activate', { preHandler: requirePlatformPermission('tenants:suspend') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withSuperAdmin(async (client) => {
        await client.query(`UPDATE tenants SET status = 'active', updated_at = NOW() WHERE id = $1`, [id]);
      });
      return reply.send({ success: true });
    });

    // Reset the tenant admin password — generates a new temp password, updates the user,
    // emails it to the admin, and returns it in the response for the super admin to relay.
    fastify.post('/tenants/:id/reset-admin-password', { preHandler: requirePlatformPermission('tenants:manage_users') }, async (req, reply) => {
      const { id } = req.params as { id: string };

      const [adminUser] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT id, name, email FROM users WHERE tenant_id = $1 AND role = 'tenant_admin' AND is_active = true ORDER BY created_at LIMIT 1`,
          [id],
        );
        return r.rows;
      });

      if (!adminUser) {
        return reply.status(404).send({ success: false, error: 'No active tenant admin found for this workspace' });
      }

      const newPassword = generateTempPassword();
      const bcrypt = (await import('bcryptjs')).default;
      const newHash = await bcrypt.hash(newPassword, 12);

      await db.withSuperAdmin(async (client) => {
        await client.query(
          `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
          [newHash, adminUser.id],
        );
        await client.query(
          `INSERT INTO super_admin_password_log (tenant_id, user_id, action, changed_by, notes)
           VALUES ($1, $2, 'reset', $3, $4) ON CONFLICT DO NOTHING`,
          [id, adminUser.id, (req as any).user?.userId, 'Password reset by super admin'],
        ).catch(() => {});
      });

      const emailSent = await sendSystemEmail({
        to: adminUser.email,
        toName: adminUser.name,
        subject: 'Your admin password has been reset',
        bodyHtml: `
          <p>Hi ${adminUser.name},</p>
          <p>Your admin password has been reset by the platform administrator. Please log in with the new temporary password below and change it immediately.</p>
          <p style="margin:16px 0;">
            <strong>New Temporary Password: </strong>
            <span style="font-family:monospace;font-size:1.1em;background:#fef3c7;padding:2px 8px;border-radius:4px;">${newPassword}</span>
          </p>
          <p>If you did not request this, contact your platform provider immediately.</p>
        `,
        bodyText: `Hi ${adminUser.name},\n\nYour admin password has been reset.\n\nNew Temporary Password: ${newPassword}\n\nPlease log in and change it immediately.`,
      });

      return reply.send({
        success: true,
        data: { tempPassword: newPassword, emailSent, adminEmail: adminUser.email },
      });
    });

    // ── Platform Roles (for sub-admins) ──────────────────────────────────────

    // GET /super-admin/platform-roles
    // ── Voice bot minutes — allocation, top-up, and cross-tenant usage overview ──

    fastify.get('/tenants/:id/voice-bot-usage', { preHandler: requirePlatformPermission('voice_bot:manage_tenants') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const usage = await db.withSuperAdmin(async (client) => {
        const quota = await client.query(`SELECT minutes_allocated, cost_per_minute FROM voice_bot_quotas WHERE tenant_id = $1`, [id]);
        const consumed = await client.query(
          `SELECT COALESCE(SUM(duration_seconds), 0) AS total_seconds, COUNT(*) AS call_count FROM voice_bot_calls WHERE tenant_id = $1`,
          [id],
        );
        const topups = await client.query(
          `SELECT t.id, t.minutes_added, t.note, t.created_at, u.name AS created_by_name
             FROM voice_bot_minute_topups t LEFT JOIN users u ON u.id = t.created_by
            WHERE t.tenant_id = $1 ORDER BY t.created_at DESC LIMIT 20`,
          [id],
        );
        return { quota: quota.rows[0], consumed: consumed.rows[0], topups: topups.rows };
      });
      const allocated = Number(usage.quota?.minutes_allocated ?? 0);
      const costPerMinute = Number(usage.quota?.cost_per_minute ?? 0);
      const consumedMinutes = Number(usage.consumed.total_seconds) / 60;
      return reply.send({
        success: true,
        data: {
          allocatedMinutes: allocated,
          consumedMinutes: Number(consumedMinutes.toFixed(2)),
          remainingMinutes: Number((allocated - consumedMinutes).toFixed(2)),
          callCount: Number(usage.consumed.call_count),
          costPerMinute,
          totalCost: Number((consumedMinutes * costPerMinute).toFixed(2)),
          topups: usage.topups,
        },
      });
    });

    // PATCH /super-admin/tenants/:id/voice-bot-cost-rate — set what this tenant's
    // voice bot minutes cost (per minute), for the monthly cost report below.
    fastify.patch('/tenants/:id/voice-bot-cost-rate', { preHandler: requirePlatformPermission('voice_bot:manage_tenants') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const { costPerMinute } = z.object({ costPerMinute: z.number().min(0) }).parse(req.body);
      await db.withSuperAdmin(async (client) => {
        await client.query(
          `INSERT INTO voice_bot_quotas (tenant_id, cost_per_minute)
           VALUES ($1, $2)
           ON CONFLICT (tenant_id) DO UPDATE SET cost_per_minute = EXCLUDED.cost_per_minute, updated_at = NOW()`,
          [id, costPerMinute],
        );
      });
      return reply.send({ success: true, data: { costPerMinute } });
    });

    // GET /super-admin/voice-bot/cost-report?month=YYYY-MM — cross-tenant monthly
    // cost report. Cost is always computed live from call duration * rate (same
    // "never store a running total" approach migration 059 uses for minutes) —
    // so this reflects the CURRENT rate even for past months; rate changes are
    // not retroactively versioned. Defaults to the current month.
    fastify.get('/voice-bot/cost-report', { preHandler: requirePlatformPermission('voice_bot:manage_tenants') }, async (req, reply) => {
      const { month } = req.query as { month?: string };
      const period = month && /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
      const [start, end] = [`${period}-01`, `${period}-01`];

      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT t.id AS tenant_id, t.name AS tenant_name,
                  COALESCE(q.cost_per_minute, 0) AS cost_per_minute,
                  COALESCE(SUM(c.duration_seconds), 0) AS total_seconds,
                  COUNT(c.id) AS call_count
             FROM tenants t
             LEFT JOIN voice_bot_quotas q ON q.tenant_id = t.id
             LEFT JOIN voice_bot_calls c
               ON c.tenant_id = t.id
              AND c.created_at >= $1::date
              AND c.created_at <  ($1::date + INTERVAL '1 month')
            WHERE t.active_modules @> ARRAY['voice_bot']
            GROUP BY t.id, t.name, q.cost_per_minute
            ORDER BY total_seconds DESC`,
          [start],
        );
        return r.rows;
      });

      const data = rows.map((row: any) => {
        const minutes = Number(row.total_seconds) / 60;
        const costPerMinute = Number(row.cost_per_minute);
        return {
          tenantId: row.tenant_id,
          tenantName: row.tenant_name,
          minutesUsed: Number(minutes.toFixed(2)),
          callCount: Number(row.call_count),
          costPerMinute,
          totalCost: Number((minutes * costPerMinute).toFixed(2)),
        };
      });

      return reply.send({
        success: true,
        data: {
          period,
          tenants: data,
          totalCostAllTenants: Number(data.reduce((sum: number, r: any) => sum + r.totalCost, 0).toFixed(2)),
        },
      });
    });

    fastify.post('/tenants/:id/voice-bot-minutes', { preHandler: requirePlatformPermission('voice_bot:manage_tenants') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({
        minutesToAdd: z.number().positive(),
        note: z.string().optional(),
      }).parse(req.body);

      const [quota] = await db.withSuperAdmin(async (client) => {
        await client.query(
          `INSERT INTO voice_bot_minute_topups (tenant_id, minutes_added, note, created_by)
           VALUES ($1, $2, $3, $4)`,
          [id, body.minutesToAdd, body.note ?? null, req.user.sub],
        );
        const r = await client.query(
          `INSERT INTO voice_bot_quotas (tenant_id, minutes_allocated)
           VALUES ($1, $2)
           ON CONFLICT (tenant_id) DO UPDATE SET
             minutes_allocated = voice_bot_quotas.minutes_allocated + EXCLUDED.minutes_allocated,
             -- A top-up starts a fresh allocation cycle — let the 70/90/100%
             -- notifications fire again rather than staying silenced forever.
             notified_70  = false,
             notified_90  = false,
             notified_100 = false,
             updated_at = NOW()
           RETURNING *`,
          [id, body.minutesToAdd],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: quota });
    });

    // ── Centralized config ownership (Phase 1 of the shared hold/push model) ──
    // "super_admin" = Super Admin (or a delegated sub-admin) configures this
    // area directly; the tenant admin's own screen for it becomes read-only.
    // "tenant_admin" = works as it always has — the tenant configures it
    // themselves. Defaults to tenant_admin for any tenant that's never had
    // this set, so nothing existing changes behaviour silently.
    fastify.patch('/tenants/:id/voice-bot-ownership', { preHandler: requirePlatformPermission('voice_bot:manage_tenants') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({ ownership: z.enum(['super_admin', 'tenant_admin']) }).parse(req.body);
      await db.withSuperAdmin(async (client) => {
        await client.query(
          `UPDATE tenants SET settings = jsonb_set(COALESCE(settings,'{}'), '{voice_bot_ownership}', to_jsonb($1::text)) WHERE id = $2`,
          [body.ownership, id],
        );
      });
      // The tenant object (incl. settings) is Redis-cached for 5 minutes by
      // TenantService — without this, the lock wouldn't take effect until
      // that TTL expired, even though the DB row is already correct.
      await tenantService.invalidateCache(id);
      return reply.send({ success: true });
    });

    // Super Admin's own view/edit of a specific tenant's Nadia (self-hosted)
    // config — only meaningful once that tenant is set to "super_admin"
    // ownership above, but not itself gated on that (a super admin should
    // always be able to look, even before locking it).
    fastify.get('/tenants/:id/voice-bot-config', { preHandler: requirePlatformPermission('voice_bot:manage_tenants') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const [cfg] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT * FROM voice_bot_configs WHERE tenant_id = $1 AND provider = 'livekit'`,
          [id],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: cfg ?? null });
    });

    const SuperAdminVoiceBotConfigSchema = z.object({
      botName:              z.string().min(1).max(60).optional(),
      greetingMessage:      z.string().optional(),
      systemPrompt:         z.string().optional(),
      tone:                 z.enum(['professional', 'friendly', 'empathetic', 'formal']).optional(),
      speakingRate:         z.coerce.number().min(0.5).max(2.0).optional(),
      voiceId:              z.string().optional(),
      language:             z.string().optional(),
      guardrails:           z.string().max(4000).optional(),
      isActive:             z.boolean().optional(),
      recordingEnabled:     z.boolean().optional(),
      selfServiceIntents:   z.array(z.string()).optional(),
      sipTrunkProvider:     z.string().optional(),
      sipTrunkNumber:       z.string().optional(),
      sipUri:               z.string().optional(),
      sipTrunkUsername:     z.string().optional(),
      sipTrunkPassword:     z.string().optional(),
      sipTrunkNickname:     z.string().optional(),
      outboundTransport:    z.enum(['TCP', 'UDP']).optional(),
      maxConcurrentCalls:   z.coerce.number().int().positive().optional(),
      humanTransferDestination: z.string().optional(),
    });

    fastify.put('/tenants/:id/voice-bot-config', { preHandler: requirePlatformPermission('voice_bot:manage_tenants') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = SuperAdminVoiceBotConfigSchema.parse(req.body);
      const [cfg] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `INSERT INTO voice_bot_configs
             (tenant_id, provider, bot_name, greeting_message, system_prompt, tone, speaking_rate, voice_id,
              language, guardrails, is_active, recording_enabled, self_service_intents,
              sip_trunk_provider, sip_trunk_number, sip_uri, sip_trunk_username, sip_trunk_password,
              sip_trunk_nickname, outbound_transport, max_concurrent_calls, human_transfer_destination)
           VALUES ($1,'livekit',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
           ON CONFLICT (tenant_id, provider) DO UPDATE SET
             bot_name            = COALESCE(EXCLUDED.bot_name, voice_bot_configs.bot_name),
             greeting_message    = COALESCE(EXCLUDED.greeting_message, voice_bot_configs.greeting_message),
             system_prompt       = COALESCE(EXCLUDED.system_prompt, voice_bot_configs.system_prompt),
             tone                = COALESCE(EXCLUDED.tone, voice_bot_configs.tone),
             speaking_rate       = COALESCE(EXCLUDED.speaking_rate, voice_bot_configs.speaking_rate),
             voice_id            = COALESCE(EXCLUDED.voice_id, voice_bot_configs.voice_id),
             language            = COALESCE(EXCLUDED.language, voice_bot_configs.language),
             guardrails          = COALESCE(EXCLUDED.guardrails, voice_bot_configs.guardrails),
             is_active           = COALESCE(EXCLUDED.is_active, voice_bot_configs.is_active),
             recording_enabled   = COALESCE(EXCLUDED.recording_enabled, voice_bot_configs.recording_enabled),
             self_service_intents = COALESCE(EXCLUDED.self_service_intents, voice_bot_configs.self_service_intents),
             sip_trunk_provider  = COALESCE(EXCLUDED.sip_trunk_provider, voice_bot_configs.sip_trunk_provider),
             sip_trunk_number    = COALESCE(EXCLUDED.sip_trunk_number, voice_bot_configs.sip_trunk_number),
             sip_uri             = COALESCE(EXCLUDED.sip_uri, voice_bot_configs.sip_uri),
             sip_trunk_username  = COALESCE(EXCLUDED.sip_trunk_username, voice_bot_configs.sip_trunk_username),
             sip_trunk_password  = COALESCE(EXCLUDED.sip_trunk_password, voice_bot_configs.sip_trunk_password),
             sip_trunk_nickname  = COALESCE(EXCLUDED.sip_trunk_nickname, voice_bot_configs.sip_trunk_nickname),
             outbound_transport  = COALESCE(EXCLUDED.outbound_transport, voice_bot_configs.outbound_transport),
             max_concurrent_calls = COALESCE(EXCLUDED.max_concurrent_calls, voice_bot_configs.max_concurrent_calls),
             human_transfer_destination = COALESCE(EXCLUDED.human_transfer_destination, voice_bot_configs.human_transfer_destination),
             updated_at          = NOW()
           RETURNING *`,
          [id, body.botName ?? 'Nadia', body.greetingMessage ?? null, body.systemPrompt ?? null,
           body.tone ?? 'professional', body.speakingRate ?? 0.9, body.voiceId ?? 'helpdesk-agent',
           body.language ?? 'ur-PK', body.guardrails ?? null, body.isActive ?? true,
           body.recordingEnabled ?? false, body.selfServiceIntents ?? [],
           body.sipTrunkProvider ?? null, body.sipTrunkNumber ?? null, body.sipUri ?? null,
           body.sipTrunkUsername ?? null, body.sipTrunkPassword ?? null, body.sipTrunkNickname ?? null,
           body.outboundTransport ?? 'TCP', body.maxConcurrentCalls ?? null,
           body.humanTransferDestination ?? null],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: cfg });
    });

    // Shared voice catalog (same table the tenant-side page reads) — Super
    // Admin can't call the tenant-scoped /api/v1/voice-bot/voices route
    // (blocked entirely from workspace data), so this is its own copy.
    fastify.get('/voice-bot-voices', { preHandler: requirePlatformPermission('voice_bot:manage_agents') }, async (_req, reply) => {
      const voices = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `SELECT id, provider, voice_id, label, description FROM voice_bot_voices WHERE is_active = true ORDER BY created_at ASC`,
        );
        return r.rows;
      });
      return reply.send({ success: true, data: voices });
    });

    // ── Voice Bot Agent Templates (Agent Builder, Phase 1) ──────────────
    // Reusable agent "recipes" a Super Admin creates once and assigns to
    // any number of workspaces — not configured per-tenant from scratch
    // every time. Assigning is a one-time copy into that tenant's own
    // voice_bot_configs row, not a live binding, so it stays editable
    // afterward per the user's explicit requirement.
    const AgentTemplateSchema = z.object({
      name:             z.string().min(1).max(120),
      sector:           z.string().optional(),
      description:      z.string().optional(),
      companyName:      z.string().optional(),
      department:       z.string().optional(),
      botEngine:        z.string().default('nadia'),
      voiceId:          z.string().optional(),
      tone:             z.enum(['professional', 'friendly', 'empathetic', 'formal']).default('professional'),
      character:        z.enum(['professional', 'chirpy', 'funny', 'cordial', 'empathetic', 'formal']).default('professional'),
      language:         z.string().default('ur-PK'),
      callDirection:    z.enum(['inbound', 'outbound', 'both']).default('inbound'),
      guardrails:       z.string().optional(),
      systemPrompt:     z.string().optional(),
      greetingMessage:  z.string().optional(),
    });

    fastify.get('/agent-templates', { preHandler: requirePlatformPermission('voice_bot:manage_agents') }, async (_req, reply) => {
      const templates = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `SELECT t.*,
                  (SELECT COUNT(*) FROM voice_bot_configs vc WHERE vc.source_template_id = t.id) AS assigned_count
             FROM voice_bot_agent_templates t
            ORDER BY t.updated_at DESC`,
        );
        return r.rows;
      });
      return reply.send({ success: true, data: templates });
    });

    fastify.get('/agent-templates/:id', { preHandler: requirePlatformPermission('voice_bot:manage_agents') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const [template] = await db.withSuperAdmin(async (c) =>
        (await c.query(`SELECT * FROM voice_bot_agent_templates WHERE id = $1`, [id])).rows);
      if (!template) return reply.code(404).send({ error: 'not_found' });
      const assignedTenants = await db.withSuperAdmin(async (c) =>
        (await c.query(
          `SELECT t.id, t.name FROM tenants t
             JOIN voice_bot_configs vc ON vc.tenant_id = t.id
            WHERE vc.source_template_id = $1`,
          [id],
        )).rows);
      return reply.send({ success: true, data: template, assignedTenants });
    });

    fastify.post('/agent-templates', { preHandler: requirePlatformPermission('voice_bot:manage_agents') }, async (req, reply) => {
      const body = AgentTemplateSchema.parse(req.body);
      const userId = (req as any).user?.id ?? null;
      const [created] = await db.withSuperAdmin(async (c) =>
        (await c.query(
          `INSERT INTO voice_bot_agent_templates
             (name, sector, description, company_name, department, bot_engine, voice_id,
              tone, character, language, call_direction, guardrails, system_prompt, greeting_message, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           RETURNING *`,
          [body.name, body.sector ?? null, body.description ?? null, body.companyName ?? null,
           body.department ?? null, body.botEngine, body.voiceId ?? null, body.tone, body.character,
           body.language, body.callDirection, body.guardrails ?? null, body.systemPrompt ?? null,
           body.greetingMessage ?? null, userId],
        )).rows);
      return reply.code(201).send({ success: true, data: created });
    });

    fastify.put('/agent-templates/:id', { preHandler: requirePlatformPermission('voice_bot:manage_agents') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = AgentTemplateSchema.partial().parse(req.body);
      const [updated] = await db.withSuperAdmin(async (c) =>
        (await c.query(
          `UPDATE voice_bot_agent_templates SET
             name             = COALESCE($2, name),
             sector           = COALESCE($3, sector),
             description      = COALESCE($4, description),
             company_name     = COALESCE($5, company_name),
             department       = COALESCE($6, department),
             bot_engine       = COALESCE($7, bot_engine),
             voice_id         = COALESCE($8, voice_id),
             tone             = COALESCE($9, tone),
             character        = COALESCE($10, character),
             language         = COALESCE($11, language),
             call_direction   = COALESCE($12, call_direction),
             guardrails       = COALESCE($13, guardrails),
             system_prompt    = COALESCE($14, system_prompt),
             greeting_message = COALESCE($15, greeting_message),
             updated_at       = NOW()
           WHERE id = $1
           RETURNING *`,
          [id, body.name ?? null, body.sector ?? null, body.description ?? null, body.companyName ?? null,
           body.department ?? null, body.botEngine ?? null, body.voiceId ?? null, body.tone ?? null,
           body.character ?? null, body.language ?? null, body.callDirection ?? null,
           body.guardrails ?? null, body.systemPrompt ?? null, body.greetingMessage ?? null],
        )).rows);
      if (!updated) return reply.code(404).send({ error: 'not_found' });
      return reply.send({ success: true, data: updated });
    });

    fastify.delete('/agent-templates/:id', { preHandler: requirePlatformPermission('voice_bot:manage_agents') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withSuperAdmin(async (c) => {
        await c.query(`DELETE FROM voice_bot_agent_templates WHERE id = $1`, [id]);
      });
      return reply.send({ success: true });
    });

    // Assign a template to a workspace — one-time copy into that tenant's
    // voice_bot_configs row (provider='livekit'), same table Nadia already
    // reads at call time, so nothing about the runtime path changes.
    fastify.post('/agent-templates/:id/assign', { preHandler: requirePlatformPermission('voice_bot:manage_agents') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const { tenantId } = req.body as { tenantId?: string };
      if (!tenantId) return reply.code(400).send({ error: 'tenantId required' });

      const [template] = await db.withSuperAdmin(async (c) =>
        (await c.query(`SELECT * FROM voice_bot_agent_templates WHERE id = $1`, [id])).rows);
      if (!template) return reply.code(404).send({ error: 'template_not_found' });

      // Assigning an agent template is, itself, the decision to give this
      // tenant a working voice bot — so if they weren't already licensed
      // for the Voice Bot module, grant it (and its Nadia/LiveKit provider
      // feature) as part of the same action, rather than silently leaving
      // a bot configured that the tenant isn't actually licensed to use.
      let moduleGranted = false;
      await db.withSuperAdmin(async (c) => {
        const [cur] = (await c.query(
          `SELECT active_modules, entitled_features FROM tenants WHERE id = $1`, [tenantId],
        )).rows;
        const activeModules: string[] = cur?.active_modules ?? [];
        if (!activeModules.includes('voice_bot')) {
          moduleGranted = true;
          const entitledFeatures: string[] = Array.isArray(cur?.entitled_features) ? cur.entitled_features : [];
          const nextFeatures = entitledFeatures.length > 0
            ? Array.from(new Set([...entitledFeatures, 'voice_bot.calls', 'voice_bot.config', 'voice_bot.provider.livekit']))
            : entitledFeatures; // legacy tenants with an empty list stay empty — middleware allows everything for them
          await c.query(
            `UPDATE tenants SET active_modules = array_append(active_modules, 'voice_bot'),
                                 entitled_features = $1, updated_at = NOW()
             WHERE id = $2`,
            [JSON.stringify(nextFeatures), tenantId],
          );
        }
      });
      if (moduleGranted) await tenantService.invalidateCache(tenantId);

      const [cfg] = await db.withSuperAdmin(async (c) =>
        (await c.query(
          `INSERT INTO voice_bot_configs
             (tenant_id, provider, bot_name, greeting_message, system_prompt, tone, voice_id,
              language, guardrails, source_template_id)
           VALUES ($1,'livekit',$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (tenant_id, provider) DO UPDATE SET
             bot_name            = EXCLUDED.bot_name,
             greeting_message    = COALESCE(EXCLUDED.greeting_message, voice_bot_configs.greeting_message),
             system_prompt       = COALESCE(EXCLUDED.system_prompt, voice_bot_configs.system_prompt),
             tone                = EXCLUDED.tone,
             voice_id            = COALESCE(EXCLUDED.voice_id, voice_bot_configs.voice_id),
             language            = EXCLUDED.language,
             guardrails          = COALESCE(EXCLUDED.guardrails, voice_bot_configs.guardrails),
             source_template_id  = EXCLUDED.source_template_id,
             updated_at          = NOW()
           RETURNING *`,
          [tenantId, template.company_name || template.name, template.greeting_message,
           template.system_prompt, template.tone, template.voice_id, template.language,
           template.guardrails, id],
        )).rows);
      return reply.send({ success: true, data: cfg, moduleGranted });
    });

    // Knowledge base — same table as the tenant-side page, scoped by an
    // explicit :id param instead of req.tenant.id. Phase 2: full parity
    // with the tenant-side page — text, URL import (crawl + strip to
    // plain text), and file upload (PDF/DOCX, text extracted at upload
    // time) — same extraction logic, just targeting an explicit tenant.
    fastify.get('/tenants/:id/voice-bot-knowledge-base', { preHandler: requirePlatformPermission('voice_bot:manage_knowledge_base') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const entries = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `SELECT id, title, content, keywords, source_type, source_url, source_filename, is_active, created_at
             FROM voice_bot_knowledge_entries WHERE tenant_id = $1 ORDER BY created_at DESC`,
          [id],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: entries });
    });

    fastify.post('/tenants/:id/voice-bot-knowledge-base', { preHandler: requirePlatformPermission('voice_bot:manage_knowledge_base') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({
        title:    z.string().min(1).max(120),
        content:  z.string().min(1).max(5000),
        keywords: z.array(z.string().min(1)).min(1).max(20),
      }).parse(req.body);
      const [entry] = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `INSERT INTO voice_bot_knowledge_entries (tenant_id, title, content, keywords, source_type)
           VALUES ($1, $2, $3, $4, 'text') RETURNING *`,
          [id, body.title, body.content, body.keywords.map(k => k.toLowerCase())],
        );
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: entry });
    });

    // Import from a URL: fetch the page, strip HTML to plain text — same
    // extraction logic as the tenant-side route, targeting an explicit tenant.
    fastify.post('/tenants/:id/voice-bot-knowledge-base/import-url', { preHandler: requirePlatformPermission('voice_bot:manage_knowledge_base') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({
        title:    z.string().min(1).max(120),
        url:      z.string().url(),
        keywords: z.array(z.string().min(1)).min(1).max(20),
      }).parse(req.body);

      let text: string;
      try {
        const res = await fetch(body.url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return reply.code(400).send({ success: false, error: `Could not fetch that URL (HTTP ${res.status})` });
        const html = await res.text();
        text = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 5000);
      } catch (err: any) {
        return reply.code(400).send({ success: false, error: `Could not fetch that URL: ${err.message}` });
      }
      if (!text) return reply.code(400).send({ success: false, error: 'No readable text found at that URL' });

      const [entry] = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `INSERT INTO voice_bot_knowledge_entries
             (tenant_id, title, content, keywords, source_type, source_url)
           VALUES ($1, $2, $3, $4, 'url', $5)
           RETURNING *`,
          [id, body.title, text, body.keywords.map(k => k.toLowerCase()), body.url],
        );
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: entry });
    });

    // Upload a PDF or DOCX: extract its text — same extraction logic as
    // the tenant-side route, targeting an explicit tenant.
    fastify.post('/tenants/:id/voice-bot-knowledge-base/upload', { preHandler: requirePlatformPermission('voice_bot:manage_knowledge_base') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const parts = req.parts();
      let fileBuffer: Buffer | null = null;
      let filename = '';
      let mimetype = '';
      let title = '';
      let keywordsRaw = '';
      for await (const part of parts) {
        if (part.type === 'file') {
          fileBuffer = await part.toBuffer();
          filename = part.filename;
          mimetype = part.mimetype;
        } else if (part.fieldname === 'title') {
          title = String(part.value);
        } else if (part.fieldname === 'keywords') {
          keywordsRaw = String(part.value);
        }
      }
      if (!fileBuffer) return reply.code(400).send({ success: false, error: 'No file uploaded' });
      if (!title.trim()) return reply.code(400).send({ success: false, error: 'Title is required' });
      const keywords = keywordsRaw.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
      if (keywords.length === 0) return reply.code(400).send({ success: false, error: 'At least one keyword is required' });

      let text: string;
      try {
        if (mimetype === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
          text = (await pdfParse(fileBuffer)).text;
        } else if (
          mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          || filename.toLowerCase().endsWith('.docx')
        ) {
          text = (await mammoth.extractRawText({ buffer: fileBuffer })).value;
        } else {
          return reply.code(400).send({ success: false, error: 'Only PDF or DOCX files are supported' });
        }
      } catch (err: any) {
        return reply.code(400).send({ success: false, error: `Could not read that file: ${err.message}` });
      }
      text = text.replace(/\s+/g, ' ').trim().slice(0, 5000);
      if (!text) return reply.code(400).send({ success: false, error: 'No readable text found in that file' });

      const [entry] = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `INSERT INTO voice_bot_knowledge_entries
             (tenant_id, title, content, keywords, source_type, source_filename)
           VALUES ($1, $2, $3, $4, 'file', $5)
           RETURNING *`,
          [id, title, text, keywords, filename],
        );
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: entry });
    });

    fastify.put('/tenants/:id/voice-bot-knowledge-base/:entryId', { preHandler: requirePlatformPermission('voice_bot:manage_knowledge_base') }, async (req, reply) => {
      const { id, entryId } = req.params as { id: string; entryId: string };
      const body = z.object({ isActive: z.boolean() }).parse(req.body);
      await db.withSuperAdmin(async (c) => {
        await c.query(`UPDATE voice_bot_knowledge_entries SET is_active = $1 WHERE id = $2 AND tenant_id = $3`, [body.isActive, entryId, id]);
      });
      return reply.send({ success: true });
    });

    fastify.delete('/tenants/:id/voice-bot-knowledge-base/:entryId', { preHandler: requirePlatformPermission('voice_bot:manage_knowledge_base') }, async (req, reply) => {
      const { id, entryId } = req.params as { id: string; entryId: string };
      await db.withSuperAdmin(async (c) => {
        await c.query(`DELETE FROM voice_bot_knowledge_entries WHERE id = $1 AND tenant_id = $2`, [entryId, id]);
      });
      return reply.send({ success: true });
    });

    // ── Integrations ownership (Phase 1) ─────────────────────────────────────
    // Same hold/push idea, applied to the three top-level Integrations tabs.
    fastify.patch('/tenants/:id/integration-ownership', { preHandler: requirePlatformPermission('integrations:manage') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({
        connectors: z.enum(['super_admin', 'tenant_admin']).optional(),
        webhooks:   z.enum(['super_admin', 'tenant_admin']).optional(),
        api_keys:   z.enum(['super_admin', 'tenant_admin']).optional(),
      }).parse(req.body);

      await db.withSuperAdmin(async (client) => {
        const [cur] = (await client.query(`SELECT settings FROM tenants WHERE id = $1`, [id])).rows;
        const existing = cur?.settings?.integration_ownership ?? {};
        const merged = { ...existing, ...body };
        await client.query(
          `UPDATE tenants SET settings = jsonb_set(COALESCE(settings,'{}'), '{integration_ownership}', $1::jsonb) WHERE id = $2`,
          [JSON.stringify(merged), id],
        );
      });
      await tenantService.invalidateCache(id);
      return reply.send({ success: true });
    });

    // PATCH /super-admin/tenants/:id/sms-gateway — grant/revoke access to AmanahCX's own
    // shared SMS gateway. Stored the same way a tenant's own connector would be
    // (tenants.settings.connectors.platform_sms), so SmsService.getConnectorConfig() only
    // needs one lookup path — see packages/core/src/sms.service.ts.
    fastify.patch('/tenants/:id/sms-gateway', { preHandler: requirePlatformPermission('integrations:manage') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);

      await db.withSuperAdmin(async (client) => {
        // jsonb_set does NOT create missing intermediate objects — a bare
        // '{connectors,platform_sms}' path silently no-ops when settings.connectors
        // doesn't already exist. Ensure the parent object exists first, then merge.
        await client.query(
          `UPDATE tenants SET settings = jsonb_set(
             COALESCE(settings,'{}'),
             '{connectors}',
             COALESCE(settings->'connectors','{}'::jsonb) || jsonb_build_object('platform_sms', $1::jsonb)
           ) WHERE id = $2`,
          [JSON.stringify({ enabled }), id],
        );
      });
      await tenantService.invalidateCache(id);
      return reply.send({ success: true, data: { enabled } });
    });

    // All-tenants overview (allocated vs consumed) for the super admin dashboard
    // Platform-level alerts (currently: Voice Bot 70/90/100% threshold
    // crossings) — Super Admin's own notification feed, separate from the
    // tenant-scoped `notifications` table since Super Admin has no tenant.
    fastify.get('/alerts', { preHandler: requirePlatformPermission('alerts:manage') }, async (req, reply) => {
      const { unreadOnly } = req.query as { unreadOnly?: string };
      const alerts = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT n.id, n.type, n.title, n.body, n.is_read, n.created_at, t.name AS tenant_name
             FROM platform_notifications n
             LEFT JOIN tenants t ON t.id = n.tenant_id
            ${unreadOnly === 'true' ? 'WHERE n.is_read = false' : ''}
            ORDER BY n.created_at DESC LIMIT 100`,
        );
        return r.rows;
      });
      return reply.send({ success: true, data: alerts });
    });

    fastify.patch('/alerts/:id/read', { preHandler: requirePlatformPermission('alerts:manage') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withSuperAdmin(async (client) => {
        await client.query(`UPDATE platform_notifications SET is_read = true WHERE id = $1`, [id]);
      });
      return reply.send({ success: true });
    });

    fastify.get('/voice-bot-usage', { preHandler: requirePlatformPermission('voice_bot:manage_tenants') }, async (_req, reply) => {
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT t.id AS tenant_id, t.name AS tenant_name,
                  COALESCE(q.minutes_allocated, 0) AS allocated_minutes,
                  COALESCE(SUM(vbc.duration_seconds), 0) / 60.0 AS consumed_minutes,
                  COUNT(vbc.id) AS call_count
             FROM tenants t
             LEFT JOIN voice_bot_quotas q ON q.tenant_id = t.id
             LEFT JOIN voice_bot_calls vbc ON vbc.tenant_id = t.id
            WHERE t.status != 'deleted'
            GROUP BY t.id, t.name, q.minutes_allocated
            ORDER BY consumed_minutes DESC`,
        );
        return r.rows;
      });
      return reply.send({
        success: true,
        data: rows.map((r: any) => ({
          tenantId: r.tenant_id,
          tenantName: r.tenant_name,
          allocatedMinutes: Number(r.allocated_minutes),
          consumedMinutes: Number(Number(r.consumed_minutes).toFixed(2)),
          remainingMinutes: Number((Number(r.allocated_minutes) - Number(r.consumed_minutes)).toFixed(2)),
          callCount: Number(r.call_count),
        })),
      });
    });

    fastify.get('/platform-roles', { preHandler: requirePlatformPermission('roles:manage') }, async (_req, reply) => {
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT id, name, description, color, permissions, created_at FROM platform_roles ORDER BY created_at`,
        );
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // POST /super-admin/platform-roles
    fastify.post('/platform-roles', { preHandler: requirePlatformPermission('roles:manage') }, async (req, reply) => {
      const { name, description, color, permissions } = z.object({
        name:        z.string().min(1),
        description: z.string().optional(),
        color:       z.string().optional(),
        permissions: z.record(z.boolean()),
      }).parse(req.body);
      const [row] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `INSERT INTO platform_roles (name, description, color, permissions)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [name, description ?? null, color ?? '#6366f1', JSON.stringify(permissions)],
        );
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: row });
    });

    // PATCH /super-admin/platform-roles/:id
    fastify.patch('/platform-roles/:id', { preHandler: requirePlatformPermission('roles:manage') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const { name, description, color, permissions } = z.object({
        name:        z.string().min(1).optional(),
        description: z.string().optional(),
        color:       z.string().optional(),
        permissions: z.record(z.boolean()).optional(),
      }).parse(req.body);
      const [row] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `UPDATE platform_roles SET
             name        = COALESCE($2, name),
             description = COALESCE($3, description),
             color       = COALESCE($4, color),
             permissions = COALESCE($5, permissions),
             updated_at  = NOW()
           WHERE id = $1 RETURNING *`,
          [id, name ?? null, description ?? null, color ?? null, permissions ? JSON.stringify(permissions) : null],
        );
        return r.rows;
      });
      if (!row) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Platform role not found' } });
      return reply.send({ success: true, data: row });
    });

    // DELETE /super-admin/platform-roles/:id
    fastify.delete('/platform-roles/:id', { preHandler: requirePlatformPermission('roles:manage') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withSuperAdmin(async (client) => {
        // Unlink sub-admins before deleting
        await client.query(`UPDATE users SET platform_role_id = NULL WHERE platform_role_id = $1`, [id]);
        await client.query(`DELETE FROM platform_roles WHERE id = $1`, [id]);
      });
      return reply.send({ success: true });
    });

    // ── Sub-Admin Users ───────────────────────────────────────────────────────

    // GET /super-admin/sub-admins
    fastify.get('/sub-admins', { preHandler: requirePlatformPermission('sub_admins:manage') }, async (_req, reply) => {
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at,
                  pr.id AS platform_role_id, pr.name AS platform_role_name, pr.color AS platform_role_color
           FROM users u
           LEFT JOIN platform_roles pr ON u.platform_role_id = pr.id
           WHERE u.role = 'platform_admin'
           ORDER BY u.created_at`,
        );
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // POST /super-admin/sub-admins — invite a new sub-admin
    fastify.post('/sub-admins', { preHandler: requirePlatformPermission('sub_admins:manage') }, async (req, reply) => {
      const { name, email, platform_role_id, tenant_id } = z.object({
        name:             z.string().min(1),
        email:            z.string().email(),
        platform_role_id: z.string().uuid().optional(),
        tenant_id:        z.string().uuid(),
      }).parse(req.body);

      const existing = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`SELECT id FROM users WHERE email = $1`, [email]);
        return r.rows[0];
      });
      if (existing) return reply.code(409).send({ success: false, error: { code: 'EMAIL_EXISTS', message: 'A user with this email already exists' } });

      const [user] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `INSERT INTO users (tenant_id, name, email, role, platform_role_id, is_active)
           VALUES ($1, $2, $3, 'platform_admin', $4, true)
           RETURNING id, name, email, role, is_active, created_at`,
          [tenant_id, name, email, platform_role_id ?? null],
        );
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: user });
    });

    // PATCH /super-admin/sub-admins/:id — update role assignment or active status
    fastify.patch('/sub-admins/:id', { preHandler: requirePlatformPermission('sub_admins:manage') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({
        platform_role_id: z.string().uuid().nullable().optional(),
        is_active:        z.boolean().optional(),
      }).parse(req.body);
      const [user] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `UPDATE users SET
             platform_role_id = CASE WHEN $2::boolean THEN $3::uuid ELSE platform_role_id END,
             is_active        = COALESCE($4, is_active),
             updated_at       = NOW()
           WHERE id = $1 AND role = 'platform_admin'
           RETURNING id, name, email, role, platform_role_id, is_active`,
          [id, 'platform_role_id' in body, body.platform_role_id ?? null, body.is_active ?? null],
        );
        return r.rows;
      });
      if (!user) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Sub-admin not found' } });
      return reply.send({ success: true, data: user });
    });

    // DELETE /super-admin/sub-admins/:id
    fastify.delete('/sub-admins/:id', { preHandler: requirePlatformPermission('sub_admins:manage') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withSuperAdmin(async (client) => {
        await client.query(`DELETE FROM users WHERE id = $1 AND role = 'platform_admin'`, [id]);
      });
      return reply.send({ success: true });
    });

    // ── Entitlement Sync ─────────────────────────────────────────────────────

    // GET /super-admin/sync-entitlements/preview
    // Returns: modules to add per tenant (plan-based) + roles with missing permission keys
    fastify.get('/sync-entitlements/preview', { preHandler: requirePlatformPermission('entitlements:sync') }, async (_req, reply) => {
      const { defaultPermissions, MODULE_DEFS } = await import('./roles');
      const allPermissionKeys = MODULE_DEFS.flatMap((m) => m.actions.map((a) => a.key));

      const tenants = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT id, name, plan, active_modules FROM tenants WHERE status != 'cancelled'`,
        );
        return r.rows;
      });

      const moduleChanges: Array<{ tenant_id: string; tenant_name: string; add_modules: string[] }> = [];
      const roleChanges: Array<{ tenant_id: string; tenant_name: string; roles_affected: number; sample_keys: string[] }> = [];

      for (const tenant of tenants) {
        // Which modules does this plan qualify for that the tenant doesn't have yet?
        const current: string[] = tenant.active_modules ?? [];
        const entitled = MODULE_CATALOG
          .filter((m) => (m.included_in_plans as readonly string[]).includes(tenant.plan))
          .map((m) => m.key);
        const toAdd = entitled.filter((k) => !current.includes(k));
        if (toAdd.length > 0) {
          moduleChanges.push({ tenant_id: tenant.id, tenant_name: tenant.name, add_modules: toAdd });
        }

        // Which roles have missing permission keys?
        const roles = await db.withSuperAdmin(async (client) => {
          const r = await client.query(
            `SELECT id, name, base_role, permissions FROM roles WHERE tenant_id = $1`,
            [tenant.id],
          );
          return r.rows;
        });

        const missingKeysSet = new Set<string>();
        let affectedCount = 0;
        for (const role of roles) {
          const perms: Record<string, boolean> = role.permissions ?? {};
          const missing = allPermissionKeys.filter((k) => !(k in perms));
          if (missing.length > 0) {
            affectedCount++;
            missing.forEach((k) => missingKeysSet.add(k));
          }
        }
        if (affectedCount > 0) {
          roleChanges.push({
            tenant_id: tenant.id,
            tenant_name: tenant.name,
            roles_affected: affectedCount,
            sample_keys: Array.from(missingKeysSet).slice(0, 5),
          });
        }
      }

      return reply.send({ success: true, data: { moduleChanges, roleChanges } });
    });

    // POST /super-admin/sync-entitlements/apply
    fastify.post('/sync-entitlements/apply', { preHandler: requirePlatformPermission('entitlements:sync') }, async (req, reply) => {
      const { apply_modules, apply_permissions } = z.object({
        apply_modules:     z.boolean().default(true),
        apply_permissions: z.boolean().default(true),
      }).parse(req.body);

      const { defaultPermissions, MODULE_DEFS } = await import('./roles');
      const allPermissionKeys = MODULE_DEFS.flatMap((m) => m.actions.map((a) => a.key));

      const tenants = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT id, name, plan, active_modules FROM tenants WHERE status != 'cancelled'`,
        );
        return r.rows;
      });

      let modulesUpdated = 0;
      let rolesUpdated   = 0;
      const tenantsPendingReview: string[] = [];

      for (const tenant of tenants) {
        // ── Module sync ──────────────────────────────────────────────────────
        if (apply_modules) {
          const current: string[] = tenant.active_modules ?? [];
          const entitled = MODULE_CATALOG
            .filter((m) => (m.included_in_plans as readonly string[]).includes(tenant.plan))
            .map((m) => m.key);
          const toAdd = entitled.filter((k) => !current.includes(k));
          if (toAdd.length > 0) {
            const merged = Array.from(new Set([...current, ...toAdd]));
            await db.withSuperAdmin(async (client) => {
              await client.query(
                `UPDATE tenants SET active_modules = $1, updated_at = NOW() WHERE id = $2`,
                [merged, tenant.id],
              );
            });
            modulesUpdated++;
          }
        }

        // ── Permission key sync ──────────────────────────────────────────────
        if (apply_permissions) {
          const roles = await db.withSuperAdmin(async (client) => {
            const r = await client.query(
              `SELECT id, base_role, permissions FROM roles WHERE tenant_id = $1`,
              [tenant.id],
            );
            return r.rows;
          });

          let tenantHadMissing = false;
          for (const role of roles) {
            const perms: Record<string, boolean> = { ...(role.permissions ?? {}) };
            const defaults = defaultPermissions(role.base_role ?? 'viewer');
            const missing  = allPermissionKeys.filter((k) => !(k in perms));
            if (missing.length > 0) {
              missing.forEach((k) => { perms[k] = defaults[k] ?? false; });
              await db.withSuperAdmin(async (client) => {
                await client.query(
                  `UPDATE roles SET permissions = $1, updated_at = NOW() WHERE id = $2`,
                  [JSON.stringify(perms), role.id],
                );
              });
              rolesUpdated++;
              tenantHadMissing = true;
            }
          }

          // Flag tenant for role review
          if (tenantHadMissing) {
            tenantsPendingReview.push(tenant.id);
            await db.withSuperAdmin(async (client) => {
              await client.query(
                `UPDATE tenants
                 SET settings = jsonb_set(COALESCE(settings,'{}'), '{pending_role_review}', 'true')
                 WHERE id = $1`,
                [tenant.id],
              );
            });
          }
        }
      }

      return reply.send({
        success: true,
        data: { modulesUpdated, rolesUpdated, tenantsNotified: tenantsPendingReview.length },
      });
    });

    // Platform-wide metrics (dashboard)
    fastify.get('/metrics', { preHandler: requirePlatformPermission('metrics:view') }, async (_req, reply) => {
      const PLAN_MRR: Record<string, number> = {
        free: 0, starter: 49, professional: 149, enterprise: 499,
      };

      // All 5 queries run in parallel inside a single connection — no sequential round-trips
      const result = await db.withSuperAdmin(async (client) => {
        const [tenantR, mrrR, userR, recentR, growthR, moduleR] = await Promise.all([
          client.query(`
            SELECT
              COUNT(*)                                                          AS total_tenants,
              COUNT(*) FILTER (WHERE status = 'active')                        AS active_tenants,
              COUNT(*) FILTER (WHERE status = 'trial')                         AS trial_tenants,
              COUNT(*) FILTER (WHERE status = 'suspended')                     AS suspended_tenants,
              COUNT(*) FILTER (WHERE plan = 'free')                            AS free_plan,
              COUNT(*) FILTER (WHERE plan = 'starter')                         AS starter_plan,
              COUNT(*) FILTER (WHERE plan = 'professional')                    AS professional_plan,
              COUNT(*) FILTER (WHERE plan = 'enterprise')                      AS enterprise_plan,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS new_tenants_30d,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')  AS new_tenants_7d
            FROM tenants`),
          client.query(`SELECT plan, COUNT(*) AS cnt FROM tenants WHERE status = 'active' GROUP BY plan`),
          client.query(`
            SELECT
              COUNT(*)                                                          AS total_users,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS new_users_30d
            FROM users WHERE role != 'super_admin'`),
          client.query(`SELECT id, name, slug, plan, status, active_modules, created_at FROM tenants ORDER BY created_at DESC LIMIT 6`),
          client.query(`
            SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'Mon') AS month, COUNT(*) AS count
            FROM tenants WHERE created_at > NOW() - INTERVAL '6 months'
            GROUP BY DATE_TRUNC('month', created_at) ORDER BY DATE_TRUNC('month', created_at)`),
          client.query(`
            SELECT m.module, COUNT(*) AS cnt FROM tenants, UNNEST(active_modules) AS m(module)
            WHERE status = 'active' GROUP BY m.module ORDER BY cnt DESC`),
        ]);

        const mrr = mrrR.rows.reduce((sum: number, row: any) => sum + (PLAN_MRR[row.plan] ?? 0) * parseInt(row.cnt), 0);

        return {
          ...tenantR.rows[0],
          mrr,
          ...userR.rows[0],
          recentTenants:  recentR.rows,
          monthlyGrowth:  growthR.rows,
          moduleAdoption: moduleR.rows,
        };
      });

      return reply.send({ success: true, data: result });
    });

    // ── Platform Invoices (super admin → tenant billing) ──────────────────────

    // GET /super-admin/platform-invoices
    fastify.get('/platform-invoices', { preHandler: requirePlatformPermission('billing:view') }, async (req, reply) => {
      const { tenant_id, status, page = 1, pageSize = 20 } = req.query as any;
      const offset = (Number(page) - 1) * Number(pageSize);

      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT pi.*, t.name AS tenant_name, t.plan AS tenant_plan,
                  COALESCE(SUM(pp.amount),0) AS amount_paid
           FROM platform_invoices pi
           JOIN tenants t ON pi.tenant_id = t.id
           LEFT JOIN platform_payments pp ON pp.invoice_id = pi.id
           WHERE ($1::uuid IS NULL OR pi.tenant_id = $1)
             AND ($2::text IS NULL OR pi.status = $2)
           GROUP BY pi.id, t.name, t.plan
           ORDER BY pi.created_at DESC
           LIMIT $3 OFFSET $4`,
          [tenant_id ?? null, status ?? null, Number(pageSize), offset],
        );
        return r.rows;
      });

      const [{ count }] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT COUNT(*) FROM platform_invoices
           WHERE ($1::uuid IS NULL OR tenant_id = $1)
             AND ($2::text IS NULL OR status = $2)`,
          [tenant_id ?? null, status ?? null],
        );
        return r.rows;
      });

      return reply.send({ success: true, data: rows, meta: { total: Number(count), page: Number(page), pageSize: Number(pageSize) } });
    });

    // POST /super-admin/platform-invoices
    fastify.post('/platform-invoices', { preHandler: requirePlatformPermission('billing:manage') }, async (req, reply) => {
      const body = z.object({
        tenant_id:    z.string().uuid(),
        period_start: z.string(),
        period_end:   z.string(),
        due_date:     z.string(),
        currency:     z.string().default('GBP'),
        items:        z.array(z.object({
          description: z.string(),
          quantity:    z.number().default(1),
          unit_price:  z.number(),
        })).min(1),
        notes: z.string().optional(),
      }).parse(req.body);

      const amount = body.items.reduce((s, i) => s + i.quantity * i.unit_price, 0);

      // Generate sequential invoice number e.g. INV-2026-0042
      const [{ nextval }] = await db.withSuperAdmin(async (c) => {
        const r = await c.query(`SELECT COALESCE(MAX(CAST(SPLIT_PART(invoice_number,'-',3) AS INT)),0)+1 AS nextval FROM platform_invoices`);
        return r.rows;
      });
      const invoiceNumber = `INV-${new Date().getFullYear()}-${String(nextval).padStart(4,'0')}`;

      const [row] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `INSERT INTO platform_invoices (tenant_id, invoice_number, period_start, period_end, due_date, currency, amount, items, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [body.tenant_id, invoiceNumber, body.period_start, body.period_end, body.due_date,
           body.currency, amount, JSON.stringify(body.items), body.notes ?? null],
        );
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: row });
    });

    // PATCH /super-admin/platform-invoices/:id — update status or send
    fastify.patch('/platform-invoices/:id', { preHandler: requirePlatformPermission('billing:manage') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({
        status: z.enum(['draft','sent','paid','overdue','cancelled']).optional(),
        notes:  z.string().optional(),
        due_date: z.string().optional(),
      }).parse(req.body);

      const [row] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `UPDATE platform_invoices SET
             status   = COALESCE($2, status),
             notes    = COALESCE($3, notes),
             due_date = COALESCE($4, due_date),
             paid_at  = CASE WHEN $2 = 'paid' AND paid_at IS NULL THEN NOW() ELSE paid_at END,
             updated_at = NOW()
           WHERE id = $1 RETURNING *`,
          [id, body.status ?? null, body.notes ?? null, body.due_date ?? null],
        );
        return r.rows;
      });
      if (!row) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found' } });
      return reply.send({ success: true, data: row });
    });

    // DELETE /super-admin/platform-invoices/:id (draft only)
    fastify.delete('/platform-invoices/:id', { preHandler: requirePlatformPermission('billing:manage') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withSuperAdmin(async (client) => {
        await client.query(`DELETE FROM platform_invoices WHERE id = $1 AND status = 'draft'`, [id]);
      });
      return reply.send({ success: true });
    });

    // POST /super-admin/platform-invoices/:id/payments — record a payment
    fastify.post('/platform-invoices/:id/payments', { preHandler: requirePlatformPermission('billing:manage') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({
        amount:       z.number().positive(),
        payment_date: z.string(),
        method:       z.enum(['bank_transfer','card','cheque','cash','other']).optional(),
        reference:    z.string().optional(),
        notes:        z.string().optional(),
      }).parse(req.body);

      const [invoice] = await db.withSuperAdmin(async (c) => {
        const r = await c.query(`SELECT * FROM platform_invoices WHERE id = $1`, [id]);
        return r.rows;
      });
      if (!invoice) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found' } });

      const [payment] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `INSERT INTO platform_payments (invoice_id, tenant_id, amount, currency, payment_date, method, reference, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [id, invoice.tenant_id, body.amount, invoice.currency, body.payment_date,
           body.method ?? null, body.reference ?? null, body.notes ?? null],
        );
        return r.rows;
      });

      // Auto-mark invoice paid if total payments cover the amount
      const [{ total_paid }] = await db.withSuperAdmin(async (c) => {
        const r = await c.query(`SELECT COALESCE(SUM(amount),0) AS total_paid FROM platform_payments WHERE invoice_id=$1`, [id]);
        return r.rows;
      });
      if (Number(total_paid) >= Number(invoice.amount)) {
        await db.withSuperAdmin(async (c) => {
          await c.query(`UPDATE platform_invoices SET status='paid', paid_at=NOW(), updated_at=NOW() WHERE id=$1`, [id]);
        });
      }

      return reply.code(201).send({ success: true, data: payment });
    });

    // GET /super-admin/platform-invoices/:id/payments
    fastify.get('/platform-invoices/:id/payments', { preHandler: requirePlatformPermission('billing:view') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT * FROM platform_payments WHERE invoice_id = $1 ORDER BY payment_date DESC`,
          [id],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // PATCH /super-admin/tenants/:id — edit workspace name / slug / sector / status
    fastify.patch('/tenants/:id', { preHandler: requirePlatformPermission('tenants:create') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const EditSchema = z.object({
        name:   z.string().min(2).optional(),
        sector: z.string().optional(),
        status: z.enum(['active','trial','suspended','cancelled']).optional(),
      });
      const body = EditSchema.parse(req.body);
      const sets: string[] = [];
      const vals: any[] = [];
      if (body.name   !== undefined) { vals.push(body.name);   sets.push(`name = $${vals.length}`); }
      if (body.sector !== undefined) { vals.push(body.sector); sets.push(`sector = $${vals.length}`); }
      if (body.status !== undefined) { vals.push(body.status === 'active'); sets.push(`is_active = $${vals.length}`); }
      if (!sets.length) return reply.code(400).send({ success: false, error: { code: 'NO_FIELDS', message: 'Nothing to update' } });
      vals.push(id);
      const [updated] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`UPDATE tenants SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
        return r.rows;
      });
      if (!updated) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Tenant not found' } });
      await tenantService.invalidateCacheById(id);
      // Re-seed sector fields when sector is changed (adds new fields; existing ones are kept via ON CONFLICT DO NOTHING)
      if (body.sector) await seedSectorFields(db, id, body.sector);
      return reply.send({ success: true, data: updated });
    });

    // DELETE /super-admin/tenants/:id — delete workspace
    fastify.delete('/tenants/:id', { preHandler: requirePlatformPermission('tenants:suspend') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withSuperAdmin(async (client) => {
        await client.query('DELETE FROM tenants WHERE id = $1', [id]);
      });
      await tenantService.invalidateCacheById(id);
      return reply.send({ success: true });
    });

    // GET /super-admin/tenants/:id/users — list all users in a tenant
    fastify.get('/tenants/:id/users', { preHandler: requirePlatformPermission('tenants:manage_users') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT id, name, email, role, is_active, created_at, last_login_at FROM users WHERE tenant_id = $1 ORDER BY role, name`,
          [id],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // POST /super-admin/tenants/:id/users — create a user (tenant_admin) in a workspace
    fastify.post('/tenants/:id/users', { preHandler: requirePlatformPermission('tenants:manage_users') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const CreateUserSchema = z.object({
        name:     z.string().min(1),
        email:    z.string().email(),
        role:     z.string().default('admin'),
        password: z.string().min(8),
      });
      const body = CreateUserSchema.parse(req.body);
      const bcrypt = (await import('bcryptjs')).default;
      const hash = await bcrypt.hash(body.password, 12);
      const [user] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `INSERT INTO users (tenant_id, name, email, role, password_hash, is_active)
           VALUES ($1, $2, $3, $4, $5, true) RETURNING id, name, email, role, is_active, created_at`,
          [id, body.name, body.email, body.role, hash],
        );
        // Log password creation
        await client.query(
          `INSERT INTO super_admin_password_log (tenant_id, user_id, action, changed_by, notes)
           VALUES ($1, $2, 'created', $3, $4)
           ON CONFLICT DO NOTHING`,
          [id, r.rows[0]?.id, (req as any).user?.userId, `Password set at account creation`],
        ).catch(() => {}); // table may not exist yet — fail silently
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: user });
    });

    // PATCH /super-admin/users/:uid — edit user (name, email, role, password)
    fastify.patch('/users/:uid', { preHandler: requirePlatformPermission('tenants:manage_users') }, async (req, reply) => {
      const { uid } = req.params as { uid: string };
      const EditUserSchema = z.object({
        name:     z.string().min(1).optional(),
        email:    z.string().email().optional(),
        role:     z.string().optional(),
        password: z.string().min(8).optional(),
        status:   z.enum(['active','inactive']).optional(),
      });
      const body = EditUserSchema.parse(req.body);
      const sets: string[] = [];
      const vals: any[] = [];
      if (body.name   !== undefined) { vals.push(body.name);   sets.push(`name = $${vals.length}`); }
      if (body.email  !== undefined) { vals.push(body.email);  sets.push(`email = $${vals.length}`); }
      if (body.role   !== undefined) { vals.push(body.role);   sets.push(`role = $${vals.length}`); }
      if (body.status !== undefined) { vals.push(body.status === 'active'); sets.push(`is_active = $${vals.length}`); }
      if (body.password !== undefined) {
        const bcrypt = (await import('bcryptjs')).default;
        const hash = await bcrypt.hash(body.password, 12);
        vals.push(hash);
        sets.push(`password_hash = $${vals.length}`);
      }
      if (!sets.length) return reply.code(400).send({ success: false, error: { code: 'NO_FIELDS', message: 'Nothing to update' } });
      vals.push(uid);
      const [updated] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id, name, email, role, is_active`,
          vals,
        );
        if (body.password && r.rows[0]) {
          const u = r.rows[0];
          await client.query(
            `INSERT INTO super_admin_password_log (tenant_id, user_id, action, changed_by, notes)
             SELECT tenant_id, id, 'reset', $2, 'Password reset by Super Admin'
             FROM users WHERE id = $1`,
            [uid, (req as any).user?.userId],
          ).catch(() => {});
        }
        return r.rows;
      });
      if (!updated) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      return reply.send({ success: true, data: updated });
    });

    // DELETE /super-admin/users/:uid — delete any user
    fastify.delete('/users/:uid', { preHandler: requirePlatformPermission('tenants:manage_users') }, async (req, reply) => {
      const { uid } = req.params as { uid: string };
      await db.withSuperAdmin(async (client) => {
        await client.query('DELETE FROM users WHERE id = $1', [uid]);
      });
      return reply.send({ success: true });
    });

    // GET /super-admin/password-log?tenant_id= — password change history
    fastify.get('/password-log', { preHandler: requirePlatformPermission('tenants:manage_users') }, async (req, reply) => {
      const { tenant_id } = req.query as { tenant_id?: string };
      const rows = await db.withSuperAdmin(async (client) => {
        // Create table if it doesn't exist yet
        await client.query(`
          CREATE TABLE IF NOT EXISTS super_admin_password_log (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
            user_id     UUID,
            action      TEXT NOT NULL DEFAULT 'reset',
            changed_by  UUID,
            notes       TEXT,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        const r = await client.query(`
          SELECT
            l.id, l.action, l.notes, l.created_at,
            u.name  AS user_name,  u.email AS user_email, u.role AS user_role,
            t.name  AS tenant_name, t.slug AS tenant_slug,
            a.name  AS admin_name
          FROM super_admin_password_log l
          LEFT JOIN users   u ON u.id = l.user_id
          LEFT JOIN users   a ON a.id = l.changed_by
          LEFT JOIN tenants t ON t.id = l.tenant_id
          ${tenant_id ? 'WHERE l.tenant_id = $1' : ''}
          ORDER BY l.created_at DESC
          LIMIT 500
        `, tenant_id ? [tenant_id] : []);
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // GET /super-admin/reports/workspaces — workspace / tenant details report
    fastify.get('/reports/workspaces', { preHandler: requirePlatformPermission('reports:view') }, async (req, reply) => {
      const { from, to } = req.query as { from?: string; to?: string };
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`
          SELECT
            t.id, t.name, t.slug, t.plan, t.status, t.sector, t.active_modules,
            t.created_at,
            COUNT(DISTINCT u.id)::int           AS user_count,
            COUNT(DISTINCT u.id) FILTER (WHERE u.is_active = true)::int AS active_users,
            COUNT(DISTINCT c.id)::int           AS contact_count,
            COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'open')::int AS open_deals,
            MAX(u.last_login_at)                AS last_activity,
            t.last_backup_at,
            COALESCE(t.storage_bytes, 0)        AS storage_bytes
          FROM tenants t
          LEFT JOIN users    u ON u.tenant_id = t.id
          LEFT JOIN contacts c ON c.tenant_id = t.id
          LEFT JOIN deals    d ON d.tenant_id = t.id
          WHERE ($1::date IS NULL OR t.created_at >= $1::date)
            AND ($2::date IS NULL OR t.created_at <= $2::date + interval '1 day')
          GROUP BY t.id
          ORDER BY t.created_at DESC
        `, [from || null, to || null]);
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // GET /super-admin/reports/backups — backup status report (highlights stale > 5 days)
    fastify.get('/reports/backups', { preHandler: requirePlatformPermission('reports:view') }, async (_req, reply) => {
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`
          SELECT
            t.id, t.name, t.slug, t.status,
            t.last_backup_at,
            CASE
              WHEN t.last_backup_at IS NULL THEN 'never'
              WHEN NOW() - t.last_backup_at > interval '5 days' THEN 'overdue'
              ELSE 'ok'
            END AS backup_status,
            EXTRACT(EPOCH FROM (NOW() - t.last_backup_at)) / 86400 AS days_since_backup
          FROM tenants t
          ORDER BY t.last_backup_at ASC NULLS FIRST
        `);
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // GET /super-admin/reports/invoices — invoice report with date range + optional tenant filter
    fastify.get('/reports/invoices', { preHandler: requirePlatformPermission('billing:view') }, async (req, reply) => {
      const { from, to, tenant_id } = req.query as { from?: string; to?: string; tenant_id?: string };
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`
          SELECT
            pi.id, pi.invoice_number, pi.status, pi.amount,
            COALESCE(pp_sum.amount_paid, 0) AS amount_paid,
            pi.currency, pi.due_date, pi.period_start, pi.period_end,
            pi.created_at, pi.tenant_id,
            t.name AS tenant_name, t.slug AS tenant_slug,
            CASE
              WHEN pi.due_date IS NULL THEN 'no_due_date'
              WHEN pi.due_date < NOW() AND pi.status NOT IN ('paid') THEN 'overdue'
              ELSE 'not_due'
            END AS due_status,
            CASE
              WHEN COALESCE(pp_sum.amount_paid, 0) = 0 THEN 'unpaid'
              WHEN pp_sum.amount_paid >= pi.amount THEN 'paid'
              ELSE 'partial'
            END AS payment_status
          FROM platform_invoices pi
          LEFT JOIN tenants t ON t.id = pi.tenant_id
          LEFT JOIN (
            SELECT invoice_id, SUM(amount) AS amount_paid
            FROM platform_payments
            GROUP BY invoice_id
          ) pp_sum ON pp_sum.invoice_id = pi.id
          WHERE ($1::date IS NULL OR pi.created_at >= $1::date)
            AND ($2::date IS NULL OR pi.created_at <= $2::date + interval '1 day')
            AND ($3::uuid IS NULL OR pi.tenant_id = $3::uuid)
          ORDER BY pi.created_at DESC
        `, [from || null, to || null, tenant_id || null]);
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // GET /super-admin/reports/payments — payment report with date range
    fastify.get('/reports/payments', { preHandler: requirePlatformPermission('billing:view') }, async (req, reply) => {
      const { from, to } = req.query as { from?: string; to?: string };
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`
          SELECT
            pp.id, pp.amount, pp.currency, pp.payment_date, pp.method AS payment_method,
            pp.reference, pp.notes, pp.created_at,
            pi.invoice_number, t.name AS tenant_name, t.slug AS tenant_slug
          FROM platform_payments pp
          LEFT JOIN platform_invoices pi ON pi.id = pp.invoice_id
          LEFT JOIN tenants t ON t.id = pi.tenant_id
          WHERE ($1::date IS NULL OR pp.payment_date >= $1::date)
            AND ($2::date IS NULL OR pp.payment_date <= $2::date + interval '1 day')
          ORDER BY pp.payment_date DESC
        `, [from || null, to || null]);
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // GET /super-admin/reports/audit — cross-tenant audit log
    fastify.get('/reports/audit', { preHandler: requirePlatformPermission('reports:view') }, async (req, reply) => {
      const { limit = '200', action } = req.query as Record<string, string>;
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`
          SELECT
            tal.id, tal.action, tal.ticket_id,
            tal.old_value, tal.new_value, tal.created_at,
            u.name  AS actor_name,  u.email AS actor_email, u.role AS actor_role,
            t.name  AS tenant_name, t.slug  AS tenant_slug
          FROM ticket_audit_log tal
          LEFT JOIN users   u ON u.id = tal.actor_id
          LEFT JOIN tenants t ON t.id = tal.tenant_id
          WHERE ($1::text IS NULL OR tal.action = $1)
          ORDER BY tal.created_at DESC
          LIMIT $2
        `, [action || null, parseInt(limit, 10)]);
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });
  };
}
