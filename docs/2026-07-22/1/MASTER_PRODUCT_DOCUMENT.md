# MASTER PRODUCT DOCUMENT
**AI Operations Platform — Multi-Tenant CRM, Contact-Centre & Sales Suite**
_Single source of truth for system requirements & behaviour. Update only affected sections on each change._

Last updated: 2026-07-22 — Full 188-row Test-Plan execution across 17 modules (145 pass, 15 real issues found and logged, 2 fixed live) — see 2.15 below. Previous: 2026-07-21 (2) — Custom Fields improvements, Governance consolidation, Push-to-Production built, 8-phase role-by-role Dashboard Audit (every role checked, several real bugs found and fixed) — see 2.14 below. Previous: 2026-07-21 (monorepo TypeScript build fixed across every backend package/module, no schema change — see 2.13 below). Previous: 2026-07-20 (Push 2 — critical cross-tenant Voice Bot identity leak + minutes enforcement fixed, see 2.12 below). Previous: 2026-07-20 (sector fields backfilled tenant-wide, full dept/queue/agent test coverage built and verified, API crash-resilience fix — see 2.11 below). Previous: 2026-07-18 (voice-bot ticket-type bug + cross-department SLA escalation leak, both fixed — see 2.10 below). Previous: 2026-07-17 push 2 (shared SMS gateway added; entitlement-drift bug fixed for real — see 2.9 below; voice bot cost tracking added; Nadia hold-message during ticket creation). Previous: 2026-07-17 push 1 (full role-by-role toggle/save audit across all 5 roles — see 2.8 below; also see CHANGE_LOG.md for the same date). Previous: 2026-07-12 (live phone-test fixes: quick-capture exemption from sector-required contact fields; voice-capture stop reliability; card-scan name/mobile accuracy; My Tasks quick-action buttons). Previous: 2026-07-11 (Field Mobile App: recovered from stash, re-tested against Supabase cloud backend; field-visit flow — assigned tasks, GPS check-in/complete, remarks, customer email; AI card scan + voice capture EN/UR/PA; offline queue; deal photo attachments). Previous: 2026-07-10 push 3 of 3 (agent dashboard 403 fixed at root cause; see AmanahCX-Roles-and-Flow.html v6.0). Push 2 of 3: reference document restructure + live Dashboard/Reports audit. Push 1 of 3: critical data-isolation fix, auto-contact-creation on ticket create, manager queue visibility, deployment pipeline sync.

## 2.15 Full Test-Plan Execution — 188 rows across 17 modules (2026-07-22)
Ran every remaining Pending row in `AmanahCX-Test-Plan.csv` (188 total): 145 Pass, 15 confirmed real
issues, 28 genuinely blocked and logged to the To-Do list (billing-gated features not licensed on any
test tenant, or needing approval to create new test tenants/real phone calls).

**Fixed live:** the Contacts `/timeline` endpoint (linked activities/tickets tab) was completely broken —
a SQL type mismatch plus two stale column references; corrected and verified. Company-filter on Contacts
(`?companyId=`) was entirely unimplemented server-side — added, verified, and confirmed it also fixes the
Companies page's linked-contacts tab which relied on the same missing filter.

**Found and logged, not fixed (flagged per user instruction for dedicated review):**
- Cross-department ticket access: an agent can view/edit any other agent's ticket by direct ID regardless
  of department, queue, or assignment — the list correctly scopes, but the single-ticket GET/PATCH routes
  only check tenant, not ownership. HIGH PRIORITY.
- Module re-enable bug: turning a licensed module off then back on doesn't restore it to navigation.
  Root-caused to a genuine key mismatch (`voice` in the module registry vs `voice_bot` in the newer
  licensing/entitlement system) — confirmed via direct database inspection and a full server restart,
  ruling out caching. HIGH PRIORITY.
- No role can create a new ticket queue, or delete a contact — both are permission-architecture gaps
  where the only role with the theoretical right (tenant_admin) is separately blocked from operational
  writes, and no other role has the permission at all.
- Deleting a company with a linked contact throws a raw error instead of a clear message (a real database
  safety check working correctly, just not surfaced nicely) — also raises a design question (auto-unlink
  vs. block) that needs a decision.
- Tenant isolation was specifically stress-tested (10/10 checks) given the cross-department finding above
  — confirmed fully solid; the cross-department gap does not extend across tenant boundaries.

Full findings, evidence, and reproduction steps are in `Desktop/AmanahCX/Bugs/AmanahCX-Bug-Report.html`
and `Desktop/AmanahCX/To do/AmanahCX-To-Do-List.html`.

---

