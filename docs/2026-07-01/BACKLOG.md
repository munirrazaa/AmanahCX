# BACKLOG
_All ideas, pending work, and deferred items. Prioritised against enterprise readiness and benchmarked vs. Zendesk, Freshdesk, Salesforce Service Cloud, HubSpot._

**Priority scale:**
- **P1 – Critical** → Blocks enterprise sale. Every top CRM ships this. Missing = demo fails.
- **P2 – High** → Important for serious buyers. Do within next few sessions.
- **P3 – Medium** → Good to have. Won't lose a deal without it but adds polish/depth.
- **P4 – Low** → Nice idea. Post-launch or on-request only.

---

## 🔴 P1 — Critical (Do Now — blocks enterprise readiness)

### 1. Dashboard — Fix broken analytics / ops dashboard
- **Verdict:** Do Now
- **Status:** Done ✅ — 2026-06-29 (verified working for manager and agent roles; materialized views confirmed present; API returns data for all roles)
- **Detail:** Originally hung due to missing materialized views. Views now exist (`mv_daily_ticket_stats`, `mv_daily_deal_stats`, etc.). Agent + manager dashboards both render correctly.

### 2. SQL Injection Security Patch (Abdurrehman branch)
- **Verdict:** Do Now
- **Why:** Any enterprise procurement / security review will find this. It is a critical vulnerability. No enterprise will buy software with known SQL injection exposure.
- **Benchmark:** Non-negotiable across all CRMs and any SaaS product.
- **Status:** Branch `abdrehman-merge` ready — awaiting merge decision
- **Detail:** Auth bug fixes + SQL injection patch in `abdrehman-merge`. Must be merged before any customer demo or trial.

### 3. Email Deliverability — SendGrid SPF/DKIM authentication
- **Verdict:** Do Now
- **Why:** Onboarding flow sends password emails via SendGrid. If they land in spam, new customers cannot log in. This breaks the entire customer onboarding journey.
- **Benchmark:** All SaaS products configure domain authentication before go-live.
- **Status:** Code done ✅ — DNS setup pending (action required by owner)
- **Detail:** Sender changed to `noreply@vividsns.com`. DNS records (SPF TXT + 2 DKIM CNAMEs) must be added via SendGrid dashboard → Sender Authentication → Authenticate Your Domain. One-time setup.

### 4. CSAT Survey — Customer satisfaction after ticket close
- **Verdict:** Do Now
- **Why:** Enterprise contact centres are bought and judged on customer satisfaction scores.
- **Benchmark:** Zendesk, Freshdesk, Salesforce all ship CSAT as core — not an add-on.
- **Status:** Done ✅ — 2026-06-24
- **Detail:** Public survey page (`/csat/:token`), auto-sent on ticket close, rating shown on ticket panel, list + summary API available. CSAT score visible to managers via `GET /api/v1/tickets/csat/summary`.

### 5. Ticket Queue / Live Wallboard for supervisors
- **Verdict:** Do Now
- **Status:** Done ✅ — 2026-06-29
- **Detail:** Live Wallboard page at `/wallboard` (Analytics → Live Wallboard, managers only). Shows agent status grid, summary strip, SLA breach alert banner, and queue depth panel. Auto-refreshes every 30 seconds.

---

## 🟡 P2 — High (Do Soon — important for serious buyers)

### 6. Holiday SLA pause — wire into deadline calculation engine
- **Verdict:** Do Soon
- **Status:** Done ✅ — 2026-06-24
- **Detail:** SLA deadlines now skip weekends, non-working hours, and public holidays. Tested with late-day, end-of-week, and holiday scenarios — all correct.

### 7. SLA Breach Notifications — in-app + email alerts
- **Verdict:** Do Soon
- **Why:** SLA escalation steps are configured but if notifications aren't delivered (email or in-app), the escalation feature has no teeth. Enterprise buyers specifically ask "what happens when SLA is breached?"
- **Benchmark:** Zendesk sends email + in-app. Freshdesk adds webhook. Both are standard.
- **Status:** Done ✅ — 2026-06-24
- **Detail:** All three escalation stages now send both in-app notification AND email. Stage 1 (warning at 80%): emails the assigned agent. Stage 2 (SLA breach at 100%): emails the agent + all managers. Stage 3 (critical escalation at 150%): emails all tenant admins. Worker runs every 5 minutes automatically.

### 8. Reports Module — SLA performance, ticket volume, agent stats
- **Verdict:** Do Soon
- **Why:** Every enterprise buyer asks for reporting. "How do I know my team is performing?" Without reports the product feels incomplete. Listed in product modules but needs confirmation it works.
- **Benchmark:** All top CRMs ship basic reports: SLA compliance %, ticket volume by channel/dept, first reply time, resolution time.
- **Status:** Done ✅ — 2026-06-24
- **Detail:** Full Ticket Reports page now live for managers. Includes: 6 KPI cards (total tickets, resolved, SLA compliance %, avg resolution time, avg first response time, escalation rate), ticket volume chart over time, SLA performance trend chart, tickets by priority (donut), tickets by channel (donut), top issue categories with avg resolution time and breach rate, tickets by type, and repeat reporters list. Period selector (7d / 30d / 90d / 6m) and CSV export included. Sales Reports (invoices, aging, customer-wise) and Team Activity Report were already working.

### 9. Agent Status — Online / Away / Busy / Offline
- **Verdict:** Do Soon
- **Status:** Done ✅ — 2026-06-29
- **Detail:** Agents set status from sidebar picker. Colored dot reflects status. Push routing skips Offline/Away agents. Migration 032.

