# CHANGE LOG
_Most recent at top. Treated as the primary record for development tracking._

---

## Change Log - 2026-06-29 (7 CRM Gap Features — 360 View, Wallboard, Business Hours)

### Added

**Step 1 — Agent Status Presence**
- Agents can set themselves Online / Busy / Away / Offline from the sidebar. Status shown with colored dot.
- Auto-assign (push routing) now skips agents who are Offline or Away.
- Migration 032 adds `agent_status` and `agent_status_updated_at` columns to `users`.

**Step 2 — Live Supervisor Wallboard (`/wallboard`)**
- Real-time grid of all agents with status dot, active ticket count, and SLA breaches.
- Summary strip: Online / Busy / Away / Offline agent counts.
- Queue depth panel showing open, assigned, pending, and breached counts per queue.
- Auto-refreshes every 30 seconds. Manual refresh button. Managers only.

**Step 3 — New Ticket Quick Action on Customer 360**
- "New Ticket" button added to the Tickets tab on any contact page.
- Inline modal: enter subject, priority, and department without leaving the 360 view.
- Ticket is automatically linked to the contact on creation.

**Step 4 — Unified Timeline on Customer 360**
- The Timeline tab now shows activities, voice calls, tickets, AND deals in one chronological feed.
- Ticket and deal events appear with distinct icons (lifebuoy / trend arrow).

**Step 5 — CSAT Score on Customer 360 Profile Panel**
- If any resolved tickets from this contact have CSAT responses, a star rating and count appear in the profile sidebar.
- Data sourced from `csat_surveys` joined to `tickets.contact_id`.

**Step 6 — Clickable Deals on Customer 360**
- Deal rows in the Deals tab are now buttons that navigate to `/deals?open=<id>`.
- The Deals page reads `?open=<id>` from URL and automatically opens that deal's detail panel.

**Step 7 — Per-Department Business Hour Profiles**
- New "Business Hours" tab added to SLA Policies page.
- Managers can create named schedules (e.g., "Support 9–6 Mon–Fri") scoped to specific departments.
- Each profile specifies open/close times per day; closed days are marked explicitly.
- Migration 033 adds `business_hour_profiles` table with RLS.

---

## Change Log - 2026-06-29 (Customer 360 — NIC on Profile, Clickable Tickets)

### Added
**NIC number on Contact 360 profile panel**
- Contact's NIC number now shows in the left panel alongside phone and mobile, with a card icon.
- Agents can verify a customer's NIC during a call without leaving the screen.

**Clickable tickets on Contact 360**
- Each ticket row in the Tickets tab is now a button. Clicking navigates to the Tickets page and opens that ticket's detail panel directly.
- The Tickets page reads `?open=<ticketId>` from the URL on load and opens the panel automatically.
- An external link icon on the right of each ticket row signals it's clickable.

---

## Change Log - 2026-06-29 (Ticket-Contact Linking — Mandatory Contact on Every Ticket)

### Added
**Ticket creation now requires a linked contact**
- Every new ticket must be linked to a contact record before it can be submitted.
- Contact search field added at the top of the Create Ticket form. Agents search by name, email, phone, mobile, or NIC number and select the customer before filling in any other details.
- Once a contact is selected, Reporter Name, Email, and Phone auto-fill and become read-only (no manual override — data comes from the CRM record).
- `contactId` is sent to `POST /api/v1/tickets` and stored as `contact_id` on the ticket.

**Contact search extended to phone, mobile, and NIC**
- `GET /api/v1/contacts?search=...` now searches across name, email, phone, mobile, and NIC number — in both the list query and the count query.
- Agents can type any customer identifier to locate the correct contact record without knowing their name.

### Why this matters
- Agents receiving callbacks can immediately see a customer's full history (all prior tickets, calls, deals) on the Contact 360 page.
- Without `contact_id`, the Tickets tab on ContactDetail would always show 0 tickets — the link is required for the callback workflow to function.
- Matches global CRM standard: Zendesk, Freshdesk, and Salesforce all require a contact on every ticket.

---

## Change Log - 2026-06-28 (AmanahCX Rebrand, Role Display Names in Invite, Customer 360, Line Managers, Dashboard Fix)

### Changed
**AmanahCX rebrand — all screens**
- All occurrences of "Vivid Solutions & Services" replaced with "AmanahCX" across:
  - Login page (left panel wordmark, mobile header, footer copyright)
  - Main app sidebar brand name
  - Invite email footer (sent when a new user is created)
  - Onboarding email footer (sent by super-admin when provisioning a tenant)

