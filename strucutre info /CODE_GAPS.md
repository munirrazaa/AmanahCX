# Itqan — Code Gaps for Rectification
**Audit Date:** 10 June 2026  
**Audited By:** Itqan Product Team (AI-assisted code review)  
**Scope:** All route files, services, migrations, and background workers in `packages/api` and `packages/core`

---

## Gap 1 — First-Response SLA Never Enforced  
**Severity:** 🔴 HIGH — Compliance Risk  
**File:** `packages/api/src/routes/tickets.ts` (SLA worker section) + `packages/core/src/database/migrations/003_ticketing.sql`

**Problem:**  
`sla_policies` has a `first_response_hours` column. It is stored, displayed in the UI, and shown in the SLA policy table — but the SLA background worker (which runs every 5 minutes) only reads and acts on `resolution_hours`. `first_response_hours` is never checked. No warning fires when first response time is approaching, and no breach is recorded when it is exceeded.

**Fix Required:**  
In the SLA worker, add a second check loop:
- For each open/assigned ticket where `first_response_at IS NULL` and `created_at + first_response_hours` is approaching or has passed:
  - Fire a `first_response_warning` notification at 80% of `first_response_hours`
  - Set `first_response_breached = true` (add column) and fire `first_response_breach` event at 100%
- Record the first response time in `first_response_at` when the first non-internal comment is added to a ticket (this part is already implemented — `first_response_at` is set on first comment).

---

## Gap 2 — No Queue Agent Membership API  
**Severity:** 🔴 HIGH — Feature Gap  
**File:** `packages/api/src/routes/tickets.ts` (queue endpoints)

**Problem:**  
The `ticket_queues` table exists but has no `agent_ids` array or join table linking agents to queues. The PATCH queue endpoint only updates `name`, `description`, `color`, `routing_method`. There is no endpoint to:
- Add an agent to a queue
- Remove an agent from a queue
- List which agents belong to a queue

The `push_random` and `push_criteria` routing methods therefore have no agent pool to push to, making them non-functional.

**Fix Required:**  
1. Add a `queue_members` join table: `(queue_id UUID, user_id UUID, PRIMARY KEY(queue_id, user_id))`
2. Add endpoints:
   - `POST /api/v1/tickets/queues/:id/members` — add agent(s) to queue
   - `DELETE /api/v1/tickets/queues/:id/members/:userId` — remove agent from queue
   - `GET /api/v1/tickets/queues/:id/members` — list queue members
3. Update routing logic to draw from `queue_members` when assigning tickets.

---

## Gap 3 — Previous Assignee Not Notified on Reassignment  
**Severity:** 🟠 MEDIUM — UX / Ops Gap  
**File:** `packages/api/src/routes/tickets.ts` (POST `/:id/assign`)

**Problem:**  
When a ticket is reassigned from Agent A to Agent B, Agent A receives no notification. Only Agent B receives an in-app and email notification. Agent A may continue working on the ticket unaware of the handover.

**Fix Required:**  
In the assign endpoint, after updating `assignee_id`:
- Check if there was a previous `assignee_id` that differs from the new one
- If so, send a notification to the previous assignee: "Ticket #XXX has been reassigned to [new agent name]"
- Write an audit log entry: `action = 'ticket_reassigned', from_user = old_assignee, to_user = new_assignee`

---

## Gap 4 — CSAT Survey Expiry is Hardcoded  
**Severity:** 🟠 MEDIUM — Configurability Gap  
**File:** `packages/core/src/database/migrations/007_complaint_enhancements.sql`

**Problem:**  
The 7-day CSAT survey expiry is set as a column default in the migration:  
`expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'`  
There is no tenant-level setting or admin panel field to change this.

**Fix Required:**  
1. Add `csat_expiry_days INTEGER DEFAULT 7` to `tenants.settings` (JSONB field or new column)
2. When creating a CSAT survey, read `tenant.settings.csat_expiry_days` and compute `expires_at = NOW() + INTERVAL '${days} days'` dynamically
3. Expose this setting in the Settings module UI under "CSAT Configuration"

---

## Gap 5 — No Tag Management System  
**Severity:** 🟠 MEDIUM — Data Quality Risk  
**File:** `packages/api/src/routes/tickets.ts` (ticket create/update)

**Problem:**  
Ticket tags are stored as a `text[]` array. There is no:
- Predefined tag list (tags are free-text)
- Tag CRUD API (no way to rename or delete a tag across tickets)
- Tag cleanup (orphaned/misspelled tags accumulate silently)
- Tag analytics (heatmap uses frequency counts but the underlying data can be noisy)

