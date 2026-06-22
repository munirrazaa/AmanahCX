# Developer Handoff — Tenant Licensing & Onboarding Overhaul

**Period covered:** 2026-06-20 → 2026-06-22
**Author:** platform team (via Claude Code)
**Scope:** super-admin onboarding, module/feature entitlements, role-permission ceiling, runtime enforcement, plus sales-invoice fixes.

---

## 1. TL;DR for the developer

We introduced a **Salesforce-style two-layer access model**:

| Layer | Owner | Question it answers | Where it lives |
|-------|-------|---------------------|----------------|
| **Entitlement** | Super admin | *What did the customer buy?* (modules + feature-areas) | `tenants.entitled_features`, `tenants.active_modules` |
| **Permissions** | Tenant admin | *Who may view/create/edit/delete inside what was bought?* | `roles.permissions` (granular booleans) |

Enforcement is now **three deep** on protected routes:
1. `requireEntitlement(...features)` — is the workspace licensed for the feature?
2. `requireScope(...)` — does the user's role tier allow it? (pre-existing)
3. `requirePermission(key)` — does the user's role grant this exact action?

Plus the **Roles screen** and the **sidebar nav** are filtered to the licensed feature set.

---

## 2. Database changes

### Migration `023_tenant_entitlements.sql`
`packages/core/src/database/migrations/023_tenant_entitlements.sql`

```sql
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS active_modules    TEXT[] NOT NULL DEFAULT ARRAY['crm'],
  ADD COLUMN IF NOT EXISTS entitled_features JSONB  NOT NULL DEFAULT '[]'::jsonb;
```

- `active_modules` — top-level licensed modules (e.g. `['crm','sales']`). Added `IF NOT EXISTS` because some envs had it ad-hoc.
- `entitled_features` — the agreed feature-area allow-list (e.g. `["crm.contacts","sales.invoices"]`). **This is the entitlement source of truth.**

> ⚠️ **Migration drift note:** the ordered runner (`npm run db:migrate`) is currently blocked on `008_sales_invoicing.sql` in the dev DB (objects exist but the row is missing in `_migrations`). 023 was applied directly and recorded. Reconcile `_migrations` before relying on the ordered runner again.

---

## 3. Backend changes

### 3.1 Licensing catalog — `packages/api/src/routes/super-admin.ts`
- `MODULE_CATALOG` is now the **single source of truth**; each module carries a `features[]` list (feature-areas). Adding a module here automatically flows into onboarding + the entitlement filters.
- Removed `ticketing`, `voice`, `voicebot` from the catalog; added `sales` with its feature-areas.
- New exports: `ALL_FEATURE_KEYS`.
- `CreateTenantSchema` extended: `adminPassword?` (optional), `entitledFeatures: string[]`.
- `generateTempPassword()` helper (readable, 3×4-char blocks).
- `POST /super-admin/tenants` now:
  1. validates `entitledFeatures` against the catalog and **derives** `active_modules` from them (`crm` always included);
  2. stores `active_modules` + `entitled_features`;
  3. **provisions the tenant admin** (`users` row, `role='tenant_admin'`, `is_active=true`, hashed password) — generates a temp password if none supplied and returns it **once** in the response (`data.tempPassword`);
  4. **auto-seeds the 4 system roles** (`SYSTEM_ROLES_SEED` × `defaultPermissions()`) — the super admin no longer sets role permissions.

### 3.2 Role permission catalog + ceiling — `packages/api/src/routes/roles.ts`
- `MODULE_DEFS` extended with **Sales permission modules**: `invoices`, `billing_contacts`, `payments`, `sales_reports`, `invoice_templates`, `sales_settings` (each with read/create/edit/delete-style actions). These are now **assignable** in the Roles UI.
- New `MODULE_LICENSE_REQUIREMENT` map: permission-module key → licensing feature key(s).
- New `entitledModuleDefs(entitledFeatures)` — filters `MODULE_DEFS` to the licensed set. **Legacy tenants with empty `entitled_features` see everything** (no regression).
- `GET /api/v1/roles/modules` now reads `tenants.entitled_features` and returns `entitledModuleDefs(...)` → the tenant admin can only build roles within what was sold.

### 3.3 Guards — `packages/api/src/middlewares/auth.middleware.ts`
Two new middlewares:

```ts
requireEntitlement(...features: string[])  // 403 NOT_LICENSED unless the tenant
                                           // is entitled to ≥1 feature (empty = allow)

requirePermission(key: string)             // 403 FORBIDDEN unless the user's role
                                           // grants the exact action key.
                                           // admin/super_admin bypass; ABSENT key = allow (legacy-safe)
```

### 3.4 Sidebar nav gating — `packages/api/src/routes/modules.ts`
- `NAV_FEATURE_MAP` (nav path → licensing feature) + `filterByEntitlement()`.
- `GET /api/v1/modules` hides nav items whose feature isn't entitled, and drops empty modules. Applies to tenant_admin and regular roles; super_admin unaffected. Legacy/empty entitlement → show all.