**Role display names in Invite User form**
- The manager dropdown label now shows the organisation's own display name for that tier (e.g. "Territory Manager", "Floor Manager") instead of the generic label "Line Manager" or "Department Manager".
- Display name is resolved from the custom role attached to the managers in the dropdown. Falls back to system role name if no custom role is set.
- Manager options show only the person's name — no redundant role suffix.
- Role selector moved above the manager dropdown so the admin picks the role tier first, which then filters the manager list accordingly (agents see only Line Managers; new managers see only Dept Managers).

---

## Change Log - 2026-06-28 (Customer 360, Contact 360 Cross-Dept Tickets, Dashboard Fix, Line Managers, Dept-Scoped Dropdown)

### Added
**Customer 360 — Contact detail page enhancements**
- Callback search: search contacts by phone/mobile from the ticket view.
- 360 view tab: shows contact's full profile, company, tags, and custom fields in a single panel.
- Notes tab: agents can add/view timestamped notes on a contact record.
- Cross-department ticket view: a new `/api/v1/contacts/:id/tickets` endpoint returns ALL tickets for a contact across all departments. Agents opening a customer record now see every ticket the customer has — regardless of which department handled it — in a unified "Tickets" tab with a purple department badge per ticket.

**Line managers for all departments**
- Created Support Line Manager (`support.line.manager@demo.com`), Sales Line Manager (`sales.line.manager@demo.com`), and Complaints Line Manager (`complaints.line.manager@demo.com`) in the demo tenant.
- Full 3-level hierarchy per department: Dept Manager → Line Manager → Agent.
- Line managers see only their own data and their reportees' data in dashboards and reports (powered by the existing `getVisibleUserIds` recursive CTE).

**Department-scoped Line Manager dropdown (Invite & Edit)**
- When inviting a new user, selecting a department immediately filters the Line Manager dropdown to show only managers from that same department.
- Switching department resets any previously selected manager.
- If no managers exist for the selected department, an amber warning is shown.
- Same filter applies to the Edit panel inline manager dropdown.
- Backend: `GET /api/v1/settings/team` now returns `department` and `department_type` per user so the frontend can filter correctly.

### Fixed
**Agent dashboard showing 0 tickets**
- `deptTicketFilter` (`ticket_type = 'support'`) was incorrectly applied to agents' `myTickets` query. Support agent tickets were seeded with `ticket_type = 'inquiry'`, so the filter excluded all of them.
- Fixed by splitting the analytics query: agents use a clean SQL without dept filter; managers still use the dept-scoped version.

**Agents blocked from ops-dashboard (403)**
- Agent default `analytics` permission was `false`. Updated default in `roles.ts` to `analytics:read: true` so all newly invited agents can access their dashboard immediately.
- Existing demo agents' DB permissions patched to `analytics = "view"`.

---

## Change Log - 2026-06-24 (Visibility Guards, Originator View, Reports Hub, Complaints Manager)

### Added
**Ticket visibility guards — department-scoped, hierarchy-aware**
- `GET /api/v1/tickets` now enforces `getVisibleUserIds`: agents see only tickets assigned to them; managers see their full reportee hierarchy; super_admin/tenant_admin see all.
- Visibility is department-scoped — Support Manager sees only Support team tickets; Complaints Manager sees only Complaints team.

**Cross-department originator view**
- When a support agent creates a ticket that is routed to and accepted by another department (Sales or Complaints), the originating agent retains read-only visibility on that ticket.
- `is_originated_by_me` + `assignee_department` fields added to ticket list response.
- Frontend shows an amber **"👁 View only"** badge on these tickets in the list and detail panel.
- Write attempts on originated cross-dept tickets return `ORIGINATOR_READONLY` (HTTP 403).
- Industry standard (Zendesk / Freshdesk / Salesforce): originator keeps status/resolution visibility but cannot act on the ticket once accepted by another team.

**Complaints Manager — correct department hierarchy**
- Created `Complaints Manager` (`complaints.manager@demo.com`) for the demo tenant.
- Complaints Agent now correctly reports to Complaints Manager, not Support Manager.
- Full 3-department hierarchy: Support Manager → Support Agent; Complaints Manager → Complaints Agent; Sales Manager → Sales Agent.

