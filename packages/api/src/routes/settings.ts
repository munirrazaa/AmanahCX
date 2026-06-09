import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '@crm/core';
import { requireRole } from '../middlewares/auth.middleware';
import { EmailService } from '../services/email.service';

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

const WorkspaceSchema = z.object({
  name:       z.string().min(1).optional(),
  domain:     z.string().optional(),
  timezone:   z.string().optional(),
  dateFormat: z.string().optional(),
  currency:   z.string().length(3).optional(),
});

export function settingsRoutes(db: DatabaseClient) {
  const emailSvc = new EmailService(db);

  return async function (fastify: FastifyInstance) {

    // Root — returns workspace + plan info
    fastify.get('/', async (req, reply) => {
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
    fastify.get('/workspace', { preHandler: requireRole('super_admin', 'tenant_admin', 'manager') }, async (req, reply) => {
      const [tenant] = await db.withSuperAdmin(async (client) => {
        const result = await client.query(
          'SELECT id, name, slug, custom_domain, plan, status, settings, billing_details FROM tenants WHERE id = $1',
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

    // List team members (super_admin excluded — internal platform role)
    fastify.get('/team', { preHandler: requireRole('super_admin', 'tenant_admin', 'manager') }, async (req, reply) => {
      const members = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT id, name, email, role, permissions, is_active, created_at, last_login_at
           FROM users WHERE role != 'super_admin' ORDER BY name ASC`,
        );
        return result.rows;
      });
      return reply.send({ success: true, data: members });
    });

    // Get module definitions (for permissions matrix UI)
    fastify.get('/team/modules', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (_req, reply) => {
      return reply.send({ success: true, data: MODULE_DEFS });
    });

    // Invite team member
    fastify.post('/team/invite', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const InviteSchema = z.object({
        email:           z.string().email(),
        name:            z.string().max(100).optional(),
        // Tenant admins can only assign roles up to their own level; super_admin is never assignable here
        role:            z.enum(['tenant_admin', 'manager', 'agent', 'viewer']).default('agent'),
        custom_role_id:  z.string().uuid().optional(),
        permissions:     z.record(z.string()).optional(),
      });
      const parsed = InviteSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ success: false, error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid input' } });
      }
      const { email, name, role, custom_role_id, permissions: customPermissions } = parsed.data;

      const displayName  = name?.trim() || email.split('@')[0];
      const assignedRole = role ?? 'agent';
      const perms        = customPermissions ?? defaultPermissions(assignedRole);

      // 1. Create (or update) user account with role + permissions
      const [user] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `INSERT INTO users (tenant_id, email, name, role, password_hash, permissions, custom_role_id)
           VALUES ($1, $2, $3, $4, 'INVITE_PENDING', $5, $6)
           ON CONFLICT (tenant_id, email) DO UPDATE
             SET role = EXCLUDED.role, name = EXCLUDED.name,
                 permissions = EXCLUDED.permissions, custom_role_id = EXCLUDED.custom_role_id
           RETURNING id, email, name, role, permissions, custom_role_id`,
          [req.tenant.id, email, displayName, assignedRole, JSON.stringify(perms), custom_role_id ?? null],
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
                © ${new Date().getFullYear()} Vivid Solutions &amp; Services. If you didn't expect this invitation, you can ignore this email.
              </p>
            </div>
          `,
          bodyText: `You've been invited to join ${workspaceName} on Vivid CRM as ${role ?? 'agent'}.\n\nSet your password here: ${inviteUrl}\n\nThis link expires in 7 days.`,
        });
      } catch {
        // Email failure should not block the invite — user is created, admin can resend
      }

      return reply.code(201).send({ success: true, data: user });
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
        // Restrict to tenant-level roles only — super_admin cannot be self-assigned
        role:        z.enum(['tenant_admin', 'manager', 'agent', 'viewer']).optional(),
        department:  z.enum(['sales', 'support', 'complaints']).nullable().optional(),
        permissions: z.record(z.string()).optional(),
      });
      const parsed = PatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ success: false, error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid input' } });
      }
      const { role, permissions: customPermissions } = parsed.data;

      const [user] = await db.withTenant(req.tenant.id, async (client) => {
        // Build dynamic update
        const updates: string[] = [];
        const vals: any[] = [];
        let i = 1;

        if (role !== undefined) {
          updates.push(`role = $${i++}`);
          vals.push(role);
          // When role changes, reset permissions to new role defaults unless custom ones provided
          if (!customPermissions) {
            updates.push(`permissions = $${i++}`);
            vals.push(JSON.stringify(defaultPermissions(role)));
          }
        }
        if (customPermissions !== undefined) {
          updates.push(`permissions = $${i++}`);
          vals.push(JSON.stringify(customPermissions));
        }

        if (updates.length === 0) return [null];

        vals.push(userId);
        const result = await client.query(
          `UPDATE users SET ${updates.join(', ')}, updated_at = NOW()
           WHERE id = $${i} RETURNING id, name, email, role, permissions`,
          vals,
        );
        return result.rows;
      });

      if (!user) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      return reply.send({ success: true, data: user });
    });


    // ── Milestone Templates ───────────────────────────────────────────────
    // GET  /settings/milestone-templates
    // PUT  /settings/milestone-templates/:ticketType
    fastify.get('/milestone-templates', async (req, reply) => {
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
      const bcrypt = await import('bcryptjs');
      const [user] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query('SELECT password_hash FROM users WHERE id = $1', [req.user.sub]);
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
  };
}