## 2.14 8-Phase Role-by-Role Dashboard Audit + Custom Fields/Governance improvements (2026-07-21, Push 2)
Systematic click-through audit of every page as every role (tenant_admin, operations_admin, manager,
policy_admin, agent, collaborator, viewer, super_admin) on Haier Electronics (ecommerce). Found and fixed:
`operations_admin`/`collaborator` were entirely dead roles (uncreatable anywhere); three roles were shown a
wrong, agent-styled dashboard under a wrong label; a rank-vs-permission mismatch let `policy_admin` see a
write button it had no permission to use; `viewer`/`policy_admin` had no case in the backend's
`defaultPermissions()` so both silently inherited full agent write access instead of read-only/governance-only;
`GET /api/v1/sector` was wrongly scoped to manager+, breaking sector-aware labels for every agent tenant-wide;
one real user's stored permissions were corrupted (`tickets:"none"` despite having real assigned tickets); raw
module-key labels ("Crm", "Voice_bot") were fixed in four places. Confirmed but not fixed (logged for a
dedicated backend pass): `GET /api/v1/tickets/stats` and the manager-team-dashboard endpoint don't apply
per-role visibility scoping consistently with the ticket list endpoint. Also this push: Push-to-Production
mechanism fully built (still parked pending 2 deploy-hook URLs); Custom Fields alphabetical ordering, 14
sector-gap fields added across 7 sectors, Company custom fields wired end-to-end; Data & Privacy/SLA
Policies/Milestones consolidated into one Governance hub. Full detail: `CHANGE_LOG.md` 2026-07-21 (2).

## 2.13 Monorepo TypeScript Build Fixed (2026-07-21)
Full type-check now passes with zero errors across `packages/api`, `packages/core`, `packages/shared`, and
all 11 `modules/*` packages — done via an isolated branch + safety tag + full backup, verified clean, then
fast-forward merged. Root causes: missing per-module `tsconfig.json` files and a `rootDir` conflict between
`packages/api`/`packages/core`. Byproduct: found and fixed two previously-invisible bugs the broken build had
been hiding (wrong field reference in email-sender tracking, wrong event-argument order breaking downstream
activity routing). No schema change, no frontend behavior change. Full detail: `CHANGE_LOG.md` 2026-07-21.

## 2.12 Critical: Cross-Tenant Voice Bot Identity Leak + Minutes Enforcement (2026-07-20, Push 2)
User-reported: Haier Electronics' voice bot introduced itself as HBL Microfinance Bank's Complaint and
Resolution specialist. Root cause: `services/nadia-voice-agent/src/config.py` hardcoded a real client's (HBL
Microfinance Bank) actual confidential complaint-handling script as the fallback for ANY tenant with an empty
`system_prompt` — a live audit found all 8 tenants, every sector, exposed to this. Fixed by removing the
fallback entirely; empty-`system_prompt` tenants now safely use the existing generic, brand-neutral base
prompt instead. Haier's own data gap (assigned template, but `system_prompt` itself empty) also fixed by
re-running the assignment. Separately, confirmed and fixed a second issue the same report raised: `GET
/livekit/minutes-status` treated "no minutes quota row" as unlimited access rather than zero — reversed so
any tenant with no allocation (or an exhausted one) has every call routed to a human, enforced identically
for every tenant in every sector. Full detail: `CHANGE_LOG.md` 2026-07-20 (Push 2).

## 2.11 Sector Fields Backfilled + Full Dept/Queue Test Coverage + API Crash Resilience (2026-07-20)
Found while doing a full cross-sector audit (sector field seeding, ticket routing, agent-accept flow) across
all 8 tenants at the user's request. (1) Only Haier Electronics had its sector's full custom-field set — the
other 7 tenants were missing most company/deal/ticket fields because the sector config had been expanded
after those tenants were created, with no backfill mechanism. Re-ran the idempotent seeding logic against
every tenant's current sector config — 183 fields inserted, all 8 tenants now verified matching. (2) Built out
Sales/Support/Complaints + Field Sales staff (manager+agent each) in the 6 single-admin demo tenants and
Haier's missing departments, wired into their department's ticket queue, and live-tested routing +
accept end-to-end across every tenant — including discovering the pre-existing `demo` tenant itself had never
been linked to its own department queues. (3) Found and fixed a real reliability bug: a transient DB network
blip crashed the entire API process (not just the failing request) — added top-level uncaught-exception
handling so the server survives instead. Full detail: `CHANGE_LOG.md` 2026-07-20.

## 2.10 Voice-Bot Ticket-Type Bug + Cross-Department SLA Escalation Leak (2026-07-18)
Found while auditing the new Developer Orientation doc's end-to-end flow diagram against real code. (1) Nadia
voice-bot tickets (`createComplaintFromStructured`, `voice-bot.ts`) correctly routed to the right queue by a
sales/inquiry/complaint keyword classification, but the persisted `ticket_type` column was hardcoded to the
literal `'complaint'` regardless — so a sales enquiry captured by voice could never satisfy the
`ticket_type === 'sales'` check that auto-creates a pipeline deal on accept (§4.3). Fixed to persist the
actual computed type. (2) SLA breach escalation (`runSlaWorker`, `tickets.ts`) notified every
manager/tenant_admin tenant-wide regardless of department, breaking the department-isolation model enforced
everywhere else via the reporting tree (`lib/visibility.ts`). Added `getEscalationTargets()`: L1 → the
assignee's own line manager, L2 → that manager's manager, falling back to tenant_admin only when the chain
runs out. No schema change; both fixes are pure application logic. Full detail: `CHANGE_LOG.md` 2026-07-18.

## 2.9 Shared SMS Gateway + Entitlement-Drift Fix + Voice Bot Cost Tracking (2026-07-17 push 2)
Three separate additions in one push. (1) The `settings.features` entitlement flag documented as a drift risk in §2.7 turned out to still actively gate 3 real routes (Analytics, Webhooks, Voice-Bot calling) — checked live data and found 7 of 24 tenants were correctly licensed but silently blocked because the flag was never kept in sync; replaced all 3 checks with the one actively-maintained `active_modules` source. (2) Tenants can now use AmanahCX's own shared SMS gateway (opt-in per tenant via Super Admin) instead of being required to bring their own gateway account — needs a real provider account before it can send anything live. (3) Voice bot minutes now have a cost-per-minute rate and a monthly cross-tenant cost report. Full detail: `CHANGE_LOG.md` 2026-07-17 (Push 2), `BACKLOG.md` items 0b, 10a.