**Reports hub (10 downloadable CSV reports)**
- New `/reports` page available to both managers and agents from the sidebar.
- Manager reports: Ticket Volume, SLA Performance, Agent Performance, CSAT, Issue Categories, Ticket Backlog.
- Agent reports: My Tickets, My Activities, My SLA, My Call Log.
- All reports export to CSV with correct column headers and live data.

**Ops Dashboard KPI strip**
- Added 4-card live KPI strip to the Manager Dashboard: CSAT Score, SLA Compliance %, Avg Resolution Time, Avg First Response Time.

**Analytics sidebar section**
- Collapsible "Analytics" button in the manager sidebar with sub-links: Ops Dashboard and Ticket Reports.

### Modified
- Sales Agent ticket permission changed from `none` to `view` — sales agents can now access tickets assigned to them (their core workflow).
- Sales Manager ticket permission changed from `none` to `full`.

### Fixed
- Complaints Agent was incorrectly reporting to Support Manager, causing Support Manager to see Complaints tickets. Fixed by creating a dedicated Complaints Manager.

---

## Change Log - 2026-06-24 (Ticket Reports)

### Added
**Full Ticket Reports page for managers — benchmarked vs Zendesk / Freshdesk**
- New **Ticket Reports** page accessible to managers from the sidebar.
- **6 KPI summary cards:** Total Tickets, Resolved (with resolution rate %), SLA Compliance % (colour-coded green/amber/red), Avg Resolution Time, Avg First Response Time, Escalation Rate %.
- **Ticket Volume chart:** Bar chart showing total, resolved, and SLA-breached tickets over the selected period (daily/weekly/monthly breakdowns auto-selected by period).
- **SLA Performance Trend chart:** Dual-axis line chart — SLA compliance % and avg resolution/first-response times over time.
- **Tickets by Priority:** Donut chart (Urgent/High/Medium/Low) with count and percentage.
- **Tickets by Channel:** Donut chart (Voice Bot/Manual/Email etc.) with count and percentage.
- **Top Issue Categories:** Horizontal bar chart of the top 10 ticket tags with avg resolution time and SLA breach rate per category.
- **Tickets by Type:** Bar breakdown (complaint/inquiry/sales etc.).
- **Repeat Reporters:** Table of customers who raised more than one ticket in the period.
- **Period selector:** Last 7 days / 30 days / 90 days / 6 months.
- **CSV export:** Downloads volume data as a spreadsheet.
- Files: `packages/frontend/src/pages/TicketReports.tsx` (new), `packages/frontend/src/App.tsx` (import + route + nav link).

---

## Change Log - 2026-06-24 (SLA breach notifications)

### Added
**SLA escalation — all stages now send email + in-app notification**
- Previously: the warning reminder (at 80% of SLA time) only sent an in-app notification. Agents had no email alert until the SLA was already breached.
- Now: all three escalation stages send both in-app notification AND email.
  - **80% warning** → email to the assigned agent: "X minutes remaining, please action now"
  - **100% breach (L1)** → email to the agent + all managers in the workspace
  - **150% breach (L2)** → email to all tenant admins (highest authority escalation)
- Worker checks every 5 minutes and fires on server start (no breach is missed after a restart).
- Files: `modules/ticketing/src/index.ts` — added `emailSvc.send()` call inside the reminder block.

---

## Change Log - 2026-06-24 (SLA deadline engine)

### Fixed / Enhanced
**SLA Deadlines now skip non-working hours and public holidays**
- Previously: deadline = accepted time + hours (e.g. accept at 4pm Friday with 8h SLA → deadline 12am Saturday — wrong).
- Now: deadline walks forward through working days only, skipping weekends, non-working hours, and any public holidays set in the holiday calendar.
- Both the first-response deadline and the resolution deadline use this logic.
- Behaviour when no business hours are configured is unchanged (simple clock arithmetic).
- Tested: late-day acceptance skipping overnight ✅, Friday acceptance skipping weekend ✅, holiday on next working day skipping to day after ✅.
- Files: `packages/api/src/routes/tickets.ts` — `computeSlaDeadline()` and `buildSlaDeadlines()` functions added; accept handler updated to use them.

---

## Change Log - 2026-06-24 (CSAT Survey)