**Fix Required:**  
1. Add a `ticket_tags` table: `(id UUID, tenant_id UUID, name TEXT, color TEXT, UNIQUE(tenant_id, name))`
2. Add endpoints: `GET/POST/PATCH/DELETE /api/v1/tickets/tags`
3. On ticket create/update, validate submitted tags against `ticket_tags` — reject unknown tags or auto-create them (configurable per tenant)
4. Add a `DELETE /api/v1/tickets/tags/:id` that also removes the tag from all tickets (bulk update)

---

## Gap 6 — Comments Not Available as Standalone Endpoint  
**Severity:** 🟡 LOW — API Design  
**File:** `packages/api/src/routes/tickets.ts`

**Problem:**  
Ticket comments are embedded inside `GET /tickets/:id` and not available at a standalone `GET /tickets/:id/comments` endpoint. Front-end clients that want to poll for new comments (e.g., a live chat-style view) must fetch the entire ticket object each time.

**Fix Required:**  
Add `GET /api/v1/tickets/:id/comments` — returns only the `comments` array for the ticket, paginated, with optional `?since=<timestamp>` filter for polling.

---

## Gap 7 — Silent SMS Failure With No Admin Alert  
**Severity:** 🟠 MEDIUM — Ops Visibility  
**File:** `packages/core/src/sms.service.ts`

**Problem:**  
When no SMS/WhatsApp connector is configured, `SmsService.send()` returns `{ success: false, error: 'No SMS gateway configured' }` silently. No in-app notification is raised, no email is sent to the tenant admin, and no error appears in the platform UI.

**Fix Required:**  
When `SmsService` detects no connector is configured and a message was attempted:
1. Publish an internal platform event: `SMS_GATEWAY_MISSING`
2. Send an in-app notification to the tenant admin: "Customer notification via SMS could not be sent — no SMS connector is configured. Please configure a connector under Settings → Integrations."
3. Optionally: queue the failed message for retry once a connector is configured.

---

## Gap 8 — Department Override Uses Fragile Keyword Matching  
**Severity:** 🟡 LOW — Logic Risk  
**File:** `packages/api/src/routes/settings.ts` (`departmentPermissions()` function)

**Problem:**  
Department permission overrides check whether certain keywords appear *anywhere* in the department name string (e.g., `.includes('support')`). This can produce unexpected results:
- A department named "IT Support" triggers both the `technical` AND `support` keyword, applying two different override sets
- A department named "Operations Support" would also trigger the `support` rule unexpectedly

**Fix Required:**  
Replace keyword matching with a structured `department_type` enum column on the `users` table or a dropdown in the invite/edit UI. The enum values should match the six defined override categories: `support`, `complaint`, `sales`, `compliance_audit`, `finance_billing`, `technical_operations`. Apply overrides based on the enum value, not string matching.

---

## Gap 9 — Voice Module Cannot Be Self-Service Enabled by Tenant  
**Severity:** 🟡 LOW — Self-Service Gap  
**File:** `packages/api/src/routes/super-admin.ts`

**Problem:**  
The `voicebot` module can only be added to a tenant's `active_modules` array via the super admin panel (`PATCH /super-admin/tenants/:id/modules`). Tenant admins have no self-service way to enable or disable voice features for their organisation.

**Fix Required:**  
Add a tenant-admin-accessible endpoint or settings panel toggle: `PATCH /api/v1/settings/workspace/modules` — allows a tenant admin to enable/disable non-billing-gated modules (voice, voicebot, integrations) within the limits of their subscription plan. Super admin retains the ability to hard-lock modules regardless.

---

## Summary Table

| # | Gap | Severity | Est. Effort |
|---|-----|----------|-------------|
| 1 | First-response SLA not enforced by worker | 🔴 HIGH | 1–2 days |
| 2 | No queue agent membership API | 🔴 HIGH | 1–2 days |
| 3 | Previous assignee not notified on reassignment | 🟠 MEDIUM | 0.5 day |
| 4 | CSAT expiry hardcoded (not configurable) | 🟠 MEDIUM | 0.5 day |
| 5 | No tag management system | 🟠 MEDIUM | 2–3 days |
| 6 | Comments not available as standalone endpoint | 🟡 LOW | 0.5 day |
| 7 | Silent SMS failure, no admin alert | 🟠 MEDIUM | 0.5 day |
| 8 | Department override uses fragile keyword match | 🟡 LOW | 1 day |
| 9 | Voice module not self-service for tenants | 🟡 LOW | 1 day |

**Total estimated remediation effort: ~9–12 developer-days**

---
*End of CODE_GAPS.md*
