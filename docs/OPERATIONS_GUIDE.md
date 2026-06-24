# Operations Guide
**AI Operations Platform — How It Works for Your Team**
_Plain-language reference for workspace managers, agents, and admins.
Updated automatically on every release. Each section covers one feature: who uses it, what it does, and exactly how to operate it._

Last updated: 2026-06-24

---

## Table of Contents

- [Ticketing & Contact Centre](#ticketing--contact-centre)
  - [SLA Policies — Response & Resolution Timers](#sla-policies--response--resolution-timers)
  - [Business Hours — When the SLA Clock Ticks](#business-hours--when-the-sla-clock-ticks)
  - [Pause on Pending — Stop the Clock While Waiting](#pause-on-pending--stop-the-clock-while-waiting)
  - [Holiday Calendar — Automatic SLA Pause on Public Holidays](#holiday-calendar--automatic-sla-pause-on-public-holidays)
  - [First Reply Time — Measuring Agent Responsiveness](#first-reply-time--measuring-agent-responsiveness)
  - [Smart Policy Matching — Right SLA for Every Ticket](#smart-policy-matching--right-sla-for-every-ticket)
- [Access & Roles](#access--roles)
  - [Entitlements — Licensing Modules per Workspace](#entitlements--licensing-modules-per-workspace)
  - [Role Permissions — What Each Team Member Can Do](#role-permissions--what-each-team-member-can-do)

---

# Ticketing & Contact Centre

---

## SLA Policies — Response & Resolution Timers

**Module:** Ticketing / Contact Centre
**Who it affects:** Managers (create & manage policies) · Agents (work under them) · Supervisors & Admins (receive escalation alerts)

### What it does
An SLA (Service Level Agreement) policy sets the maximum time your team has to respond to and resolve a ticket. It also defines what happens if those deadlines are at risk — automatically reminding and escalating before a breach occurs.

### Who can do what

| Role | Can do |
|---|---|
| Manager | Create, edit, delete SLA policies |
| Tenant Admin | View policies (cannot edit operational settings) |
| Agent | Works under the policy assigned to their ticket — no direct access |
| Supervisor / L1 | Receives escalation notifications when threshold is crossed |
| Admin / L2 | Receives critical escalation when breach is imminent |

### How to use it — step by step

1. Go to **SLA Policies** in the left sidebar (bottom section).
2. Click **New Policy**.
3. Fill in the policy name and select the **priority tier** it applies to (Urgent, High, Medium, or Low).
4. Set the **First Response** deadline — how long until an agent must first reply.
5. Set the **Resolution** deadline — total time to fully close the ticket.
6. Add **escalation steps** using the schedule builder:
   - **Reminder** — notifies the assigned agent at a % of time elapsed (e.g. 75%).
   - **L1 Escalation** — notifies supervisors and managers (e.g. at 90%).
   - **L2 Escalation** — notifies admins for critical/imminent breaches (e.g. at 100%).
7. Click **Save Policy**.

### Example scenario
> JS Bank sets a High-priority SLA: first response in 2 hours, resolution in 8 hours.
> Escalation steps: reminder to agent at 75% (6 hrs), L1 to supervisors at 90% (7.2 hrs), L2 to admins at 100%.
> When a card-dispute ticket comes in marked High, it auto-assigns this policy. If the agent hasn't replied by hour 1.5, they get a reminder. At hour 7.2 the supervisor is alerted.

### Rules & limits
- Each policy applies to one priority tier (Urgent / High / Medium / Low).
- Multiple policies can exist for the same priority — the most specific one wins (see Smart Policy Matching).
- SLA clock starts when an agent **accepts** the ticket, not when it is created.
- Deleting a policy does not affect tickets already assigned to it.

---

## Business Hours — When the SLA Clock Ticks

**Module:** Ticketing / Contact Centre
**Who it affects:** Managers (configure per policy) · Agents (affects their deadlines)

### What it does
Allows each SLA policy to count time only during your defined working hours. Tickets raised at 11 PM on a Friday won't burn through the weekend — the clock only ticks on the days and hours you specify.

### How to use it — step by step

1. Open an SLA policy (New or Edit).
2. Toggle **Business Hours Only** on.
3. A day-by-day schedule appears. Enable each working day and set its start/end time.
4. Days left off (e.g. Saturday, Sunday) are fully excluded from the SLA countdown.
5. Save the policy.

### Example scenario
> The Medium-priority SLA is set to business hours: Mon–Fri, 09:00–18:00.
> A ticket arrives Friday at 5 PM with a 4-hour resolution target.
> Only 1 hour counts on Friday (5–6 PM). The remaining 3 hours count from Monday 9 AM. The actual clock-deadline is Monday 12 PM — not Saturday 9 AM.

### Rules & limits
- Business hours are set per policy, not globally. A 24/7 call-centre policy can run with hours off; a back-office policy can run Mon–Fri only.
- If business hours are off, the SLA clock runs 24/7 from ticket acceptance.

---

## Pause on Pending — Stop the Clock While Waiting

**Module:** Ticketing / Contact Centre
**Who it affects:** Managers (enable per policy) · Agents (pause by setting ticket to Pending)

### What it does
When an agent is waiting for the customer to respond — e.g. awaiting documents, a callback, or more information — they can set the ticket to **Pending**. If the SLA policy has this toggle enabled, the SLA clock pauses automatically and only resumes when the customer replies.

### How to use it — step by step

1. Open or create an SLA policy.
2. Toggle **Pause SLA when waiting for customer** on.
3. Save the policy.
4. When an agent is waiting, they change the ticket status to **Pending / Waiting for Customer**.
5. The SLA clock pauses. A "⏸ Paused" badge appears on the ticket.
6. When the customer replies, the ticket moves back to Open and the clock resumes.

### Example scenario
> A loan-query ticket has an 8-hour resolution SLA. At hour 3, the agent requests documents from the customer and marks the ticket Pending. The clock freezes at 3 hrs elapsed. The customer replies 2 days later. The clock resumes — the agent still has 5 hours left, not 0.

### Rules & limits
- Only policies with this toggle on will pause. Policies without it keep running regardless of ticket status.
- If an agent forgets to set the ticket to Pending, the clock does not pause — status must be explicitly changed.

---

## Holiday Calendar — Automatic SLA Pause on Public Holidays

**Module:** Ticketing / Contact Centre
**Who it affects:** Managers (manage the calendar) · All agents (SLA deadlines shift automatically)

### What it does
Managers define a list of public holidays for the workspace. On those dates, SLA clocks pause across all policies — no agent is penalised for time that falls on a holiday. Holidays can be set to recur yearly so they don't need to be re-entered each year.

### How to use it — step by step

1. Go to **SLA Policies** → click the **🗓 Holidays** tab.
2. Click **Add Holiday**.
3. Enter the holiday name (e.g. "Eid Al-Fitr"), the date, and tick **Repeat every year** if it recurs annually.
4. Click **Add Holiday** — it appears in the list immediately.
5. To edit a holiday (e.g. update next year's date), click the pencil icon.
6. To remove a holiday, click the bin icon.

### Example scenario
> JS Bank adds Pakistan Day (23 March) and Eid Al-Fitr (31 March) to the holiday calendar, both set to recurring.
> A High-priority ticket arrives on 22 March at 4 PM with an 8-hour resolution deadline. 2 hours tick on 22 March. Pakistan Day (23 March) is skipped entirely. The remaining 6 hours count from 24 March. The agent has until 24 March 6 AM — not 23 March 12 AM.

### Rules & limits
- The holiday calendar is workspace-wide — it applies to all SLA policies and all departments equally.
- If your call centre operates on public holidays, the current calendar still pauses their SLA. Per-department holiday profiles are a planned enhancement (see Backlog).
- Recurring holidays repeat on the same day and month each year automatically.
- Two holidays cannot share the same date — if you try to add one that already exists, it updates the existing entry.

---

## First Reply Time — Measuring Agent Responsiveness

**Module:** Ticketing / Contact Centre
**Who it affects:** Managers & Supervisors (performance reporting) · Agents (awareness of responsiveness metric)

### What it does
Tracks the exact moment an agent first sends a public reply to a customer — separate from the SLA deadline timer. This gives a clean measure of how fast your team actually responds, unaffected by clock pausing, business hours, or pending states.

### How it works
- When any agent posts a public reply (not an internal note) on a ticket for the first time, the system automatically records the timestamp as **First Reply Time**.
- This is stamped once and never overwritten — subsequent replies don't change it.
- It is separate from the SLA First Response metric, which can be paused or adjusted by policy settings.

### Example scenario
> A ticket arrives at 10:00 AM. The SLA is business-hours only so the clock doesn't start until 9 AM the next working day. But the agent replies at 10:45 AM on the same day. First Reply Time is recorded as 45 minutes — accurately reflecting real agent responsiveness regardless of the SLA configuration.

### Rules & limits
- Only public replies count — internal notes between agents do not stamp this.
- The metric is read-only and set automatically. Agents cannot manually set or clear it.
- First Reply Time is stored for reporting and future dashboard display.

---

## Smart Policy Matching — Right SLA for Every Ticket

**Module:** Ticketing / Contact Centre
**Who it affects:** Managers (configure match conditions) · Agents (automatically get the correct SLA)

### What it does
Allows multiple SLA policies to exist for the same priority tier, each applying only to tickets that match specific conditions — channel (email, phone, chat), department, or tags. The most specific matching policy wins. This means a phone complaint, an email complaint, and a VIP-tagged complaint can all be High priority but each get a different SLA.

### How to use it — step by step

1. Open or create an SLA policy.
2. Scroll to **Smart Matching Conditions**.
3. Enter comma-separated values for any combination of:
   - **Channels** — e.g. `email, chat`
   - **Departments** — e.g. `Support, Complaints`
   - **Tags** — e.g. `vip, fraud`
4. Leave a field blank to match any value for that dimension.
5. Save the policy.
6. Create a second (catch-all) policy for the same priority with **no conditions set** — this is the fallback for tickets that don't match any specific policy.

### How matching works
The system scores each active policy by how many conditions it has set. The most conditions = highest priority match. If a ticket matches multiple policies, the most specific one wins. If nothing matches, the least specific (catch-all) policy is used.

### Example scenario
> JS Bank has two High-priority policies:
> - **"Email Support SLA"** — channels: `email`, departments: `Support` → 2-hour first response.
> - **"High Priority Catch-All"** — no conditions → 4-hour first response.
>
> An email ticket from the Support department gets the 2-hour policy.
> A phone call ticket gets the catch-all 4-hour policy.
> Both are High priority — but each gets the right deadline.

### Rules & limits
- All conditions within a policy use AND logic — a ticket must match channel AND department AND tags (whichever are set).
- A blank condition field means "match anything" for that dimension.
- Always create a catch-all policy (no conditions) as a fallback for each priority tier, otherwise unmatched tickets get no SLA.
- Conditions are evaluated at ticket creation and on priority change.

---

# Access & Roles

---

## Entitlements — Licensing Modules per Workspace

**Module:** Super Admin / Platform
**Who it affects:** Super Admin (controls what each workspace can access) · Tenant Admins (see only what is licensed)

### What it does
The platform super admin controls which modules and features each workspace (tenant) is licensed to use. Unlicensed modules are hidden from navigation and blocked at the API level — tenant staff simply don't see features their organisation hasn't purchased.

### How to use it — step by step

1. Log in as **Super Admin**.
2. Go to **Workspaces** → select a workspace → **Edit**.
3. Under **Licensed Modules**, toggle on the modules this workspace has purchased (e.g. Ticketing, Voice Bot, Analytics).
4. Save. The workspace's navigation updates immediately — unlicensed modules disappear.

### Rules & limits
- Entitlements are set at workspace creation and can be updated at any time by the super admin.
- A tenant admin cannot grant their staff access to unlicensed modules, even if they try to via the Roles screen.

---

## Role Permissions — What Each Team Member Can Do

**Module:** Settings / Access Control
**Who it affects:** Tenant Admins (configure roles) · All staff (work within their assigned permissions)

### What it does
Each workspace has a hierarchy of roles: Admin, Manager, Agent, Viewer, plus custom roles. The tenant admin controls exactly which actions each role can perform — create, read, edit, delete — per module. Role permissions can only be set up to the ceiling of what the workspace is licensed for.

### Role hierarchy

| Role | Default purpose |
|---|---|
| Tenant Admin | Workspace configuration only — no operational access |
| Manager | Day-to-day operational management — queues, SLA, routing, team |
| Agent | Handles tickets, contacts, calls |
| Viewer | Read-only access across modules |
| Custom roles | Any combination defined by the tenant admin |

### Rules & limits
- Tenant Admin is deliberately blocked from operational routes — they configure the workspace but do not handle tickets or customer data.
- Permissions cannot exceed what the workspace is entitled to (licensing ceiling).
- Four system roles are auto-seeded on workspace creation. Custom roles can be added but not system ones deleted.