### Added
**CSAT Survey — full end-to-end customer satisfaction flow**
- **Public survey page** (`/csat/:token`): Customer-facing star-rating page (1–5 stars with colour-coded labels), optional comment field, thank-you confirmation screen. No login required. Handles expired (410) and not-found (404) states gracefully.
- **Ticket detail panel**: Resolved tickets now show a "Customer Satisfaction" card — displays star rating and comment if responded, or "awaiting response" if survey is pending.
- **Ticket detail API** (`GET /api/v1/tickets/:id`): Now returns `csatSurvey` field (rating, comment, responded_at, sent_at) for any ticket that has a linked survey.
- **Survey auto-send**: Pre-existing — already fires on ticket close via `sendCsatSurvey()` in `tickets.ts`. Email sent to reporter with the unique token URL. Verified working end-to-end.
- **CSAT list + summary API**: Pre-existing at `GET /api/v1/tickets/csat` and `GET /api/v1/tickets/csat/summary`. Returns all responses with rating, comment, ticket details, and aggregate stats (avg rating, response rate, distribution by star).
- Vite proxy: added `/public` path so the dev server forwards CSAT API calls correctly.
- Files: `packages/frontend/src/pages/CsatSurvey.tsx` (new), `packages/frontend/src/App.tsx` (route added), `packages/frontend/src/pages/Tickets.tsx` (CSAT card), `packages/api/src/routes/tickets.ts` (csatSurvey in detail), `packages/frontend/vite.config.ts` (proxy).

---

## Change Log - 2026-06-24 (SendGrid deliverability)

### Fixed
**Email — SendGrid sender changed from Gmail to authenticated domain**
- Root cause: `SENDGRID_FROM_EMAIL` was set to `vividd.solutions@gmail.com` — a Gmail address that SendGrid cannot authenticate. Emails were landing in spam or being rejected by enterprise mail servers.
- Fix: Changed sender to `noreply@vividsns.com` (owned domain). SPF/DKIM DNS records must be added in SendGrid and domain registrar (one-time setup — see OPERATIONS_GUIDE.md → Email Deliverability).
- Files: `packages/api/.env` (SENDGRID_FROM_EMAIL updated).
- Action required: Complete domain authentication in SendGrid dashboard (Settings → Sender Authentication → Authenticate Your Domain) and add the 3 DNS records provided.

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

---

## Change Log - 2026-06-24 (Customer 360 — Search, Clickable Customer, Any-Agent Notes)

### Added
**Multi-field ticket search — mobile, NIC, name, phone**
- Ticket search now finds tickets by: ticket number, subject, reporter name, reporter phone, reporter email, contact mobile number, contact NIC (National Identity Card) number.
- Any agent receiving a customer callback can type the customer's mobile or NIC and instantly find all their tickets.
- Migration `031_contact_nic.sql` — added `nic_number` column + index to contacts table.

**Clickable customer name → Customer 360**
- Customer/reporter name in the ticket list card and the ticket detail panel is now a clickable link.
- Clicking it opens the customer's full Contact record (all tickets, calls, activities, deals across all departments).
- Only shown as a link when the ticket has a linked contact (`contact_id`).

**Any-agent internal note on any ticket**
- New `POST /api/v1/tickets/:id/notes` endpoint — requires only `tickets:read` (no ownership required).
- Any agent who receives a customer callback can add an internal note to any ticket, even one owned by another department.
- Notes are always internal (not visible to the customer). Stored as `comment_type = 'note'`, `is_internal = true`.
- Does not change ticket ownership, SLA timers, or status.
- Audit logged as `note_added`.

**Originator panel — note box**
- View-only (originated) tickets now show an amber banner with a **"+ Add Note"** button.
- Agent can expand the note box, type context from the customer call, and submit — note appears in the ticket's conversation thread visible to the owning department.

---

## Change Log - 2026-06-28 (Contact 360 — Cross-Department Ticket View)

### Fixed
**Contact 360 Tickets tab now shows ALL departments' tickets for that customer**
- Previously: the Tickets tab on a customer's contact page was filtered by the viewing agent's visibility scope. A Support Manager opening a customer's 360 view would only see the Support ticket, missing Complaints and Sales tickets for the same person.
- Now: new `GET /api/v1/contacts/:id/tickets` endpoint returns all tickets for the contact across all departments, regardless of who is viewing.
- Each ticket shows a coloured department badge (purple) so agents can see at a glance which team owns it.
- Tested: contact with 5 tickets across Support, Complaints, Sales — new endpoint returns all 5; old scoped endpoint returns only 1.
- Files: `packages/api/src/routes/contacts.ts` (new endpoint), `packages/frontend/src/pages/ContactDetail.tsx` (Tickets tab updated).
