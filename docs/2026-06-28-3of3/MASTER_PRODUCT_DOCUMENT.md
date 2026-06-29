# MASTER PRODUCT DOCUMENT
**AI Operations Platform — Multi-Tenant CRM, Contact-Centre & Sales Suite**
_Single source of truth for system requirements & behaviour. Update only affected sections on each change._

Last updated: 2026-06-24 (visibility guards, originator view, reports hub, complaints manager)

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
   Agent, Viewer + custom). Four system roles auto-seeded.
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

SLA policies and holiday calendar managed by Managers at `/tickets/sla`.

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

### 4.7 Agent Dashboard Fix

### 4.6 Agent Dashboard Fix

Agent `myTickets` analytics query was broken by `deptTicketFilter` (`ticket_type = 'support'`) applied universally. Support agent tickets are seeded with `ticket_type = 'inquiry'`, causing the filter to return 0 results. Fixed by splitting the query: agents bypass the dept filter entirely; managers still use it. Agent default `analytics:read` permission also corrected from `false` to `true`.