### 3.5 Sales routes — entitlement + granular permission
Files: `packages/api/src/routes/sales/{invoices,billing-contacts,sales-settings,invoice-templates}.ts`
- Module-level `fastify.addHook('preHandler', requireEntitlement('sales.<feature>'))`.
- Each route's `preHandler` is now an array adding `requirePermission('<module>:<action>')`, e.g.:
  - `GET /sales/invoices` → `invoices:read`
  - `POST /sales/invoices` → `invoices:create`
  - `PATCH /sales/invoices/:id` → `invoices:edit`
  - `DELETE /sales/invoices/:id` → `invoices:delete`
  - `POST /sales/invoices/:id/send` → `invoices:send`
  - `POST /sales/invoices/:id/payments` → `payments:record`
  - billing-contacts / sales-settings / invoice-templates mapped equivalently.

### 3.6 Bug fixes found along the way
- `await import('bcrypt')` → `(await import('bcryptjs')).default` in `super-admin.ts` (3 sites). `bcrypt` isn't a dependency; this also **repaired the existing Add-User / Edit-User handlers** which were silently broken.
- `users` INSERT used a non-existent `status` column → changed to `is_active = true`.
- **Sales dashboard** (`routes/sales/sales-dashboard.ts`): added missing `.then(r => r.rows)` on all 5 queries; replaced references to non-existent `amount_due`/`amount_paid` columns with `i.total - COALESCE(p.paid,0)` via a `LEFT JOIN (SELECT invoice_id, SUM(amount) … GROUP BY invoice_id)`; fixed table-alias-less `FILTER (WHERE status …)` → `i.status`.
- **Invoice partial payments** (`routes/sales/invoices.ts`): `rowToInvoice()` now computes `amountPaid`/`amountDue` and derives status — `partially paid` when `0 < amountPaid < total`, `paid` when `amountPaid >= total`. LIST query LEFT-JOINs `invoice_payments` so the list view shows the same status as the detail view.

---

## 4. Frontend changes

### 4.1 `packages/frontend/src/pages/SuperAdmin.tsx`
- `ALL_MODULES` — removed ticketing/voice/voicebot; added sales.
- **Create Workspace modal** reworked from 3 steps to **2**:
  - **Step 1** — workspace + admin details, plus an **Admin Password** block (auto-generate toggle; manual field when off).
  - **Step 2** — module → feature-area selection **tree** (fetched from `GET /super-admin/modules`); Core CRM is "Always On" and pre-selected; live "N modules · M features" counter.
  - **Step 3 (role permissions) removed** — backend auto-seeds defaults.
  - On success: a **one-time credentials screen** (workspace, admin email, temp password) with a "shown once" warning.
- `TenantActions` → Licensed Modules panel now shows a read-only **Agreed Features** chip list (`entitled_features` mapped to labels via the catalog).

### 4.2 `packages/frontend/src/App.tsx`
- Super admin **landing fix**: `homePath = isSuperAdmin ? '/super-admin' : '/dashboard'`; `/dashboard` redirects super admins to `/super-admin`; catch-all uses `homePath`. Super admins no longer see the operational ticket/voice dashboard.

---

## 5. How to test

```bash
# 1. ensure column exists (idempotent)
#    psql: SELECT column_name FROM information_schema.columns
#          WHERE table_name='tenants' AND column_name='entitled_features';

# 2. create a workspace via Super Admin → Tenants → New Workspace
#    license e.g. CRM + Sales Invoices only; capture the temp password.

# 3. log in as the new tenant admin:
#    - Sidebar SALES shows only Dashboard + Invoices (others hidden)
#    - Roles screen shows only licensed modules incl. Invoices CRUD
#    - API: GET  /api/v1/sales/invoices  → 200
#           GET  /api/v1/sales/settings  → 403 NOT_LICENSED
```

Guard logic is pure and unit-checkable — see branch table:
`requirePermission`: admin→allow, `read=true`→allow read, `create=false`→403, absent key→allow.
`requireEntitlement`: licensed feature→allow, unlicensed→403 NOT_LICENSED, empty entitlement→allow.

**Super-admin login (dev):** workspace `demo`, `admin@demo.com` / `Demo1234!`.
**Note:** `/super-admin` is API-proxied on full-page loads — navigate client-side in the SPA.

---

## 6. Known gaps / follow-ups

1. **Email + password lifecycle (next task):** temp password is currently shown once on screen only. To do: email it to the customer on creation, and add a **regenerate/reset** flow for the tenant admin credential.
2. **Nav map coverage:** `NAV_FEATURE_MAP` currently covers CRM + Sales paths. Extend if more modules gain feature-level licensing.
3. **Super-admin "Manage Roles" modal** still calls `/api/v1/roles/modules`, which filters by the *super admin's own* tenant entitlement (demo = empty → shows all). If you want it to reflect the *target* tenant, pass the tenant id and filter by that tenant's `entitled_features`.
4. **Migration runner drift** (see §2) should be reconciled.
5. CRM routes still enforce at role-tier (`requireScope`) rather than granular keys — only Sales was tightened. Align if you want symmetric granular enforcement everywhere.
