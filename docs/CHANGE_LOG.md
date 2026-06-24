# CHANGE LOG
_Most recent at top. Treated as the primary record for development tracking._

---

## Change Log - 2026-06-24 (continued)

### Fixed
**Dashboard — ops-dashboard unblocked for all roles**
- Root cause: `requireFeature('analytics')` was gating the home-screen dashboard behind a feature flag (`settings.features.analytics = false`). Every user hit a 402 and saw a permanent spinner.
- Fix: ops-dashboard now uses `dashPreHandler` (scope check only, no feature flag). Analytics reports/exports remain feature-gated. The home screen is core product, not an analytics add-on.
- Fix: `owner_id` ambiguous column reference in `recentActivities` JOIN query — qualified as `a.owner_id`.
- Fix: `isManager` flag was false for managers with no direct reports. Now explicitly includes `role === 'manager'` in the check.
- Affected roles: Manager dashboard (Team Ticket Dashboard, leaderboard, bot stats) and all other roles now load correctly.

---

## Change Log - 2026-06-24

### Added

**SLA Module — Step 1: Policy Editor (Full CRUD)**
- Managers can now create, edit, and delete SLA policies directly inside the CRM.
- Each policy defines: priority tier (Urgent/High/Medium/Low), first-response deadline, resolution deadline, and multi-level escalation schedule (reminder → L1 supervisor → L2 admin).
- Escalation steps are configurable: set % threshold, notification label, and recipient scope (assigned agent / supervisors & managers / tenant admins).
- SLA policy auto-assigns to new tickets based on priority at creation time.
- SLA policy re-evaluates and reassigns when ticket priority changes.
- Files: `packages/api/src/routes/tickets.ts` (POST/PATCH/DELETE `/api/v1/tickets/sla-policies/:id`), `packages/frontend/src/pages/TicketSla.tsx` (new page).

**SLA Module — Step 2: Business Hours**
- Each SLA policy can be scoped to business hours only.
- Manager picks active days (Mon–Sun) with per-day on/off toggle in a visual editor.
- SLA clock only ticks during enabled days — tickets raised outside hours don't count against SLA.
- Benchmarked against Zendesk/Freshdesk: matches global standard.
- DB: `business_hours_only boolean`, `business_hours_schedule jsonb` on `sla_policies`.

**SLA Module — Steps 4–6: Holiday Calendar, First Reply Time, Smart Policy Matching**
- **Holiday Calendar** (Step 4): Managers can now define public holidays at workspace level. SLA clocks pause on holiday dates — applies across ALL SLA policies. Holidays can recur yearly (e.g. Eid, national holidays). New tab on the SLA page. API: `GET/POST/PATCH/DELETE /api/v1/tickets/holidays`. DB: new `sla_holidays` table with RLS and `UNIQUE(tenant_id, date)` constraint. Benchmarked: matches Zendesk/Freshdesk standard.
- **First Reply Time** (Step 5): New `first_replied_at` column on `tickets` table. Stamps when the agent posts their first public reply — tracked independently of the SLA `first_response_at` timer. Useful for pure performance metrics without SLA distortion.
- **Smart Policy Matching** (Step 6): SLA policies now have `match_conditions` (jsonb: channels, departments, tags). When creating a ticket, the system picks the most specific matching policy — most conditions set = highest priority, with fallback to least-specific policy. Manager can set conditions via comma-separated fields in the policy editor. DB: `match_conditions jsonb NOT NULL DEFAULT '{}'` on `sla_policies` (migration 030).
- Migration: `030_sla_enhancements.sql` applied.

**SLA Module — Step 3: Pause on Pending**
- New toggle on each SLA policy: "Pause SLA when waiting for customer."
- When a ticket is set to Pending/Waiting status, the SLA clock pauses automatically; it resumes when the customer replies.
- Prevents agents being penalised for time spent waiting on the customer — standard in Zendesk, Freshdesk, Jira Service Management.
- DB: `pause_on_pending boolean NOT NULL DEFAULT false` on `sla_policies` (migration applied).
- Frontend: checkbox in the policy editor + amber "⏸ Pauses on pending" badge on policy cards.

