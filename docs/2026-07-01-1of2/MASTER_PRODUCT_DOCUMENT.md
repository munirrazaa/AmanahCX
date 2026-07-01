# MASTER PRODUCT DOCUMENT
**AI Operations Platform — Multi-Tenant CRM, Contact-Centre & Sales Suite**
_Single source of truth for system requirements & behaviour. Update only affected sections on each change._

Last updated: 2026-07-01 (Call Recordings module, CX Insights full call-centre dashboard, operations_admin role, topic word cloud, Sales end-to-end flow, role login mockups, sector-wise CRM fields in HTML reference)

---

## 1. Overview
A multi-tenant SaaS suite hosting many isolated customer organisations ("tenants") on one system.
Each tenant combines CRM, a contact centre (with an AI voice agent), sales & invoicing, analytics,
and team collaboration.

- **Frontend:** React + TanStack, Vite (`packages/frontend`)
- **API:** Fastify + GraphQL/Mercurius, Zod, JWT (`packages/api`)
- **DB:** PostgreSQL with Row-Level Security; 25+ migrations (`packages/core`)
- **Voice:** LiveKit ("Nadia" agent) · **Email:** SMTP / SendGrid / MS365

## 2. Roles & Access Control (three layers + separation of duties)
1. **Entitlement (what is licensed):** super-admin licenses modules + features per tenant
   (`tenants.entitled_features`). Unlicensed features hidden in nav and refused by API.
2. **Roles (who may act):** tenant admin assigns create/edit/delete per role (Admin, Manager,
   Agent, Viewer + custom). Five system roles auto-seeded, including the **Policy Admin** governance role.
   - `policy_admin` (ROLE_RANK 25) — independent governance role. Only role permitted to write SLA policies.
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
Repo: github.com/munirrazaa/AI-Operations-Platfrom- (main). Frontend: Vercel · API: VPS ·
DB: PostgreSQL (Supabase pooler, TLS) · Storage: S3-compatible · Redis optional.
Secrets in local `.env` only (git-ignored). Demo: workspace `demo`, super-admin `admin@demo.com`.

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