### 10. Named Business Hour Profiles (per-department)
- **Verdict:** Do Soon
- **Status:** Done ✅ — 2026-06-29
- **Detail:** Business Hours tab in SLA Policies. Managers create named schedules with per-day open/close times, scoped to departments. Migration 033.

---

## 🟢 P3 — Medium (Backlog — good to have, post-core)

### 11. First Reply Time — display on ticket detail page
- **Verdict:** Backlog
- **Why:** Column is stamped, data exists. Just needs a UI metric card on the ticket. Low effort, not blocking.
- **Status:** DB done. UI not built.

### 12. SLA Breach Webhook — notify external URL
- **Verdict:** Backlog
- **Why:** Useful for integrations but not needed to sell to first customers.
- **Benchmark:** Freshdesk has it. Zendesk has it via triggers. Not expected on day one.
- **Status:** Not Started

### 13. Department foreign key (`department_id` on users)
- **Verdict:** Backlog
- **Why:** Current text-based department link works but is fragile. Important for long-term data integrity. Not visible to buyers.
- **Status:** Not Started

### 14. Company-wide operational manager role (cross-department view)
- **Verdict:** Backlog
- **Why:** Niche requirement. Some enterprise orgs want it but it's not a blocking gap.
- **Status:** Not Started

---

## 🔵 P4 — Low (Post-launch / on-request)

### 15. Pitch deck — embed Vivid Solutions logo image
- **Verdict:** Post-launch
- **Status:** Not Started

### 16. Clean up empty module scaffolds (`modules/companies`, `modules/email`)
- **Verdict:** Post-launch — internal housekeeping only
- **Status:** Not Started

---

## ✅ Completed (moved from backlog)

- Email deliverability — sender changed to noreply@vividsns.com — DONE 2026-06-24 (DNS records pending owner action)
- Holiday SLA engine — deadlines now skip holidays, weekends, non-working hours — DONE 2026-06-24
- CSAT Survey — full end-to-end flow (public page, auto-send, ticket panel, API) — DONE 2026-06-24
- Holiday Calendar — DONE 2026-06-24
- First Reply Time metric (DB + stamping) — DONE 2026-06-24
- Smart Policy Matching — DONE 2026-06-24
- SLA Policies full CRUD — DONE 2026-06-24
- Business Hours per policy — DONE 2026-06-24
- Pause on Pending — DONE 2026-06-24
- Entitlements (Phase 1, 2a, 2b) — DONE 2026-06-24
- Role permissions ceiling — DONE 2026-06-24
- Tenant admin operational lockout — DONE 2026-06-24
- CRM visibility scoping (line-manager tree) — DONE 2026-06-24
- Sales ticket → deal conversion — DONE 2026-06-24
- Ticket visibility guards (department-scoped, hierarchy-aware) — DONE 2026-06-24
- Cross-department originator view (read-only after acceptance, "👁 View only" badge, write blocked) — DONE 2026-06-24
- Complaints Manager created — correct 3-department hierarchy (Support/Complaints/Sales each with own manager) — DONE 2026-06-24
- Reports hub — 10 downloadable CSV reports (6 manager, 4 agent) — DONE 2026-06-24
- Ops Dashboard KPI strip (CSAT, SLA %, avg resolution, avg first response) — DONE 2026-06-24
- Analytics sidebar collapsible section (Ops Dashboard + Ticket Reports sub-links) — DONE 2026-06-24
- Multi-field ticket search (mobile, NIC, name, phone) — DONE 2026-06-24
- Clickable customer name → Customer 360 contact record — DONE 2026-06-24
- Any-agent internal note on any ticket (callback context) — DONE 2026-06-24
- NIC number field on contacts (migration 031) — DONE 2026-06-24
- Contact 360 cross-dept ticket view (all departments visible on customer record) — DONE 2026-06-28
- Agent dashboard fix (0 tickets shown — deptTicketFilter + analytics permission) — DONE 2026-06-28
- Line managers created for all 3 departments (Support / Sales / Complaints) — DONE 2026-06-28
- Department-scoped Line Manager dropdown on Invite & Edit (only same-dept managers shown) — DONE 2026-06-28
- Role display names in Invite form (org's own hierarchy names shown in manager dropdown label) — DONE 2026-06-28
- AmanahCX platform rebrand (login, sidebar, email footers) — DONE 2026-06-28
- Ticket-contact linking (mandatory contact on every ticket, contact search by phone/mobile/NIC) — DONE 2026-06-29
- Policy Admin governance role — SLA write access isolated to policy_admin only; manager + tenant_admin blocked (403); governed_departments scope; ticket_type department tag on policies; purple badge on SLA card — DONE 2026-06-29
- NIC number on Contact 360 profile panel — DONE 2026-06-29
- Clickable tickets on Contact 360 (opens ticket panel directly) — DONE 2026-06-29
- Manager ticket edit after acceptance (all fields editable post-handoff) — DONE 2026-07-01
- Contact search by phone/NIC/name/email — DONE 2026-07-01
- Tenant admin hard-delete on closed tickets only (guard at API level) — DONE 2026-07-01
- SLA governance guardrail: mandatory written reason for priority changes, distinct `priority_changed` audit entry — DONE 2026-07-01
- Reassignment audit: optional reason for agent reassignment, distinct `assignee_changed` audit entry — DONE 2026-07-01
- AmanahCX-Roles-and-Flow.html: exhaustive role permissions + end-to-end voice bot→resolution flow — DONE 2026-07-01