## 2.8 Role-Based Nav Visibility — Systemic Bug Found & Fixed (2026-07-17)
A single boolean (`isAdmin`, meaning tenant_admin OR super_admin) was used in several sidebar-visibility checks that actually meant "an admin-permission user who isn't tenant_admin" — it never excluded super_admin, who has zero workspace access by design. This showed Super Admin 4 menu items (Roles, Integrations, Sales & Invoices, notifications) that always failed. Same audit also found and fixed: Super Admin's own Billing tab missing its database table; a multi-field workspace-settings save that always 500'd; a cross-account react-query cache leak on login/logout; and two settings screens (Notification Preferences, Active Sessions) that had no backend at all despite looking fully built. Full detail: `CHANGE_LOG.md` 2026-07-17, `BACKLOG.md` item 0d.

## 2.6 Dashboard Route — Not Gated by Module Licensing (fixed 2026-07-10)
The home dashboard (`GET /api/v1/analytics/ops-dashboard`) is intentionally available to every role regardless of which modules a tenant has licensed — it's the universal home screen, not a paid Analytics feature. A live audit found this had regressed: the route required an `analytics:read` scope that reads the same permission value tenant module-licensing forces to `"none"` for unlicensed tenants, silently reintroducing exactly the gate the route's own code comment says shouldn't exist. Fixed by removing the scope requirement entirely. See `BACKLOG.md` item 0a.

## 2.7 Known Open Issue — Three Unsynchronized Entitlement Systems (found 2026-07-10, not fixed)
`tenant.settings.features.<name>` (boolean flags), `tenant.active_modules` (licensing array), and `user.permissions.<module>` (per-user level) all separately gate feature access and are not kept in sync with each other. Confirmed concretely during the 2.6 fix: a tenant's `active_modules` correctly excluded Analytics, but `settings.features.analytics` still permitted a paid analytics endpoint to return data. Needs a dedicated audit of every route's gating mechanism before consolidating to one authoritative system. See `BACKLOG.md` item 0b.

---

## 1. Overview
A multi-tenant SaaS suite hosting many isolated customer organisations ("tenants") on one system.
Each tenant combines CRM, a contact centre (with an AI voice agent), sales & invoicing, analytics,
and team collaboration.

