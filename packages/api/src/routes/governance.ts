/**
 * governance.ts
 *
 * Routes:
 *  G-F5 — GDPR voice recording retention policies
 *    GET    /api/v1/governance/retention-policies
 *    POST   /api/v1/governance/retention-policies
 *    PATCH  /api/v1/governance/retention-policies/:id
 *    PATCH  /api/v1/governance/retention-policies/:id/publish
 *    DELETE /api/v1/governance/retention-policies/:id
 *
 *  Orders — tenant upgrade / request system
 *    GET    /api/v1/governance/orders           (tenant_admin sees own; super_admin sees all)
 *    POST   /api/v1/governance/orders           (tenant_admin creates)
 *    PATCH  /api/v1/governance/orders/:id/review  (super_admin: set quoted_amount)
 *    PATCH  /api/v1/governance/orders/:id/approve (super_admin: approve + optionally confirm payment)
 *    PATCH  /api/v1/governance/orders/:id/reject  (super_admin: reject with note)
 *    PATCH  /api/v1/governance/orders/:id/cancel  (tenant_admin: cancel own pending order)
 *    GET    /api/v1/governance/catalog           (module/feature catalog — public to all tenant users)
 *    GET    /api/v1/governance/entitlements      (what THIS tenant has purchased)
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '@crm/core';
import { MODULE_CATALOG } from './super-admin';

// Row shapes matching migrations/042_governance_orders.sql — used as db.query<T>
// generic args below so column access type-checks instead of falling back to '{}'.
interface RetentionPolicyRow {
  id: number;
  tenant_id: string;
  policy_name: string;
  retention_days: number;
  legal_basis: string;
  processing_purpose: string;
  data_categories: string[];
  third_party_transfers: boolean;
  third_parties: string | null;
  policy_status: 'draft' | 'published';
  published_at: string | null;
  published_by: string | null;
  expires_at: string | null;
  last_warned_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface TenantOrderRow {
  id: number;
  tenant_id: string;
  order_type: 'storage_extension' | 'new_module' | 'feature_request' | 'plan_upgrade';
  status: 'pending' | 'under_review' | 'approved' | 'rejected' | 'cancelled';
  requested_module: string | null;
  requested_features: string[] | null;
  requested_days: number | null;
  description: string;
  quoted_amount: number | null;
  currency: string | null;
  payment_confirmed: boolean;
  payment_ref: string | null;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  requested_by: string;
  requested_at: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function sendSystemEmail(opts: {
  to: string; toName: string; subject: string; bodyHtml: string; bodyText: string;
}): Promise<boolean> {
  const sg     = process.env.SENDGRID_API_KEY;
  const sgFrom = process.env.SENDGRID_FROM_EMAIL;
  if (sg && sgFrom) {
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sg}` },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: opts.to, name: opts.toName }] }],
          from: { email: sgFrom, name: process.env.SENDGRID_FROM_NAME ?? 'AmanahCX Platform' },
          subject: opts.subject,
          content: [
            { type: 'text/plain', value: opts.bodyText },
            { type: 'text/html',  value: opts.bodyHtml  },
          ],
        }),
      });
      return res.ok || res.status === 202;
    } catch { return false; }
  }
  return false;
}

// ── route plugin ─────────────────────────────────────────────────────────────

export function governanceRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {

    // ── Auth guard ─────────────────────────────────────────────────────────
    fastify.addHook('onRequest', async (req, reply) => {
      try { await req.jwtVerify(); }
      catch { return reply.status(401).send({ error: 'Unauthorised' }); }
    });

    function tenantId(req: any): string { return req.user.tenantId; }
    function userId(req: any): string   { return req.user.sub; }
    function role(req: any): string     { return req.user.role; }
    function isSuperAdmin(req: any)     { return role(req) === 'super_admin'; }
    function isTenantAdmin(req: any)    { return role(req) === 'tenant_admin' || isSuperAdmin(req); }
    function isPolicyAdmin(req: any)    { return role(req) === 'policy_admin' || isTenantAdmin(req); }

    // ── Catalog — all modules + features with entitlement flag ─────────────
    fastify.get('/catalog', async (req, reply) => {
      const rows = await db.query<{ entitled_features: string[]; active_modules: string[] }>(
        `SELECT entitled_features, active_modules FROM tenants WHERE id = $1`,
        [tenantId(req)],
      );
      const t = rows[0];
      const entitled: string[]  = t?.entitled_features ?? [];
      const activeModules: string[] = t?.active_modules ?? [];

      const catalog = MODULE_CATALOG.map(m => ({
        ...m,
        purchased: activeModules.includes(m.key),
        features: m.features.map(f => ({
          ...f,
          purchased: entitled.includes(f.key),
        })),
      }));
      return reply.send({ success: true, data: catalog });
    });

    // ── Entitlements — quick summary for current tenant ────────────────────
    fastify.get('/entitlements', async (req, reply) => {
      const rows = await db.query<{ entitled_features: string[]; active_modules: string[]; plan: string }>(
        `SELECT entitled_features, active_modules, plan FROM tenants WHERE id = $1`,
        [tenantId(req)],
      );
      return reply.send({ success: true, data: rows[0] ?? {} });
    });

    // ══════════════════════════════════════════════════════════════════════
    // RETENTION POLICIES
    // ══════════════════════════════════════════════════════════════════════

    fastify.get('/retention-policies', async (req, reply) => {
      const rows = await db.query<RetentionPolicyRow & { created_by_name: string | null; published_by_name: string | null }>(
        `SELECT rrp.*, u.name AS created_by_name, p.name AS published_by_name
         FROM recording_retention_policies rrp
         LEFT JOIN users u ON u.id = rrp.created_by
         LEFT JOIN users p ON p.id = rrp.published_by
         WHERE rrp.tenant_id = $1
         ORDER BY rrp.created_at DESC`,
        [tenantId(req)],
      );
      return reply.send({ success: true, data: rows });
    });

    fastify.post('/retention-policies', async (req, reply) => {
      if (!isPolicyAdmin(req)) return reply.status(403).send({ error: 'Policy admin or above required' });
      const b = req.body as any;
      const rows = await db.query<RetentionPolicyRow>(
        `INSERT INTO recording_retention_policies
           (tenant_id, policy_name, retention_days, legal_basis, processing_purpose,
            data_categories, third_party_transfers, third_parties, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          tenantId(req),
          b.policy_name ?? 'Default Recording Retention Policy',
          b.retention_days ?? 90,
          b.legal_basis ?? 'legitimate_interest',
          b.processing_purpose ?? 'Customer service quality assurance',
          b.data_categories ?? ['voice_recordings', 'call_transcripts'],
          b.third_party_transfers ?? false,
          b.third_parties ?? null,
          userId(req),
        ],
      );
      return reply.status(201).send({ success: true, data: rows[0] });
    });

    fastify.patch('/retention-policies/:id', async (req, reply) => {
      if (!isPolicyAdmin(req)) return reply.status(403).send({ error: 'Policy admin or above required' });
      const { id } = req.params as any;
      const b = req.body as any;

      // Block edits on published policies — must unpublish first
      const existing = await db.query<Pick<RetentionPolicyRow, 'policy_status'>>(
        `SELECT policy_status FROM recording_retention_policies WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId(req)],
      );
      if (!existing[0]) return reply.status(404).send({ error: 'Policy not found' });
      if (existing[0].policy_status === 'published') {
        return reply.status(409).send({ error: 'Cannot edit a published policy. Unpublish it first.' });
      }

      const rows = await db.query<RetentionPolicyRow>(
        `UPDATE recording_retention_policies SET
           policy_name          = COALESCE($1, policy_name),
           retention_days       = COALESCE($2, retention_days),
           legal_basis          = COALESCE($3, legal_basis),
           processing_purpose   = COALESCE($4, processing_purpose),
           data_categories      = COALESCE($5, data_categories),
           third_party_transfers= COALESCE($6, third_party_transfers),
           third_parties        = COALESCE($7, third_parties),
           updated_at           = NOW()
         WHERE id = $8 AND tenant_id = $9
         RETURNING *`,
        [
          b.policy_name ?? null,
          b.retention_days ?? null,
          b.legal_basis ?? null,
          b.processing_purpose ?? null,
          b.data_categories ?? null,
          b.third_party_transfers ?? null,
          b.third_parties ?? null,
          id, tenantId(req),
        ],
      );
      return reply.send({ success: true, data: rows[0] });
    });

    // Publish / unpublish toggle — policy_admin+
    fastify.patch('/retention-policies/:id/publish', async (req, reply) => {
      if (!isPolicyAdmin(req)) return reply.status(403).send({ error: 'Policy admin or above required' });
      const { id } = req.params as any;
      const rows = await db.query<RetentionPolicyRow>(
        `SELECT * FROM recording_retention_policies WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId(req)],
      );
      if (!rows[0]) return reply.status(404).send({ error: 'Policy not found' });
      const p = rows[0];
      const nowPublished = p.policy_status !== 'published';
      const expiresAt = nowPublished
        ? new Date(Date.now() + p.retention_days * 24 * 60 * 60 * 1000).toISOString()
        : null;
      const updated = await db.query<RetentionPolicyRow>(
        `UPDATE recording_retention_policies SET
           policy_status = $1, published_at = $2, published_by = $3,
           expires_at = $4, updated_at = NOW()
         WHERE id = $5 AND tenant_id = $6
         RETURNING *`,
        [
          nowPublished ? 'published' : 'draft',
          nowPublished ? new Date().toISOString() : null,
          nowPublished ? userId(req) : null,
          expiresAt,
          id, tenantId(req),
        ],
      );
      return reply.send({ success: true, data: updated[0] });
    });

    fastify.delete('/retention-policies/:id', async (req, reply) => {
      if (!isTenantAdmin(req)) return reply.status(403).send({ error: 'Tenant admin required' });
      const { id } = req.params as any;
      const rows = await db.query<Pick<RetentionPolicyRow, 'policy_status'>>(
        `SELECT policy_status FROM recording_retention_policies WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId(req)],
      );
      if (!rows[0]) return reply.status(404).send({ error: 'Policy not found' });
      if (rows[0].policy_status === 'published') {
        return reply.status(409).send({ error: 'Unpublish the policy before deleting it.' });
      }
      await db.query(`DELETE FROM recording_retention_policies WHERE id = $1 AND tenant_id = $2`, [id, tenantId(req)]);
      return reply.send({ success: true });
    });

    // ══════════════════════════════════════════════════════════════════════
    // ORDERS
    // ══════════════════════════════════════════════════════════════════════

    // List orders — withSuperAdmin bypasses RLS on the users JOIN
    fastify.get('/orders', async (req, reply) => {
      const qs = req.query as any;
      let rows: any[];
      if (isSuperAdmin(req)) {
        rows = await db.withSuperAdmin(async (client) => {
          const whereClause = qs.status ? `WHERE o.status = $1` : '';
          const result = await client.query(
            `SELECT o.*, t.name AS tenant_name, u.name AS requested_by_name, u.email AS requested_by_email,
                    a.name AS reviewed_by_name
             FROM tenant_orders o
             JOIN tenants t ON t.id = o.tenant_id
             JOIN users u   ON u.id = o.requested_by
             LEFT JOIN users a ON a.id = o.reviewed_by
             ${whereClause}
             ORDER BY o.requested_at DESC`,
            qs.status ? [qs.status] : [],
          );
          return result.rows;
        });
      } else if (isTenantAdmin(req)) {
        rows = await db.withSuperAdmin(async (client) => {
          const result = await client.query(
            `SELECT o.*, u.name AS requested_by_name, a.name AS reviewed_by_name
             FROM tenant_orders o
             JOIN users u ON u.id = o.requested_by
             LEFT JOIN users a ON a.id = o.reviewed_by
             WHERE o.tenant_id = $1
             ORDER BY o.requested_at DESC`,
            [tenantId(req)],
          );
          return result.rows;
        });
      } else {
        return reply.status(403).send({ error: 'Tenant admin or above required' });
      }
      return reply.send({ success: true, data: rows });
    });

    // Create order (tenant_admin)
    fastify.post('/orders', async (req, reply) => {
      if (!isTenantAdmin(req)) return reply.status(403).send({ error: 'Tenant admin required' });
      const b = req.body as any;
      if (!b.order_type || !b.description) {
        return reply.status(400).send({ error: 'order_type and description are required' });
      }
      const rows = await db.query<TenantOrderRow>(
        `INSERT INTO tenant_orders
           (tenant_id, order_type, description, requested_module, requested_features,
            requested_days, requested_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          tenantId(req),
          b.order_type,
          b.description,
          b.requested_module ?? null,
          b.requested_features ?? null,
          b.requested_days ?? null,
          userId(req),
        ],
      );
      const order = rows[0];

      // Notify all super admins by email
      try {
        const superAdmins = await db.query<{ email: string; name: string }>(
          `SELECT email, name FROM users WHERE role = 'super_admin' AND is_active = TRUE LIMIT 5`,
          [],
        );
        const tenantName = (await db.query<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [tenantId(req)]))[0]?.name ?? tenantId(req);
        for (const sa of superAdmins) {
          await sendSystemEmail({
            to: sa.email,
            toName: sa.name,
            subject: `New Order Request from ${tenantName} — ${b.order_type.replace(/_/g,' ')}`,
            bodyText: `A new order has been placed by ${tenantName}.\n\nType: ${b.order_type}\nDetails: ${b.description}\n\nLog in to review it.`,
            bodyHtml: `<p>A new order has been placed by <strong>${tenantName}</strong>.</p>
              <p><strong>Type:</strong> ${b.order_type.replace(/_/g,' ')}<br>
              <strong>Details:</strong> ${b.description}</p>
              <p>Log in to the Super Admin panel to review and approve it.</p>`,
          });
        }
      } catch { /* non-fatal */ }

      return reply.status(201).send({ success: true, data: order });
    });

    // Super admin sets quoted amount / moves to under_review
    fastify.patch('/orders/:id/review', async (req, reply) => {
      if (!isSuperAdmin(req)) return reply.status(403).send({ error: 'Super admin only' });
      const { id } = req.params as any;
      const b = req.body as any;
      const rows = await db.query<TenantOrderRow & { tenant_name: string | null }>(
        `UPDATE tenant_orders SET
           status = 'under_review', quoted_amount = $1, currency = COALESCE($2, currency),
           admin_note = $3, reviewed_by = $4, reviewed_at = NOW(), updated_at = NOW()
         WHERE id = $5
         RETURNING *, (SELECT name FROM tenants WHERE id = tenant_orders.tenant_id) AS tenant_name`,
        [b.quoted_amount ?? null, b.currency ?? null, b.admin_note ?? null, userId(req), id],
      );
      if (!rows[0]) return reply.status(404).send({ error: 'Order not found' });
      return reply.send({ success: true, data: rows[0] });
    });

    // Super admin approves order
    fastify.patch('/orders/:id/approve', async (req, reply) => {
      if (!isSuperAdmin(req)) return reply.status(403).send({ error: 'Super admin only' });
      const { id } = req.params as any;
      const b = req.body as any;
      // Fetch order + tenant
      const orderRows = await db.query<TenantOrderRow & { entitled_features: string[]; active_modules: string[] }>(
        `SELECT o.*, t.entitled_features, t.active_modules
         FROM tenant_orders o
         JOIN tenants t ON t.id = o.tenant_id
         WHERE o.id = $1`,
        [id],
      );
      if (!orderRows[0]) return reply.status(404).send({ error: 'Order not found' });
      const order = orderRows[0];

      await db.withSuperAdmin(async (client) => {
        // Approve the order row
        await client.query(
          `UPDATE tenant_orders SET
             status = 'approved', payment_confirmed = $1, payment_ref = $2,
             admin_note = COALESCE($3, admin_note), reviewed_by = $4,
             reviewed_at = NOW(), updated_at = NOW()
           WHERE id = $5`,
          [b.payment_confirmed ?? false, b.payment_ref ?? null, b.admin_note ?? null, userId(req), id],
        );

        // If new_module or feature_request — provision the entitlements
        if (order.order_type === 'new_module' && order.requested_module) {
          const mod = (MODULE_CATALOG as readonly any[]).find(m => m.key === order.requested_module);
          if (mod) {
            const newFeatures = mod.features.map((f: any) => f.key);
            const currentFeatures: string[] = order.entitled_features ?? [];
            const currentModules: string[]  = order.active_modules ?? [];
            const mergedFeatures = Array.from(new Set([...currentFeatures, ...newFeatures]));
            const mergedModules  = Array.from(new Set([...currentModules,  order.requested_module]));
            await client.query(
              `UPDATE tenants SET entitled_features = $1, active_modules = $2 WHERE id = $3`,
              [JSON.stringify(mergedFeatures), mergedModules, order.tenant_id],
            );
          }
        }

        // If feature_request — provision individual features
        if (order.order_type === 'feature_request' && order.requested_features?.length) {
          const currentFeatures: string[] = order.entitled_features ?? [];
          const mergedFeatures = Array.from(new Set([...currentFeatures, ...order.requested_features]));
          await client.query(
            `UPDATE tenants SET entitled_features = $1 WHERE id = $2`,
            [JSON.stringify(mergedFeatures), order.tenant_id],
          );
        }

        // If storage_extension — extend the published retention policy's expires_at
        if (order.order_type === 'storage_extension' && order.requested_days) {
          await client.query(
            `UPDATE recording_retention_policies SET
               expires_at = expires_at + ($1 * INTERVAL '1 day'),
               retention_days = retention_days + $1,
               last_warned_at = NULL,
               updated_at = NOW()
             WHERE tenant_id = $2 AND policy_status = 'published'`,
            [order.requested_days, order.tenant_id],
          );
        }
      });

      // Notify the tenant admin who placed the order
      try {
        const requester = (await db.withSuperAdmin(async (c) => {
          const r = await c.query<{ email: string; name: string }>(
            `SELECT email, name FROM users WHERE id = $1`, [order.requested_by],
          );
          return r.rows;
        }))[0];
        if (requester) {
          await sendSystemEmail({
            to: requester.email,
            toName: requester.name,
            subject: 'Your order has been approved',
            bodyText: `Good news! Your ${order.order_type.replace(/_/g,' ')} order has been approved.${b.admin_note ? `\n\nNote from admin: ${b.admin_note}` : ''} Log in to see the changes.`,
            bodyHtml: `<p>Good news! Your <strong>${order.order_type.replace(/_/g,' ')}</strong> order has been approved.</p>${b.admin_note ? `<p><em>${b.admin_note}</em></p>` : ''}<p>Log in to see the updated access.</p>`,
          });
        }
      } catch { /* non-fatal */ }

      return reply.send({ success: true });
    });

    // Super admin rejects
    fastify.patch('/orders/:id/reject', async (req, reply) => {
      if (!isSuperAdmin(req)) return reply.status(403).send({ error: 'Super admin only' });
      const { id } = req.params as any;
      const b = req.body as any;
      const rows = await db.query<TenantOrderRow & { req_by: string | null }>(
        `UPDATE tenant_orders SET
           status = 'rejected', admin_note = $1, reviewed_by = $2,
           reviewed_at = NOW(), updated_at = NOW()
         WHERE id = $3
         RETURNING *, (SELECT requested_by FROM tenant_orders WHERE id = $3) AS req_by`,
        [b.admin_note ?? null, userId(req), id],
      );
      if (!rows[0]) return reply.status(404).send({ error: 'Order not found' });

      // Notify requester
      try {
        const requester = (await db.withSuperAdmin(async (c) => {
          const r = await c.query<{ email: string; name: string }>(
            `SELECT email, name FROM users WHERE id = $1`, [rows[0].requested_by],
          );
          return r.rows;
        }))[0];
        if (requester) {
          await sendSystemEmail({
            to: requester.email,
            toName: requester.name,
            subject: 'Your order request was not approved',
            bodyText: `Your ${rows[0].order_type?.replace(/_/g,' ')} order was not approved at this time.${b.admin_note ? `\n\nReason: ${b.admin_note}` : ''} Please contact support if you have questions.`,
            bodyHtml: `<p>Your <strong>${rows[0].order_type?.replace(/_/g,' ')}</strong> order was not approved at this time.</p>${b.admin_note ? `<p><strong>Reason:</strong> ${b.admin_note}</p>` : ''}<p>Please contact support if you have questions.</p>`,
          });
        }
      } catch { /* non-fatal */ }

      return reply.send({ success: true, data: rows[0] });
    });

    // Tenant admin cancels own pending order
    fastify.patch('/orders/:id/cancel', async (req, reply) => {
      if (!isTenantAdmin(req)) return reply.status(403).send({ error: 'Tenant admin required' });
      const { id } = req.params as any;
      const rows = await db.query<TenantOrderRow>(
        `UPDATE tenant_orders SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND status = 'pending'
         RETURNING *`,
        [id, tenantId(req)],
      );
      if (!rows[0]) return reply.status(404).send({ error: 'Order not found or not cancellable' });
      return reply.send({ success: true, data: rows[0] });
    });
  };
}