**Entitlements & Licensing System (Phases 1, 2a, 2b)**
- Phase 1: Super admin provisions entitlements per workspace at creation time (which modules/features each tenant is licensed for). Stored in `entitled_features` table.
- Phase 2a: Roles screen ceiling — tenant admin cannot grant permissions beyond what the workspace is licensed for. Unlicensed modules are hidden from the Roles editor.
- Phase 2b: Sidebar nav gated by entitlement — unlicensed modules don't appear in the navigation. API routes protected by `requireEntitlement` guard.
- Files: `packages/api/src/routes/roles.ts`, `packages/frontend/src/pages/Roles.tsx`, `packages/frontend/src/App.tsx`.

**Super Admin Improvements**
- Password change blocked for super_admin account in Personal Settings (security hardening).
- Super admin sidebar operational with working Reports section.
- Files: `packages/frontend/src/pages/PersonalSettings.tsx`, `packages/api/src/routes/super-admin.ts`.

### Modified
- `packages/api/src/routes/auth.ts` — auth hardening, change-password improvements.
- `packages/api/src/routes/settings.ts` — team query fixes.
- `packages/frontend/src/hooks/useRole.ts` — role detection improvements.
- `packages/frontend/src/pages/Login.tsx` — login UX fixes.

### Fixed
- SLA INSERT param count corrected (14 params after adding `pause_on_pending`).
- SLA PATCH correctly shifts param indices after adding `pause_on_pending` column.

### Backlog Items Closed
- Condition-based SLA auto-assignment on ticket create ✅ (was pending — now done via `findSlaPolicy()`).
- Condition-based SLA re-assignment on priority change ✅ (added to PATCH handler).

---

## Change Log - 2026-06-23

### Added
- Established the three source-of-truth documents: `MASTER_PRODUCT_DOCUMENT.md`, `CHANGE_LOG.md`, `BACKLOG.md`.

### Modified
- None (operational only — started local dev servers).

### Removed
- None.

### Fixed
- None.

_Operational note: ran the solution locally — API on `:3000` (healthy) and frontend on `:5173`
(login screen renders, manager login verified). No code changed._

---

## Change Log - 2026-06-22

### Added
- **Separation of duties:** tenant admin blocked from all operational + billing API routes (gateway in `server.ts`); admin nav hidden; home redirects to Settings; call widget hidden.
- **Record visibility helper** `packages/api/src/lib/visibility.ts` (`getVisibleUserIds`, `ownerScopeSql`) — hard filter by line-manager hierarchy; applied to contacts, deals (list/board/pipeline value), activities, and (companion session) companies, opportunities, team-messages, ticket-analytics.
- **Sales ticket → deal:** migration `024_ticket_deal_link.sql` (`tickets.deal_id`); auto-convert on accept; idempotent `POST /tickets/:id/convert-to-deal`; frontend **Convert to Deal** button.
- **System email (SendGrid):** onboarding temp-password email + admin password reset/re-send.
- **TAT countdown** on the customer record (Contact → Tickets tab).
- Light-theme pitch deck (`Reducing-Call-Centre-Workload.pptx/.pdf`) + full solution handover doc.
- Pipeline backfill helpers + smoke-test scripts (companion session).

### Modified
- Both billings (subscription + customer invoicing) moved off the admin role to a Finance/Sales permission.
- Activities `today`/`overdue` switched from "managers see all" to hierarchy-scoped visibility.
- Docs reorganised under `docs/22062026/`.

### Removed
- "Routing & SLA" settings tab hidden from the super-admin view.

### Fixed
- **Departments 500:** queries referenced a non-existent `users.department_id`; rewired to link by `department` name/type. List, single-view, assign, remove all work.
- Earlier: sales dashboard $0 / partial-payment tracking; bcryptjs vs bcrypt; `users.is_active`.