- **Frontend:** React + TanStack, Vite (`packages/frontend`)
- **API:** Fastify + GraphQL/Mercurius, Zod, JWT (`packages/api`)
- **DB:** PostgreSQL with Row-Level Security; 25+ migrations (`packages/core`)
- **Voice:** LiveKit ("Nadia" agent, self-hosted at `services/nadia-voice-agent/` — self-hosted
  Whisper STT + Uplift AI TTS + gpt-4o-mini, built 2026-07-13 as the Pakistani-market
  alternative to Retell AI/Vapi's US-market pricing; SIP trunk pending from Telecard) ·
  **Email:** SMTP / SendGrid / MS365

## 2. Roles & Access Control (three layers + separation of duties)
1. **Entitlement (what is licensed):** super-admin licenses modules + features per tenant
   (`tenants.entitled_features`). Unlicensed features hidden in nav and refused by API.
2. **Roles (who may act):** tenant admin assigns create/edit/delete per role (Admin, Manager,
   Agent, Viewer + custom). Five system roles auto-seeded, including the **Policy Admin** governance role.
   - `policy_admin` (ROLE_RANK 32) — independent governance role, ranked ABOVE Manager (30) so no
     operational role can ever manage a compliance/policy officer. Only role permitted to write SLA policies.
     (Corrected 2026-07-10 — this was previously and incorrectly documented as rank 25, below Manager.)
     Has `governed_departments` scope (stored in JWT); if set, can only manage policies for those departments.
     Managers and tenant_admin are hard-blocked from SLA writes. Policy Admin does NOT appear in operational
     queues and is invisible to the rest of the org except the SLA Policies page.
3. **Record visibility (whose records):** hard filter by line-manager tree
   (`getVisibleUserIds`, `packages/api/src/lib/visibility.ts`) — agent = own; line manager = team;
   manager = department. Applies to contacts, deals, activities, companies, opportunities, dashboards,
   and tickets. Department-scoped: Support Manager sees only Support tickets; Complaints Manager sees
   only Complaints tickets; Sales Manager sees only Sales tickets.
   **Cross-dept originator view:** an agent who creates a ticket routed to another department retains
   read-only visibility after that ticket is accepted (`accepted_at IS NOT NULL`). Writes return
   `ORIGINATOR_READONLY` (403). Enforced at API level, signalled in the UI with a "👁 View only" badge.
4. **Separation of duties:** `tenant_admin` is administrative-only — **blocked** from all operational
   + billing routes (gateway in `server.ts`); home is Settings. Billing (subscription + invoicing)
   belongs to a Finance/Sales role, never the admin.

## 3. Modules (capability surface)
Core CRM (contacts, companies, deals, activities) · Sales & Invoicing (invoices, billing-contacts,
payments, dashboard, templates, settings) · Ticketing/Contact-Centre (queues, routing, SLA/TAT, CSAT,
milestones) · Voice + Voice-bot (Nadia/LiveKit) · Email inbox · Analytics & Reports (Ops Dashboard KPI
strip: CSAT, SLA %, avg resolution, avg first response; Reports hub: 6 manager + 4 agent CSV reports)
· Team Messaging · Integrations (connectors, webhooks, API keys) · Departments & Opportunities ·
Super-Admin console.

## 3.1 Department Structure (standard)
Every operational department has its own manager — industry standard for contact-centre CRMs:

| Department | Manager | Agents |
|---|---|---|
| Support | Support Manager | Support Agents |
| Complaints | Complaints Manager | Complaints Agents |
| Sales | Sales Manager | Sales Agents |

Manager hierarchy is recursive: a manager-of-managers sees all tickets in their full sub-tree.

## 4. Key Workflows
### 4.1 Customer onboarding
Super-admin creates workspace (details+admin → modules+features) → first tenant admin provisioned with
one-time temp password → password e-mailed (SendGrid); super-admin can reset/re-send → system roles
seeded → tenant admin tailors roles, invites staff, sets each person's line manager & department.

### 4.2 Inbound handling (enquiry → resolution)
Customer calls → voice bot greets & understands → creates complaint / support / sales ticket →
smart routing to the right team → agent accepts (TAT/SLA starts) → worked through stages + milestones →
interval reminders + auto-escalation before breach → resolved → customer informed + CSAT survey.
Ticket + live status also appear on the customer's CRM record (Contact → Tickets tab, with TAT countdown).

### 4.4 SLA Policy Engine
Managers create SLA policies per priority tier (Urgent / High / Medium / Low). Each policy defines:
first-response deadline, resolution deadline, business hours scope (per-day toggle), pause-on-pending
toggle, match conditions (channels/departments/tags), and a multi-step escalation schedule
(reminder → L1 supervisor → L2 admin), each with a % threshold and recipient scope.

**Smart matching:** on ticket create, the system finds the most specific active policy matching
the ticket's priority + context (channel, department, tags). Most conditions set = wins.
Fallback to least-specific (catch-all) policy if no exact match.

**Holiday calendar:** tenant-level list of public holidays. SLA clocks pause on holiday dates
across all policies. Recurring holidays (yearly) supported.

**First reply time:** `tickets.first_replied_at` stamps the first agent public reply — separate
from the SLA `first_response_at` timer, used as a pure performance metric.

SLA policies and holiday calendar managed by **Policy Admins** at `/tickets/sla`.
Policy Admin is the only role with write access to SLA policies (managers and tenant_admin are blocked).
Each policy can be tagged to a department (`ticket_type`); a policy_admin with a `governed_departments`
scope can only manage policies for their assigned departments.

### 4.3 Sales ticket → pipeline deal
A `sales` ticket, on acceptance (or via manual **Convert to Deal** button), creates a linked deal in the
default pipeline (owner = handling agent; carries contact/company). Idempotent (`tickets.deal_id`).
Complaints keep the normal resolve→close lifecycle.

## 5. Data Model
25+ ordered migrations. Notable: `012_line_manager` (manager_id), `018_departments_and_opportunities`,
`023_tenant_entitlements`, `024_ticket_deal_link`, `025_default_departments`.
Users link to departments by `department`/`department_type` text (no `department_id` column).
`sla_policies` table: includes `business_hours_only`, `business_hours_schedule` (jsonb), `pause_on_pending` (bool).

## 6. Environments & Access
Repo: github.com/munirrazaa/AmanahCX (main). Frontend: Vercel (auto-deploy on push) · API: Railway (auto-deploy on push) ·
DB: PostgreSQL (Supabase pooler, TLS). App connects as a restricted, non-superuser role (`crm_app`) —
never as `postgres` — so tenant Row-Level Security policies are actually enforced (see §2.5).
Secrets in local `.env` only (git-ignored). Demo: workspace `demo`, super-admin `admin@demo.com`.

## 2.5 Tenant Data Isolation — Database Role (added 2026-07-10)
Tenant isolation is enforced by Postgres Row-Level Security policies scoped by `app.tenant_id`
(set per-transaction in `DatabaseClient.withTenant`). **This only works if the connecting database
role does not have `BYPASSRLS` or `SUPERUSER`** — either attribute causes Postgres to silently ignore
every RLS policy regardless of how correctly they're written. The app must always connect as a
restricted role (`crm_app`) with ordinary table privileges only. This was found broken in production
(the app was connecting as `postgres`, a `BYPASSRLS` role) and fixed 2026-07-10 — see `DATABASE_CHANGE_LOG.md`
and `CHANGE_LOG.md` (2026-07-10 entry) for full detail. Any future infrastructure change that touches
`DATABASE_URL` must preserve this — never point the live app at a superuser/BYPASSRLS connection string.

## 4.14 Auto-Contact-Creation on Ticket Creation (2026-07-10)
Ticket creation (manual form and voice-bot path) no longer requires selecting an existing contact
first. On submit, the API looks up an existing contact (by email for manual tickets, by phone for
voice-bot tickets); if found, the ticket links to it; if not found, a new contact is created
automatically. Matches Zendesk/Freshdesk/HubSpot inbound-ticket behaviour. Both entry points
(`POST /api/v1/tickets` and `POST /api/v1/tickets/from-voice`) share the same rule so a future
voice-bot integration (connected via webhook) gets identical customer-matching behaviour to the
manual form, not a separate implementation.

## 4.15 Manager Visibility of Unclaimed Tickets (2026-07-10)
Manager ticket-list visibility now includes unassigned, open tickets in queues their reports belong
to (or tickets with no queue at all), in addition to tickets already assigned to a report. Previously
a manager could not see backlog/unclaimed work at all — only what had already been picked up.
Matches standard supervisor team-queue visibility in Zendesk and Freshdesk.

## 4.16 Per-Channel Communication Consent (2026-07-12)
Contacts now carry per-channel (WhatsApp / SMS / Email) opt-in state in the append-only
`contact_channel_consent` table — every opt-in/opt-out is a new timestamped row with source
(`manual|reply|form|import|api`), recording user, and note; history is never overwritten. Surfaces:
a Consent tab on Contact Detail (toggles + note + full history), and API endpoints
`GET/POST /contacts/:id/consent` (+ `/history`). Enforcement is live: ticket creation (manual and
voice-bot) auto-records an opt-in when the customer selects WhatsApp/SMS as preferred channel, and
the ticket-reply dispatcher consults `getChannelConsent()` (`packages/api/src/lib/consent.ts`) —
an explicit opt-out reroutes the reply to email. Rationale: Meta's WhatsApp Business API requires
provable opt-in before business-initiated messages. Rule for future bulk/marketing sends: no
consent record = no send (stricter than ticket replies, where choosing the channel is the opt-in).
Matches Salesforce/HubSpot per-channel consent models.

## 4.17 Sector Auto-Provisioning of Modules (2026-07-12)
Extends 4.12's sector field seeding: each sector in `packages/shared/src/config/sectors.ts` now
also declares `defaultModules` + `defaultFeatures`. `POST /super-admin/tenants` seeds the new
tenant's `active_modules`/`entitled_features` from the chosen sector's defaults, unioned with any
explicitly requested modules/features; `PATCH /tenants/:id/modules` still adjusts afterwards.
Before this, sector had no effect on licensing — an "Education" tenant got only the bare default
modules unless the super admin toggled each one manually (the root cause of the TA-04 "education
sidebar" issue). Matches industry-template onboarding in Salesforce/HubSpot verticals.

## 4.18 Live Wallboard 500 Errors Fixed (2026-07-12)
`GET /api/v1/analytics/agent-load` and `GET /api/v1/analytics/queue-stats` (both manager+ only)
referenced `tickets.is_overdue` and `ticket_queues.department` — neither column ever existed in
the schema, so both endpoints 500'd on every call since they were built. Fixed: "breached" is now
computed as `sla_due_at IS NOT NULL AND sla_due_at < NOW()`; the non-existent `department` field
was dropped (queues never had a department concept) rather than inventing a fake data source.
Found while investigating a separate reported login issue via live Railway log streaming.

### 4.4 Customer 360 — Callback Search & Cross-Team Context

**Multi-field ticket search:** tickets searchable by ticket number, subject, reporter name, reporter
phone, reporter email, contact mobile, contact NIC (National Identity Card). Any agent receiving
a customer callback can locate all tickets instantly without a ticket number.

**Contact NIC field:** `contacts.nic_number` (migration `031_contact_nic.sql`) — indexed per tenant.

**Clickable customer name → Contact 360:** reporter name in ticket list card and detail panel is a
clickable link to `/contacts/:id`. Opens the full contact record (all tickets, calls, activities,
deals across all departments). Available to all roles. Contact list remains visibility-scoped;
direct contact record access is intentionally open (industry standard — better service context).

**Any-agent internal note:** `POST /api/v1/tickets/:id/notes` — requires only `tickets:read`.
Any agent can add an internal note to any ticket (including cross-dept tickets they originated).
Notes are `is_internal=true`, `comment_type='note'`, never visible to the customer. Audit logged
as `note_added`. Does not affect ownership, SLA, or status.

**Originator note banner:** view-only (originated) tickets show an amber panel with "+ Add Note"
button. Agent types callback context; note appears in the owning department's ticket thread.

**Contact 360 cross-dept tickets:** `GET /api/v1/contacts/:id/tickets` returns all tickets for a
contact across all departments regardless of the viewer's visibility scope. Department sourced from
`users.department` via assignee join. Frontend `ContactDetail.tsx` Tickets tab updated to use this
endpoint; shows purple department badge per ticket.

### 4.5 Line Manager Hierarchy & Department-Scoped Assignment

**3-level hierarchy per department:** Each department (Support, Sales, Complaints) has Dept Manager → Line Manager → Agent. Line managers' dashboard and report data is scoped to their own team via the existing `getVisibleUserIds` recursive CTE — no extra configuration needed.

**Demo tenant line managers created:** Support Line Manager (`support.line.manager@demo.com`), Sales Line Manager (`sales.line.manager@demo.com`), Complaints Line Manager (`complaints.line.manager@demo.com`). All use password `Demo1234!`.

**Department-scoped invite form:** `AdminUsers.tsx` InviteModal filters the manager dropdown by department and role tier. Creating an Agent → shows only Line Managers (managers who themselves have a `manager_id`). Creating a Manager → shows only Dept Managers (managers with `manager_id = null`). Changing department or role resets the manager selection. Warning shown if no managers found for the department. Backend `GET /api/v1/settings/team` updated to return `department` and `department_type` fields to enable client-side filtering.

**Role display names in invite form:** The manager dropdown label resolves to the organisation's own display name for that tier via `resolveRoleName(member, roles)` — checks `custom_role_id` first, falls back to system role match. E.g. if a manager has custom role "Territory Manager" the dropdown label reads "Territory Manager" instead of "Line Manager". Role selector placed above manager dropdown so tier is chosen first.

### 4.6 AmanahCX Platform Rebrand

All occurrences of "Vivid Solutions & Services" replaced with "AmanahCX":
- `Login.tsx` — left panel wordmark (h1), mobile header (h2), footer copyright
- `App.tsx` — sidebar brand paragraph; removed "& Services" second line
- `super-admin.ts` — onboarding email footer
- `settings.ts` — invite email footer

### 4.8 Ticket-Contact Linking (Mandatory Contact on Every Ticket)

**Every ticket must be linked to a contact.** This is enforced in the UI at creation time.

**Create Ticket form flow:** Contact search field is first. Agent types any identifier (name, email, phone, mobile, NIC) → live dropdown shows matching contacts → agent selects → reporter fields auto-fill (read-only). Form cannot be submitted without a contact selected.

**API:** `POST /api/v1/tickets` already accepts `contactId`; it is stored as `contact_id` in the `tickets` table. The field is populated on every ticket created via the new form.

**Contact search scope:** `GET /api/v1/contacts?search=...` searches name, email, phone, mobile, and NIC number (both list and count queries). Applies to the inline ticket form search and the main contacts list/search.

**Why this matters:** Without `contact_id`, the Tickets tab on the Contact 360 page (`GET /api/v1/contacts/:id/tickets`) returns nothing — the callback workflow breaks. With it, any agent receiving a callback can find the customer by mobile/NIC and see every prior ticket instantly.

**Industry benchmark:** Zendesk, Freshdesk, and Salesforce all require a contact record on every ticket. This is a non-negotiable standard for enterprise CRM demos.

**NIC on Contact 360 profile panel:** `contacts.nic_number` now renders in the left panel alongside phone and mobile, with a card icon. Agents can visually verify a customer's national ID during a call without leaving the screen.

**Clickable tickets on Contact 360:** Each ticket row in the Contact 360 Tickets tab is now interactive. Clicking navigates to `/tickets?open=<id>` using client-side React Router navigation. The Tickets page reads the `?open=` param on mount and opens the ticket detail panel immediately. An external link icon marks each row as clickable.

### 4.7 Agent Dashboard Fix

Agent `myTickets` analytics query was broken by `deptTicketFilter` (`ticket_type = 'support'`) applied universally. Support agent tickets are seeded with `ticket_type = 'inquiry'`, causing the filter to return 0 results. Fixed by splitting the query: agents bypass the dept filter entirely; managers still use it. Agent default `analytics:read` permission also corrected from `false` to `true`.

### 4.9 Seven CRM Gap Features (2026-06-29)

These seven features close the gap between AmanahCX and enterprise CRMs like Zendesk, Freshdesk, and Salesforce Service Cloud.

**4.9.1 Agent Status Presence**
Agents set their availability (Online / Busy / Away / Offline) via a picker in the sidebar. A colored dot shows current status. Auto-assign (push routing) skips Offline and Away agents so tickets only land on available agents. Status is stored in `users.agent_status` with a timestamp (migration 032).

**4.9.2 Live Supervisor Wallboard (`/wallboard`)**
A real-time operations screen for managers showing: agent status grid with colored dots + active/breached ticket counts; summary strip (Online / Busy / Away / Offline totals); SLA breach alert banner; queue depth panel per department. Auto-refreshes every 30 seconds. Managers only (sidebar: Analytics → Live Wallboard).

**4.9.3 New Ticket Quick Action on Contact 360**
A "New Ticket" button appears in the Tickets tab on every contact page. Clicking opens an inline modal (subject, priority, department). The ticket is created already linked to the contact — no need to switch to the Tickets page.

**4.9.4 Unified Timeline on Contact 360**
The Timeline tab on the Contact 360 page now surfaces all four event types in one chronological feed: activities, voice calls, tickets, and deals. Each type has a distinct icon. Powered by an extended `GET /api/v1/contacts/:id/timeline` query.

**4.9.5 CSAT Score on Contact 360 Profile Panel**
When a contact has rated any resolved ticket, an aggregate star rating and response count appear in the left profile sidebar. Data joins `csat_surveys` → `tickets.contact_id`. Only shown when at least one rating exists.

**4.9.6 Clickable Deals on Contact 360**
Deal rows in the Contact 360 Deals tab are now interactive buttons. Clicking navigates to `/deals?open=<id>`. The Deals page reads `?open=` from the URL and auto-fetches + opens that deal's detail panel.

**4.9.7 Per-Department Business Hour Profiles**
A new "Business Hours" tab under SLA Policies lets managers create named schedules (e.g., "Support 9–6 Mon–Fri", "Sales 24/7") and assign them to specific departments. Each profile specifies open/close times per weekday. Closed days are explicitly marked. Powered by the `business_hour_profiles` table (migration 033) with full CRUD API.

### 4.10 Ticket-Contact Linking UI + Platform Rebrand (2026-06-29)

**Mandatory contact on every ticket (Create Ticket form)**
Contact search is the first field in the Create Ticket modal. Agents cannot submit without selecting a contact. Once selected, Reporter Name, Email, and Phone auto-fill from the CRM record and become read-only. `contactId` is sent on every `POST /api/v1/tickets` call. This closes the workflow gap where tickets could be created without any customer link, breaking the Contact 360 Tickets tab.

**URL-driven ticket panel**
The Tickets page reads `?open=<id>` from the URL on load and opens that ticket's detail panel immediately. Enables deep-linking from Contact 360, email notifications, and any external system.

**AmanahCX platform rebrand**
Login page, card header, and copyright footer updated from "Vivid Solutions & Services" to "AmanahCX".

**Department-scoped manager filter (invite flow)**
When inviting a new team member (Settings → Team), the Line Manager dropdown filters to only show managers in the same department. Changing department resets the manager field. A warning appears if the selected department has no managers yet.

**Admin Users — manager assignment on invite**
The AdminUsers invite form includes a manager_id field. Managers are filtered by department and role. Custom role names are resolved and displayed correctly via `resolveRoleName` helper.

### 4.12 Agent Escalation + Sector-Specific Ticket Fields (2026-07-02)

**Agent → Manager Escalation**
Agents can escalate any ticket to their manager with a written reason. The manager sees an orange "Escalated" badge and a full reason banner (escalated by, reason, timestamp). Managers acknowledge the escalation to clear it. Non-managers see a read-only indicator. Both actions are audit-logged. Endpoints: `POST /tickets/:id/escalate` and `POST /tickets/:id/acknowledge-escalation`.

**Sector-Specific Custom Fields in Ticket Forms**
The New Ticket form and ticket detail panel now display sector-relevant custom fields. Banking tenants see: Case Type (dropdown), Transaction Reference, Amount Involved, Regulatory Deadline, Central Bank Ref #. Fields are stored per-tenant and rendered dynamically based on sector configuration.

**Auto-Provisioning Sector Fields at Tenant Creation**
When a super admin creates a tenant with a chosen sector, all sector-specific fields are automatically created for contacts, tickets, deals, and companies. No manual field setup required. The same seed runs when a super admin updates a tenant's sector. Sector field definitions live in `packages/shared/src/config/sectors.ts`.

---

### 4.11 SLA Governance Guardrail + Reassignment Audit + Security Hardening (2026-07-01)

**Manager ticket edit after agent acceptance**
Managers can now edit ticket fields (status, priority, assignee, queue) at any stage, including after an agent has accepted the ticket. Previously the Edit button was only available pre-acceptance. This aligns with global CRM standards where supervisors maintain override capability throughout the ticket lifecycle.

**Contact search by phone / NIC / name / email**
The Contacts search bar now searches across all four fields simultaneously: full name, phone number, NIC (National Identity Card) number, and email address. Any partial match returns the contact.

**Tenant admin hard-delete — closed tickets only**
The DELETE endpoint enforces a closed-status guard at the API level. Attempting to delete an open or in-progress ticket returns 403. Only the `tenant_admin` role can call the endpoint.

**SLA governance guardrail — mandatory reason for priority changes**
Changing a ticket's priority is an SLA-governance action (it re-routes the SLA clock). The system now blocks the Save action until a written reason is provided. On the backend, any PATCH to `priority` without `priorityChangeReason` returns HTTP 400 (`PRIORITY_REASON_REQUIRED`). The frontend shows a required textarea when the priority selector changes. The change is logged as a distinct `priority_changed` audit entry (not the generic `field_updated`) containing `old_value`, `new_value`, and `meta.reason`.

**Reassignment audit — distinct audit entry**
When a manager reassigns a ticket to another agent (emergency reroute), an optional reason field appears in the Edit panel. Providing a reason helps post-incident review but does not block Save. The change is logged as `assignee_changed` with `old_value` (previous assignee_id), `new_value` (new assignee_id), and `meta.reason`.

**AmanahCX-Roles-and-Flow.html — role reference and system flow**
A comprehensive standalone HTML document added to the project root and distributed to Desktop. Covers:
- Exhaustive role-by-role permission tables: tenant_admin, voice bot, manager, line manager, agent, viewer
- Full permission matrix (feature-level) across all six roles
- Complete end-to-end information flow: voice bot accepts call → intent detection → ticket creation → contact create/update → ACD routing → agent accepts (TAT starts) → originator view-only + notes → resolution and closure

---

### 4.13 Sales Module — Aging Table, Quotations, Template & Builder Fixes (2026-07-06)

**Aging of Receivables Table**
The Sales Dashboard now includes a full-width Aging of Receivables table at the bottom of the page. Each row is one customer with an outstanding balance. Columns show the balance split across 6 overdue time buckets: < 30 days, 30–60, 61–90, 91–180, 181–365, and > 365 days past due date. Rows are ordered by total outstanding (largest first). Paid and cancelled invoices are excluded. Backend: new `agingByCustomer` query in `sales-dashboard.ts`.

**Quotations Module**
A full quotations workflow has been added to the Sales module:
- New database tables: `quotations` and `quotation_line_items` (migration `045_quotations.sql`) with RLS.
- Full CRUD API at `/api/v1/sales/quotations` plus a `POST /:id/convert` endpoint.
- Convert copies the quotation to invoices + line items, marks the quotation Accepted, and sets `converted_to_invoice_id`. Quotation totals (draft + sent) are excluded from sales revenue figures until conversion.
- Frontend pages: `QuotationList.tsx` (search, filter, convert/view-invoice actions) and `QuotationCreate.tsx` (full form with auto-calculated Valid Until).
- Sales Dashboard gains a 5th KPI card: **Open Quotations** (count + total value of draft/sent quotations, clickable to list).

**Invoice Template Fix**
Selecting a different invoice template in the invoice detail view now renders a structurally distinct layout. Three templates are implemented:
- **tpl-minimal**: Typographic, no coloured boxes, uppercase tracking labels, 4-column table (no Tax column).
- **tpl-consulting**: Full-width dark header band with white text, striped table rows.
- **Default (tpl-classic/tpl-agency)**: Original logo-box layout with coloured table header.

**Invoice Builder Drag-Drop Fix**
Palette items can now be dragged onto a canvas that already contains elements. Previously, drops only registered on empty canvas space. Fixed by extending `overCanvas` detection in `onDragEnd` to also match when `e.over.id` equals any existing canvas element's id.

**Voice Bot Self-Service (G-F3)**
Tenant admins can configure the voice bot's self-service menu from Settings → Voice Bot. Up to 8 menu items (label + intent + enabled toggle) are stored in the `voice_bot_self_service_options` JSONB column on tenants (migration `044`). API: `GET/PATCH /api/v1/voice-bot/self-service`. Each item can be independently enabled/disabled without deletion.

**Voice Bot: Capacity, Handoff, CRM-Agnostic Connector, Agent Builder (2026-07-18)**
- Per-tenant + server-wide concurrent-call caps (migration `065`), enforced live via a new `active_voice_calls` registry.
- Human handoff: urgent ticket with full transcript-so-far raised first, then an attempted live SIP transfer to a configurable `human_transfer_destination` (migration `066`) — falls back to ticket-only if unset or the transfer fails.
- Nadia's CRM-facing calls extracted into `services/nadia-voice-agent/src/crm_client.py`, a fixed 6-operation contract any CRM can implement (see `CRM_CONNECTOR_CONTRACT.md`) — AmanahCX is the reference implementation, not a special case.
- Contact matching upgraded from phone-only to two-of-three {phone, NIC, email}; a new `identify_caller` tool lets Nadia confirm identity mid-call from a single weak identifier before relying on it.
- Agent Builder: `voice_bot_agent_templates` (migration `072`) — reusable agent configs, assignable to any workspace via Super Admin's new Agent Templates page; assigning auto-grants the Voice Bot module if not already licensed. Knowledge base gained multi-source ingestion (text/URL/file) at the Super Admin level, matching the tenant-side page. New tenant creation auto-provisions a sector-matched (or generic-default) voice bot config, with menu segments derived from licensed modules.

---

## 2.9 Monorepo TypeScript Build Fixed Across `packages/api`, `packages/core`, `packages/shared`, and All 11 Modules (2026-07-21)

**Background:** the production app runs on `tsx`, which executes TypeScript directly and skips type-checking entirely — so `tsc`, the actual type-checker, had never been run cleanly (or in some cases, at all) against most of the backend. Running it standalone surfaced errors across 11 of 11 `modules/*` packages plus `packages/api` and `packages/core`.

**Root causes fixed:**
- None of the 11 `modules/*` packages (`activities`, `analytics`, `billing`, `connectors`, `contacts`, `crm`, `deals`, `sales`, `ticketing`, `voice-module`, `voice`) had their own `tsconfig.json` — added one to each.
- `packages/api` and `packages/core` both had a `rootDir` setting that conflicted with how they import each other's source files directly across package boundaries — removed.
- A handful of wrong import paths, one duplicate/shadowed method in `tenant.service.ts` (`invalidateCache`), and several genuinely mistyped values across `governance.ts`, `voice.ts`, `voice-bot.ts`, and `auth.middleware.ts`.

**Real bugs found and fixed as a byproduct** (previously invisible under `tsx`, confirmed as genuine production issues, not just type noise):
- `routes/emails.ts` and `routes/sales/invoices.ts` both referenced `req.user.id`, which does not exist on the auth token (only `req.user.sub` does) — every email's "sent by" field was silently recording `null`.
- `routes/emails.ts`'s `eventBus.publish(...)` call had its arguments in the wrong order, silently breaking the activity-created event for sent emails.

**Confirmed but explicitly not fixed** (separate, out-of-scope feature gap, flagged for a future task): `/calls/:callId/stream`'s live-call-streaming WebSocket route has never actually been reachable at runtime — the `@fastify/websocket` plugin it depends on was never installed or registered anywhere in the project, even though the frontend's `VoiceCalls.tsx` does try to open a connection against this exact path.

**Process:** done on an isolated branch (`fix/monorepo-build-config`), with a pre-fix git tag (`pre-monorepo-fix-2026-07-20`) and a full solution backup zip taken first as safety checkpoints. Verified with a clean, zero-error `tsc --noEmit` on every affected package individually and via the root `turbo run build` pipeline, then fast-forward merged into `main` (commit `455046e`) only once fully verified. No schema/migration involved, no database changes, no frontend behavior changes — `packages/frontend`'s own separate build errors are a distinct, still-open item (see `BACKLOG.md`).

