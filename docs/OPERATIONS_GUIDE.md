# Operations Guide
**AI Operations Platform — How It Works for Your Team**
_Plain-language reference for workspace managers, agents, and admins.
Updated automatically on every release. Each section covers one feature: who uses it, what it does, and exactly how to operate it._

Last updated: 2026-07-17 (push 3)

---

## Super Admin Login — No Workspace Needed (updated — 2026-07-17)

**Who uses it:** Super Admin only.

**What changed:** the login page's Workspace field is no longer required for the Super Admin account — leave it blank and sign in with just email and password. A hint under the field says "Platform admin? Leave this blank." Everyone else (tenant admins, managers, agents, viewers) still needs their workspace name as before.

## Super Admin Navigation — Moved to Sidebar (updated — 2026-07-17)

**Who uses it:** Super Admin only.

**What changed:** the row of section tabs (Dashboard, Tenants, Billing, Module Catalogue, etc.) used to sit at the top of the page and would overflow off-screen. It now lives in the left sidebar instead, same as every other role's navigation.

## Role Testing — All 5 Access Levels Confirmed (2026-07-17)

Every access level — Super Admin, Tenant Admin, Manager, Agent, Viewer — has now been checked across all 8 workspaces. Three backend errors were found and fixed during this pass (team performance reports, and two Super Admin billing reports were crashing) — all now working. A few longer-standing access-design questions remain open for your decision (see the audit report you already have) and are unaffected by this push.

---

## Shared SMS Gateway (new — 2026-07-17)

**Who uses it:** Super Admin decides who gets it; once enabled, it's invisible to the tenant — SMS just works.

**What it does:** normally a workspace has to set up its own SMS provider account before it can text customers. Now, if AmanahCX enables the shared gateway for a workspace, that workspace can send SMS immediately with zero setup — through AmanahCX's own account instead. If the workspace later configures their own gateway, their own takes priority automatically.

**Note:** this needs a real provider account connected on AmanahCX's side before any message can actually go out — until then, enabling it has no effect (safe to turn on early).

---

## Voice Bot Cost Tracking (new — 2026-07-17)

**Who uses it:** Super Admin, under Reports → Voice Bot Cost.

**What it does:** shows what each workspace's Nadia voice bot usage costs per month, based on a per-minute rate you set for them. Change the month at the top to see any past month's cost.

---

## Notification Preferences & Active Sessions (new — 2026-07-17)

**Who uses it:** anyone with a login — find it under your profile menu ("My Settings") or the Settings sidebar.

**What it does:**
- **Notifications tab** — choose which alerts you get by email vs. in-app (new ticket assigned, SLA breach, deal won/lost, user changes, and more). Flip any toggle, click Save — it's now permanent and follows you across logins and devices.
- **Security tab → Active Sessions** — shows every device currently logged into your account (browser + rough device type, when it last logged in). If you don't recognize one, click Revoke to sign it out immediately — the next request from that device is rejected.

**Why it changed:** these two screens existed before but weren't actually saving anything — toggles reset every time you reloaded the page, and Active Sessions showed made-up example data. Both are now fully real.

---

## Field Mobile App (AmanahCX for Android)

**Who uses it:** field sales officers, delivery/repair staff, and their managers.

**What it does:** field staff carry the CRM in their pocket. They see only the work assigned to them, capture new leads on the spot, and close out customer visits — everything lands in the same CRM the office uses, instantly.

**How to operate it:**
1. **Log in** with your normal CRM email and password (workspace, email, password). You land on **My Tasks** — the jobs assigned to you, with To do and Done counters.
2. **Open a job** to see the customer, due time, and notes. Buttons: **Call** the customer, **Navigate** (opens Google Maps), **Check in** (records your arrival location).
3. **Finish a job:** type what was done in the remarks box and tap **Mark job complete**. You'll be asked to confirm. The CRM records the completion time, your location, and your remarks — and emails the customer a confirmation automatically.
4. **Capture a lead** three ways: type it, **photograph a visiting card** (AI fills the form), or **speak it** (English, Urdu or Punjabi — AI sorts your words into name/company/phone). You always review and confirm before anything is saved.
5. **Create a task by voice:** "Call Ahmed tomorrow at 3pm about the bulk order" — the app sets the type, due time, priority, and links the contact automatically. Confirm before saving.
6. **No internet? Keep working.** Leads and tasks saved offline queue on the phone and push to the CRM automatically the moment a connection returns. The dashboard shows how many items are waiting to sync.

---

## Table of Contents

- [Home Dashboard — Role-Aware Home Screen](#home-dashboard--role-aware-home-screen)
- [Ticketing & Contact Centre](#ticketing--contact-centre)
  - [SLA Policies — Response & Resolution Timers](#sla-policies--response--resolution-timers)
  - [Business Hours — When the SLA Clock Ticks](#business-hours--when-the-sla-clock-ticks)
  - [Pause on Pending — Stop the Clock While Waiting](#pause-on-pending--stop-the-clock-while-waiting)
  - [Holiday Calendar — Automatic SLA Pause on Public Holidays](#holiday-calendar--automatic-sla-pause-on-public-holidays)
  - [First Reply Time — Measuring Agent Responsiveness](#first-reply-time--measuring-agent-responsiveness)
  - [Smart Policy Matching — Right SLA for Every Ticket](#smart-policy-matching--right-sla-for-every-ticket)
  - [CSAT Survey — Measuring Customer Satisfaction](#csat-survey--measuring-customer-satisfaction)
  - [SLA Breach Alerts — Automatic Warnings & Escalations](#sla-breach-alerts--automatic-warnings--escalations)
- [Email & Notifications](#email--notifications)
  - [Email Deliverability — Sending from Your Domain](#email-deliverability--sending-from-your-domain)
- [Access & Roles](#access--roles)
  - [Entitlements — Licensing Modules per Workspace](#entitlements--licensing-modules-per-workspace)
  - [Role Permissions — What Each Team Member Can Do](#role-permissions--what-each-team-member-can-do)
  - [Resetting a User's Password (Tenant Admin)](#resetting-a-users-password-tenant-admin)
  - [Department Type](#department-type)
  - [Config Ownership — Centrally Managed Voice Bot & Integrations](#config-ownership--centrally-managed-voice-bot--integrations)
- [Ticket Visibility & Department Guards](#ticket-visibility--department-guards)
  - [Who Sees Which Tickets](#who-sees-which-tickets)
  - [Cross-Department Originator View](#cross-department-originator-view)
- [Reports Hub — Downloadable CSV Reports](#reports-hub--downloadable-csv-reports)
  - [Manager Reports](#manager-reports)
  - [Agent Reports](#agent-reports)
- [Ops Dashboard — Live KPI Strip](#ops-dashboard--live-kpi-strip)
- [Ticket-Contact Linking — Every Ticket Needs a Customer](#ticket-contact-linking--every-ticket-needs-a-customer)
- [Creating a Ticket Without an Existing Contact](#creating-a-ticket-without-an-existing-contact-auto-customer-creation)
- [Managers Can Now See Unclaimed Tickets](#managers-can-now-see-unclaimed-tickets-waiting-to-be-picked-up)
- [Communication Consent — WhatsApp, SMS & Email Opt-In](#communication-consent--whatsapp-sms--email-opt-in)
- [Nadia — Self-Hosted Voice Agent](#nadia--self-hosted-voice-agent-in-setup-not-yet-live)

---

# Home Dashboard — Role-Aware Home Screen

---

## Home Dashboard — Role-Aware Home Screen

**Module:** Platform Core
**Who it affects:** All logged-in users — each role sees a different view tailored to their job

### What it does
The dashboard is the first screen every user sees after login. It automatically shows the right information for each role — an agent sees their own tickets and call queue, a manager sees their full team's performance, and a tenant admin sees workspace health. All data is filtered to the user's department automatically.

### Who sees what

| Role | Dashboard view | Key information shown |
|---|---|---|
| **Agent** | Personal performance | My open tickets, SLA countdown, TAT status, my recent calls, activity due today |
| **Manager** | Team overview | Team ticket counts, agent leaderboard, bot stats, SLA breaches, calls in queue, recent open tickets |
| **Tenant Admin** | Workspace health | Total users, role/department breakdown, voice bot status, email delivery health |
| **Viewer** | Read-only personal view | Own tickets and activities (no edit access) |

### Department scoping
If a user belongs to a department (Sales, Support, Complaints), all dashboard metrics are automatically filtered to that department only. A banner at the top of the dashboard confirms which department is active. This ensures agents and managers only see data relevant to their team.

### Quick action buttons
Each role gets a row of quick-access buttons at the top of the dashboard matching their most common tasks:
- **Agents/Managers:** New Ticket, Voice Calls, Bot Calls, Reports
- **Tenant Admin:** Manage Users, Roles, Voice Bot, Email Logs

### Live refresh
The dashboard refreshes automatically every 30 seconds. A manual refresh button is available in the top right corner showing when data was last updated.

### Example scenario
> Munir logs in as Manager in the Complaints department. He sees "Good evening, Munir — Manager View · Complaints Dept". The dashboard shows his team's complaint tickets only: 12 open, 3 breaching SLA, 2 calls in queue. The agent leaderboard shows each agent's tickets and calls for today. All other departments' data is hidden.

### Rules & limits
- The dashboard is available to all roles — it is the home screen and cannot be disabled.
- Data scope is determined at login by the user's role and department — it cannot be manually overridden from the dashboard.
- Tenant Admin dashboard shows workspace configuration health only — no ticket or call operational data (by design: admins configure, agents operate).

---

# Ticketing & Contact Centre

---

## SLA Policies — Response & Resolution Timers

**Module:** Ticketing / Contact Centre
**Who it affects:** Policy Admin (create & manage policies) · Agents (work under them) · Supervisors & Admins (receive escalation alerts)

### What it does
An SLA (Service Level Agreement) policy sets the maximum time your team has to respond to and resolve a ticket. It also defines what happens if those deadlines are at risk — automatically reminding and escalating before a breach occurs.

> **Governance note (added 2026-06-29):** SLA policies are now managed exclusively by the **Policy Admin** role. Managers and tenant admins cannot create, edit, or delete SLA policies. This is a deliberate separation of duties — the person setting the rules should not be the person measured against them.

### Who can do what

| Role | Can do |
|---|---|
| **Policy Admin** | Create, edit, delete SLA policies (only role with this access) |
| Manager | View tickets and SLA countdowns — cannot edit policies |
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

## CSAT Survey — Measuring Customer Satisfaction

**Module:** Ticketing / Contact Centre
**Who it affects:** All customers (receive the survey) · Agents (see score on their resolved tickets) · Managers & Admins (review scores in reports)

### What it does
When a ticket is closed, the platform automatically emails the customer a one-question satisfaction survey. The customer clicks a link, chooses 1–5 stars, and optionally leaves a comment. The score is recorded against the ticket and is visible to the handling agent and managers.

### How it works — step by step

**For the customer:**
1. Agent closes the ticket.
2. Customer receives an email: "How did we do? — Ticket #TKT-XXXXX".
3. Customer clicks the link → a clean survey page opens (no login required).
4. Customer selects 1–5 stars and optionally types a comment.
5. Clicks **Submit Feedback** → sees a thank-you screen.
6. Survey link expires after 7 days.

**For agents and managers:**
1. Open any resolved ticket → scroll to the **Customer Satisfaction** card in the detail panel.
2. If the customer has responded: shows the star rating and comment.
3. If the customer hasn't responded yet: shows "Survey sent — awaiting customer response".

**For managers (aggregate view):**
1. The CSAT summary API (`/api/v1/tickets/csat/summary`) returns: average rating, response rate %, and breakdown by star (1–5).
2. The full list (`/api/v1/tickets/csat`) shows all responses with ticket number, subject, rating, comment, and date.

### Rating scale

| Stars | Label |
|---|---|
| ⭐ (1) | Very dissatisfied |
| ⭐⭐ (2) | Dissatisfied |
| ⭐⭐⭐ (3) | Neutral |
| ⭐⭐⭐⭐ (4) | Satisfied |
| ⭐⭐⭐⭐⭐ (5) | Very satisfied |

### Example scenario
> A customer calls about a blocked debit card. The agent resolves the ticket within 2 hours. An email is sent automatically: "Hi Ahmed, how did we do with ticket TKT-00123?" Ahmed clicks the link, gives 5 stars, and writes "Very fast and helpful." The agent and their manager can see the 5-star rating on the ticket record.

### Rules & limits
- The survey is sent only if the ticket has a **reporter email** on record.
- Each ticket gets one survey — sending is idempotent (no duplicate emails on re-close).
- Survey links expire after 7 days by default (configurable per workspace via `csat_expiry_days` in tenant settings).
- A customer can only submit once — the link is blocked on a second attempt.
- The survey page works on any device — no login, no app required.

---

## SLA Breach Alerts — Automatic Warnings & Escalations

**Module:** Ticketing / SLA
**Who it affects:** Agents (receive warnings) · Managers & Supervisors (receive breach alerts) · Admins (receive critical escalation emails)

### What it does
The platform watches every open ticket's SLA deadline continuously. When a ticket is getting close to or has missed its deadline, it automatically sends both an in-app notification AND an email — no manual action required.

### Three escalation stages

| Stage | When it fires | Who gets notified |
|---|---|---|
| **Warning** | When 80% of the SLA time has passed (e.g. 6.4 hrs into an 8-hr SLA) | The assigned agent only |
| **Breach (L1)** | When the SLA deadline is missed (100%) | The assigned agent + all managers in the workspace |
| **Critical (L2)** | When the ticket is 50% past its deadline (150%) | All workspace admins |

Each stage sends:
- An **in-app bell notification** (visible on the top bar inside the CRM)
- An **email** to each relevant person with the ticket number, subject, and how much time is remaining or overdue

### How to configure the warning threshold
The 80% warning threshold is set per SLA policy. To change it:
1. Go to **SLA Policies** in the sidebar.
2. Open the policy you want to adjust.
3. Set the **Reminder** escalation step to the percentage you want (e.g. 75% for an earlier warning).

### Example scenario
> An Urgent ticket (4-hour SLA) is accepted at 9:00 AM. By 12:12 PM (3h 12m = 80%), the assigned agent receives an email and in-app notification: "⏰ SLA Reminder — TKT-00456 — 48 minutes remaining." At 1:00 PM (100%) the agent and all managers receive a breach alert. If still unresolved at 3:00 PM (150%), all admins receive a critical escalation email.

### Rules & notes
- Each stage fires once per ticket — no repeated reminders.
- The system checks every 5 minutes automatically. No setup required.
- Notifications are only sent if the ticket has an assigned agent.
- Emails are sent using your configured email provider (SendGrid or other).

---

# Email & Notifications

---

## Email Deliverability — Sending from Your Domain

**Module:** Platform Core / Integrations
**Who it affects:** Super Admin (DNS configuration) · All users (reliable email delivery)

### What it does
The platform sends system emails on your behalf — password resets, onboarding invitations, and ticket notifications. For these to land reliably in inboxes (not spam), the sending domain (`vividsns.com`) must be authenticated with SendGrid via SPF and DKIM DNS records.

### Why this matters
Without domain authentication, emails sent via SendGrid from `noreply@vividsns.com` will fail spam filters at Gmail, Outlook, and corporate mail servers. Customers will not receive their onboarding passwords, and ticket notifications will be silently discarded.

### One-time setup — DNS records to add

Log in to your DNS provider (wherever `vividsns.com` is registered) and add the following records. SendGrid will provide the exact values when you complete domain authentication in their dashboard — the steps below tell you where to find them.

**Step by step:**

1. Log in to [app.sendgrid.com](https://app.sendgrid.com).
2. Go to **Settings → Sender Authentication → Authenticate Your Domain**.
3. Select your DNS host, enter `vividsns.com`, and click **Next**.
4. SendGrid will show you **3 DNS records** to add — two CNAME records (DKIM) and one TXT record (SPF).
5. Log in to your domain registrar and add all three records exactly as shown.
6. Back in SendGrid, click **Verify** — it will confirm when DNS has propagated (usually within minutes, up to 48 hours).

**Record types you'll add:**

| Type | Purpose | Where to add |
|---|---|---|
| TXT | SPF — tells mail servers SendGrid is authorised to send on behalf of vividsns.com | @ or root of domain |
| CNAME × 2 | DKIM — cryptographically signs each outgoing email so it cannot be spoofed | Two subdomains provided by SendGrid |

### After DNS is verified

Once SendGrid shows the domain as verified, all system emails will:
- Pass SPF and DKIM checks at recipient mail servers
- Display `noreply@vividsns.com` as the sender (not a generic SendGrid address)
- Land in inbox, not spam
- Pass enterprise email security gateways (important for bank/financial sector customers)

### Current sender configuration
- **From address:** `noreply@vividsns.com`
- **From name:** `Vivid CRM`
- **Provider:** SendGrid (system-level fallback; individual tenants can configure their own SMTP/SendGrid/Microsoft 365 connector in Integrations)

### Rules & limits
- This setup is a one-time DNS change — it does not need to be repeated.
- Each tenant can override the system sender by configuring their own email connector in **Settings → Integrations**.
- Never change the `SENDGRID_FROM_EMAIL` to a Gmail or free-email address — these cannot be authenticated and will cause delivery failures.

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
| **Policy Admin** | SLA governance only — creates and manages SLA policies, no operational access |
| Agent | Handles tickets, contacts, calls |
| Viewer | Read-only access across modules |
| Custom roles | Any combination defined by the tenant admin |

### Rules & limits
- Tenant Admin is deliberately blocked from operational routes — they configure the workspace but do not handle tickets or customer data.
- Permissions cannot exceed what the workspace is entitled to (licensing ceiling).
- Five system roles are auto-seeded on workspace creation. Custom roles can be added but not system ones deleted.

---

## Resetting a User's Password (Tenant Admin)

**Module:** People / Users
**Who it affects:** Tenant Admins (trigger the reset) · the affected user (sets a new password)

### What it does
A Tenant Admin can reset any team member's password directly from the Users page — no need to wait for the user to use "Forgot password?" themselves. Open the row menu (⋮) next to any user and choose **Reset Password**.

This generates a secure link valid for **24 hours**. The system tries to email it to the user automatically, but the link is always shown on screen with a **Copy** button regardless of whether that email succeeds — so an admin can share it manually (WhatsApp, in person, etc.) if email delivery isn't working for that workspace.

### Rules & limits
- Only Tenant Admins (and the platform's own Super Admin) can trigger a reset for someone else.
- The link expires after 24 hours; if unused, trigger a new one.
- Whoever uses the link lands on the same "Set new password" screen a first-time invite uses.

---

## Department Type

**Module:** Departments
**Who it affects:** Tenant Admins

### What it does
Every department has a **Type** — Sales, Support, Compliance, Finance, Technical, or Operations — set from a dropdown when creating or editing a department. This isn't just a label: it determines the default permissions a new team member gets when assigned to that department, so it's worth picking the closest match rather than leaving it as the "Operations" default.

---

## Config Ownership — Centrally Managed Voice Bot & Integrations

**Module:** Super Admin console
**Who it affects:** Super Admin (sets ownership) · Tenant Admin (sees the effect)

### What it does
For any workspace, the platform operator can decide who configures certain settings: the tenant admin themselves (the normal default), or the platform operator centrally. This is set from **Super Admin → Tenants → (tenant row) → ⋮ → Config Ownership**, with a separate switch for each of: Voice Bot, Channels & Services, Webhooks, and API Keys.

When an area is set to centrally managed:
- The tenant admin still sees the current settings on their own screen, but the edit controls are replaced with a message explaining it's managed by their platform provider.
- For Voice Bot specifically, the Super Admin gets a full editor right there in the same screen — bot name, greeting, tone, speaking speed, voice, language, guardrails, record-calls toggle, self-service topics, the full SIP trunk connection, and a Knowledge Base manager — the same set of options the tenant admin's own page has, so the whole thing can be configured without the tenant admin ever touching it.

### Rules & limits
- This is enforced on both the interface and the server — a workspace can't bypass a lock by calling the underlying system directly.
- Currently one Voice Bot per workspace (not yet per department — separate departments having their own bot is a planned future capability, not available yet).
- More integration types (email provider, SMS gateway, payments, etc.) will get the same fine-grained centralized control in a later update; today it's limited to the three categories above.

---

## Policy Admin — SLA Governance Role

**Module:** Access Control / SLA Policies
**Who it affects:** Tenant Admins (create policy_admin users) · Policy Admins (manage SLA policies)

### What it does
Policy Admin is a dedicated governance role for SLA policy management. It is completely separate from day-to-day operations: a policy admin does not handle tickets, contacts, or customers. Their sole job is to define and maintain the SLA rules that agents and managers work under.

This separation ensures the person setting the SLA targets is not the same person measured against them — a standard governance best practice.

### How to create a Policy Admin user

1. Go to **Settings → Admin Users**.
2. Click **Invite User**.
3. Enter name and email.
4. Under **Role**, select **Policy Admin**.
5. The normal Department field disappears and is replaced with **Departments to Govern** checkboxes (Sales / Support / Complaints).
6. Tick the departments this person will manage SLA policies for. Leave all unchecked to give them access to all departments.
7. Send the invite. The user receives a welcome email with a temporary password.

### What a Policy Admin can do

| Can do | Cannot do |
|---|---|
| Create, edit, delete SLA policies | Handle tickets |
| Tag each policy to a department | View contacts or deals |
| View the SLA Policies page | Access routing, queues, or agent stats |

### What others cannot do

- **Managers** — blocked from creating or editing SLA policies. They work under the policies set by the policy admin.
- **Tenant Admin** — blocked from SLA policy writes (admin separation of duties).

### Example

> JS Bank wants to ensure SLA targets are set by their Quality team, not their operations managers. The tenant admin creates a Policy Admin user for the QA lead and scopes them to "Support" and "Complaints". The QA lead logs in, sees only the SLA Policies page, and sets response/resolution targets. Managers see those targets applied to their tickets but cannot change them.

---

# Ticket Visibility & Department Guards

---

## Who Sees Which Tickets

**Module:** Ticketing
**Who it affects:** All agents and managers

### What it does
Every user's ticket list is automatically filtered by their role and department. No configuration is needed — the system enforces it on every request.

| Role | Tickets visible |
|---|---|
| **Agent** | Only tickets assigned to them personally |
| **Line Manager** | All tickets assigned to any of their direct and indirect reportees (their full team tree) |
| **Manager of Managers** | All tickets across their full reporting hierarchy, recursively |
| **Super Admin / Platform** | All tickets across all departments |

### Department boundaries
Each department has its own manager. Managers only see tickets within their own department's team tree:

- **Support Manager** → sees Support team tickets only
- **Complaints Manager** → sees Complaints team tickets only
- **Sales Manager** → sees Sales team tickets only

A Support Manager does **not** see Complaints or Sales tickets, even if all agents technically sit under one company.

### Department hierarchy (standard)
The platform follows the global standard for contact-centre CRMs — every operational department has its own dedicated manager:

| Department | Manager role | Agents |
|---|---|---|
| Support | Support Manager | Support Agents |
| Complaints | Complaints Manager | Complaints Agents |
| Sales | Sales Manager | Sales Agents |

Each agent's `Reports To` field in their profile determines which manager's hierarchy they appear in.

### Rules & limits
- An agent with no manager set only sees their own tickets.
- Reassigning a ticket to an agent in another department does not change who can view it — visibility follows the assignee's hierarchy.
- Tenant Admin is excluded from operational visibility and sees no tickets.

---

## Cross-Department Originator View

**Module:** Ticketing
**Who it affects:** Agents who create tickets that are routed to another department (e.g. a Support Agent who raises a Sales or Complaints ticket on a customer's behalf)

### What it does
When a support agent creates a ticket and it is routed to and **accepted** by a different department (Sales or Complaints), the originating agent keeps **read-only visibility** of that ticket. They can see the status and resolution, but cannot edit or act on it.

This is the industry standard used by Zendesk, Freshdesk, and Salesforce Service Cloud.

### How it works in practice

1. Customer calls in → Support Agent handles the call.
2. Support Agent identifies a sales opportunity and creates a Sales ticket on the customer's behalf.
3. The ticket routes to the Sales queue → Sales Agent accepts it (SLA clock starts).
4. **From this point:** Support Agent sees the ticket in their list with a **"👁 View only"** amber badge.
5. Support Agent can see the ticket status, notes, and whether it was resolved or converted to a deal — but cannot change anything.
6. The Sales Agent owns the ticket fully and works it to resolution.

### What "View only" means
- Can: read all ticket details, comments, and status updates
- Cannot: change status, priority, assignee, add comments, close, or escalate
- Any attempt to edit returns an error: "This ticket has been accepted by another department. You have read-only access as the originator."

### When originator view is NOT triggered
- Ticket has not yet been accepted by the other department (still in queue) — the originator can still edit it
- Ticket is assigned to someone in the same department — no restriction, normal edit access applies
- The ticket creator is a Manager or Admin — no restriction

---

# Reports Hub — Downloadable CSV Reports

---

## Reports Hub — Downloadable CSV Reports

**Module:** Reports
**Who it affects:** Managers (6 reports) · Agents (4 reports)

### What it does
The Reports page gives every user a set of downloadable CSV reports relevant to their role. Reports are generated from live data and can be exported at any time. Available from the sidebar under **Reports**.

### How to download a report
1. Click **Reports** in the sidebar.
2. Select the date range (7, 14, or 30 days for most reports).
3. Click **Download CSV**.
4. The file opens in Excel or any spreadsheet tool.

---

## Manager Reports

| Report | What it shows |
|---|---|
| **Ticket Volume** | Daily breakdown of tickets created, resolved, SLA breached, by priority and channel |
| **SLA Performance** | Weekly SLA compliance %, average resolution time, average first response time, escalation rate |
| **Agent Performance** | Per-agent breakdown: tickets assigned, accepted, resolved, SLA compliance, calls today |
| **CSAT** | Individual survey responses with rating, comment, ticket reference, and assigned agent |
| **Issue Categories** | Most common ticket tags/categories — total volume, resolution rate, average resolution time, breach rate |
| **Ticket Backlog** | Full list of all open/pending tickets with age, SLA status, priority, and assignee |

All manager reports are scoped to the manager's department hierarchy (the same visibility rules as the ticket list).

---

## Agent Reports

| Report | What it shows |
|---|---|
| **My Tickets** | All tickets assigned to me — status, priority, channel, SLA due, resolved date |
| **My Activities** | All my logged activities — calls, emails, meetings, tasks — with completion status |
| **My SLA** | My personal SLA performance — compliance %, average resolution and first response times |
| **My Call Log** | All inbound/outbound calls — duration, status, direction, sentiment, bot-handled flag |

All agent reports are scoped to the logged-in agent's own data only.

### Rules & limits
- Reports respect the same visibility rules as the ticket list — agents cannot download data outside their scope.
- CSAT report will be empty until customers respond to surveys.
- Call Log requires Voice module to be licensed.

---

# Ops Dashboard — Live KPI Strip

---

## Ops Dashboard — Live KPI Strip

**Module:** Analytics (Managers only)
**Who it affects:** Managers

### What it does
The Manager Ops Dashboard includes a 4-card KPI strip at the top showing real-time team performance — benchmarked against top CRM standards (Zendesk, Freshdesk).

| KPI | What it measures | Why it matters |
|---|---|---|
| **CSAT Score** | Average customer satisfaction rating (1–5 scale) from survey responses | Industry benchmark: 4.0+ is good; below 3.5 needs attention |
| **SLA Compliance %** | Percentage of tickets resolved within their SLA deadline | Industry benchmark: 90%+ target; below 80% is a risk |
| **Avg Resolution Time** | Average hours from ticket creation to resolution | Shorter = better; varies by department and ticket type |
| **Avg First Response** | Average minutes from ticket creation to first agent reply | Industry benchmark: under 1 hour for standard; under 15 min for urgent |

### Colour coding
- **Green** — above target
- **Amber** — approaching threshold
- **Red** — below benchmark (action needed)

### How to use it
1. Log in as a Manager.
2. Go to **Analytics → Ops Dashboard** in the sidebar.
3. KPIs update in real time as tickets are resolved and surveys are completed.
4. Click **Full report →** next to SLA Compliance to open the detailed Ticket Reports page.

---

# Customer Callback — Search, 360 View & Notes

---

## Searching for a Ticket When a Customer Calls Back

**Module:** Ticketing
**Who it affects:** All agents and managers

### What it does
When a customer calls in about an existing ticket, any agent can search for that ticket using whatever information the customer provides — not just the ticket number.

### What you can search by
| Search term | Example |
|---|---|
| Ticket number | TKT-00123 |
| Customer name | Ahmed Khan |
| Mobile number | 07700900123 |
| NIC / CNIC number | 3520112345678 |
| Email address | ahmed@email.com |
| Ticket subject | mortgage complaint |

Type any of the above into the search bar on the Tickets page. The system finds matching tickets instantly.

---

## Opening the Customer's Full History (Customer 360)

**Module:** Ticketing / CRM
**Who it affects:** All agents

### What it does
When you open any ticket, the customer's name at the top is a clickable link. Click it to open their full Contact record — every ticket, call, activity, and note across all departments in one view.

### How to use it
1. Open any ticket from the list.
2. In the Reporter section, click the customer's name (shown in blue).
3. Their full contact record opens — all tickets (open and closed), all calls, all activities.
4. You can see what other departments are handling for this customer without leaving the platform.

---

## Adding a Note to a Ticket You Don't Own (Customer Callback Context)

**Module:** Ticketing
**Who it affects:** Any agent who receives a customer call about a ticket owned by another department

### What it does
When a customer calls back about a ticket handled by Sales or Complaints, the answering agent can add an internal note to that ticket — even though they don't own it. This note is visible to the team handling the ticket and gives them important context about the customer's latest contact.

### How to use it
1. Search for the ticket using the customer's mobile, NIC, or name.
2. Open the ticket. If it belongs to another department, you'll see an amber **"View only"** banner.
3. Click **"+ Add Note"** in the banner.
4. Type what the customer told you (e.g. "Customer called to check status. Wants callback before 3pm Friday.").
5. Click **Save Note**.
6. The note appears in the ticket conversation — the owning agent sees it next time they open the ticket.

### Rules
- Notes added this way are always internal — the customer never sees them.
- Adding a note does not change the ticket status, assignee, or SLA.
- You still cannot close, reassign, or edit the ticket — that remains with the owning department.

---

## Contact 360 — Viewing All Tickets Across Departments

**Module:** Contacts / Customer 360
**Who it affects:** All agents and managers

### What it does
When you open a customer's contact record and click the **Tickets** tab, you now see every ticket that customer has ever raised — across Support, Complaints, and Sales — all in one place.

Previously, an agent could only see tickets from their own department. Now the full picture is visible to everyone.

### What each ticket shows
- Ticket number and subject
- Department badge (purple label: Support / Complaints / Sales)
- Priority (colour-coded)
- Current status

### Why this matters
When a customer calls in, the answering agent can open the contact record and immediately see:
- "This customer has an open Complaints ticket handled by the Complaints team"
- "They also have a resolved Sales ticket from last month"

This means better, faster service — no asking the customer to repeat themselves.

---

## Line Managers — 3-Level Team Hierarchy

### What it does
Each operational department (Support, Sales, Complaints) now has a full 3-level reporting structure:
- **Department Manager** (e.g. Support Manager) — sees the full department's data
- **Line Manager** (e.g. Support Line Manager) — sees their own data and all their direct agents' data
- **Agent** — sees only their own data

Line managers are assigned per-department. A Support Line Manager only manages Support Agents; a Sales Line Manager only manages Sales Agents.

### How to invite a user and assign their line manager

1. Go to **Admin Panel → Users → Invite User**
2. Fill in the new user's name and email
3. Select their **Department** from the dropdown (e.g. Support)
4. Select the **Role** (Agent or Manager) — the manager dropdown updates automatically based on this choice
5. The manager dropdown shows your organisation's own label for that tier (e.g. "Territory Manager" or "Floor Manager") and lists only people from the same department at the right seniority level:
   - Creating an **Agent** → shows Line Managers only
   - Creating a **Manager** → shows Department Managers only
6. Select the appropriate manager and click **Send Invite**

> Selecting a different department or role automatically clears the manager selection, so you can never accidentally assign a manager from the wrong department or wrong tier.

### Rules & limits
- The manager dropdown label uses your organisation's custom role name if one is set (e.g. "Territory Manager" instead of "Line Manager")
- The manager dropdown only shows users with the Manager role in the same department at the correct tier
- If no managers exist yet for a department, a warning message is shown and the dropdown stays empty
- Line managers see their reportees' dashboards, tickets, and reports automatically — no extra configuration needed
- The 3-level hierarchy is recursive — a manager's manager also sees downward through the tree


---

## Platform Branding — AmanahCX

The platform is branded as **AmanahCX** across all customer-facing screens:
- Login page (desktop wordmark, mobile header, footer copyright)
- Main application sidebar
- Invite emails sent to new team members
- Onboarding emails sent when a new workspace is provisioned

---

# Ticket-Contact Linking — Every Ticket Needs a Customer

**Who uses this:** All agents and managers who create tickets.

**What it does:** Every ticket must be linked to a contact record in the CRM. This lets any agent who receives a callback from that customer instantly see the full history — all previous tickets, calls, and deals — without asking the customer to repeat themselves.

## How to create a ticket

1. Click **New Ticket** from the Tickets page.
2. The first field is **Customer Search**. Type the customer's name, email, phone number, mobile number, or NIC number.
3. A dropdown shows matching contacts. Click the correct customer.
4. The Reporter Name, Email, and Phone fields fill in automatically (read-only — they come from the CRM record).
5. Fill in the remaining details: Channel, Issue/Subject, Priority, and Queue.
6. Click **Create Ticket**.

> You cannot submit the form without selecting a customer. This is intentional — a ticket without a linked contact cannot be found during a callback.

## Finding a customer by callback number

When a customer calls back and you only have their number:
1. Start creating a new ticket.
2. In the Customer Search field, type the phone or mobile number.
3. The system searches across all contact fields — name, email, phone, mobile, and NIC.
4. Select the customer and the ticket is pre-linked to their record.

Alternatively, search for the customer from the Contacts page to review their full history before creating the ticket.

## What agents see on a contact's record

Open any contact → **Tickets tab** — shows every ticket linked to that customer across all departments (Support, Sales, Complaints), with the department shown as a colour badge. This view is available regardless of which department the agent belongs to.

**Click any ticket to open it.** Each row is clickable — it takes you straight to the ticket's detail panel where you can read the conversation, add a note, or accept the ticket. No need to search manually in the Tickets page.

**NIC on the profile panel.** The customer's National Identity Card number (if on file) appears in the left panel under their phone numbers. Agents can verify it during a call with a quick glance.

No configuration is needed — this is the default platform name for all tenants.

---

## Setting your agent status

Your status tells the system (and your supervisor) whether you are available to take tickets.

1. Look at the bottom of the left sidebar — there is a coloured dot next to your name.
2. Click it to open the status picker.
3. Choose your status:
   - **Online** — you are available and will receive auto-assigned tickets.
   - **Busy** — you are on a call or focused. No new auto-assignments.
   - **Away** — short break. No new auto-assignments.
   - **Offline** — end of shift. No new auto-assignments.
4. Your status updates immediately. The system will not push new tickets to Offline or Away agents.

> Supervisors and managers can see your status on the Live Wallboard in real time.

---

## Live Wallboard (managers only)

The Live Wallboard gives managers a real-time view of all agents and queue depth.

**How to open it:** Sidebar → Analytics → Live Wallboard.

**What you see:**
- Summary strip: how many agents are Online, Busy, Away, or Offline right now.
- Agent grid: each agent's status dot, active ticket count, and number of SLA breaches.
- SLA alert banner: appears at the top if any agent has breached tickets — shows count and number of agents affected.
- Queue depth panel: open, assigned, pending, and breached ticket counts for each department queue.

The page refreshes automatically every 30 seconds. Use the **Refresh** button for an immediate update.

---

## Raising a ticket from a customer record

You no longer need to go to the Tickets page to raise a new ticket for a customer.

1. Open the customer's contact page (search in Contacts or click their name anywhere in the system).
2. Click the **Tickets** tab.
3. Click **New Ticket** in the top-right of the tab.
4. Fill in the subject, priority, and department (department is optional).
5. Click **Create Ticket**.

The ticket is automatically linked to this customer. It will appear in their Tickets tab instantly.

---

## Viewing a customer's full history (unified timeline)

The **Timeline** tab on a contact page now shows everything in one place:
- Activities logged (calls, meetings, emails, notes, tasks)
- Voice calls received
- Support tickets opened
- Deals created

All sorted newest first. No need to jump between tabs to understand what happened with a customer.

---

## Customer satisfaction rating on a contact

If a customer has submitted CSAT ratings on any resolved tickets, a star rating appears in their profile panel (left sidebar on their contact page).

- The average rating out of 5 is shown with filled stars.
- The number of ratings is shown in brackets.
- If no ratings exist yet, nothing is shown.

This gives agents immediate context about the customer's satisfaction history before taking a call.

---

## Opening a deal from a customer record

1. Open the customer's contact page.
2. Click the **Deals** tab.
3. Click any deal row — it takes you straight to the deal's detail panel on the Deals board.

An arrow icon on the right of each row confirms it is clickable.

---

## Business hour profiles (managers only)

Business hour profiles define when each department is open for work. SLA timers can be set to only count time during business hours.

**How to set up a profile:**
1. Go to **SLA Policies** (sidebar → SLA Policies).
2. Click the **Business Hours** tab.
3. Click **New Profile**.
4. Give it a name (e.g., "Support 9–6 Mon–Fri").
5. Enter which departments it applies to (leave blank to apply to all departments).
6. Set the timezone.
7. For each day of the week, check the box if the department is open and set the open and close times.
8. Optionally mark it as the default profile.
9. Click **Save Profile**.

The profile is saved and visible to all managers. To edit or delete, use the pencil and bin icons on the profile card.

---

## How to create a ticket (updated — contact is required)

Every ticket must be linked to a customer contact before it can be saved.

1. Go to **Tickets** and click **New Ticket**.
2. The first field is **Customer Search**. Type the customer's name, phone, mobile, email, or NIC number.
3. A dropdown shows matching contacts. Click the right one.
4. Reporter Name, Email, and Phone fill in automatically and cannot be edited — they come from the CRM record.
5. Fill in Channel, Subject, Priority, and Queue.
6. Click **Create Ticket**.

The ticket is linked to the contact from the moment it is created. It will immediately appear in that contact's Tickets tab.

---

## Inviting a new team member — manager assignment

When you invite someone to the platform, the system now filters the Line Manager dropdown to only show managers in the same department.

1. Go to **Settings → Team** and click **Invite Member**.
2. Select the department first.
3. The Line Manager dropdown updates to show only managers in that department.
4. If no managers exist for that department yet, a warning will tell you — assign a manager to that department before inviting agents into it.
5. Fill in name, email, and role, then send the invite.

---

## Changing a ticket's priority (SLA governance)

Changing the priority of a ticket re-routes the SLA clock. The system requires a written reason before the change can be saved.

1. Open the ticket and click **Edit ticket fields**.
2. Change the **Priority** selector.
3. A new text box appears: **"Reason for priority change (required — SLA governance)"**.
4. Type the reason (e.g. "Customer escalated, business-critical outage").
5. The **Save** button becomes active once the reason is filled in.
6. The change is logged in the ticket's audit trail as a separate `priority_changed` entry, visible to managers and tenant admins.

**Note:** If you change priority back to the original value, the reason box disappears and Save is available without a reason.

---

## Reassigning a ticket to another agent

Managers can reroute a ticket to a different agent at any time (emergency reroute, skills mismatch, etc.).

1. Open the ticket and click **Edit ticket fields**.
2. Change the **Assignee** selector to the new agent.
3. An optional text box appears: **"Reason for reassignment (optional — helps post-incident review)"**.
4. Adding a reason is encouraged but not required — Save is available with or without it.
5. The change is logged as `assignee_changed` in the audit trail, including the reason if one was provided.

---

## Escalating a Ticket to a Manager (Agent)

If a ticket requires manager attention (complex issue, angry customer, policy exception), agents can escalate it directly from the ticket panel.

1. Open the ticket.
2. Click **Escalate to Manager**.
3. Type the reason for escalation (required) and confirm.
4. The ticket shows an orange "Escalated" badge visible to managers.
5. The manager sees the badge, the reason, and the timestamp in the ticket panel.
6. Once handled, the manager clicks **Acknowledge Escalation** to clear the flag.

---

## Acknowledging an Escalation (Manager)

1. Find the ticket with the orange **Escalated** badge.
2. Open it — the escalation reason and time appear in an orange banner near the top.
3. Review the reason and take the necessary action.
4. Click **Acknowledge Escalation** to mark it as handled.
5. The badge and banner are removed; the action is logged in the audit trail.

---

## Sector-Specific Fields in Tickets

When your organisation's sector is configured (e.g., Banking, Insurance, E-commerce), the New Ticket form automatically shows relevant fields for your industry. For banking these include: Case Type, Transaction Reference, Amount Involved, Regulatory Deadline, and Central Bank Reference Number.

These fields are filled in when creating a ticket and are visible to anyone viewing the ticket detail.

No setup is needed by agents — fields are provisioned automatically when the workspace is created.

---

## Role Permissions Quick Reference

A full HTML reference document covering all six roles (tenant admin, voice bot, manager, line manager, agent, viewer) and the complete voice-bot-to-resolution information flow is available at:

- Project root: `AmanahCX-Roles-and-Flow.html`
- Desktop copy: `AmanahCX-Roles-and-Flow.html`

Open in any browser — no login required.

---

## Quotations

**Who uses it:** Sales admin / operations admin (super_admin access required for Sales module).

Quotations are estimates you send to a customer before raising an invoice. They do not count toward your revenue figures until you convert them.

**Creating a quotation:**
1. Go to **Sales → Quotations** and click **+ New Quotation**.
2. Select the client, currency, and template.
3. Set the Issue Date and choose how long the quotation is valid (7, 14, 30, 60, or 90 days). The Valid Until date calculates automatically.
4. Add line items (description, quantity, price, tax %).
5. Click **Save as Draft** to store it privately, or **Save & Mark Sent** to mark it as dispatched to the client.

**Converting to an invoice:**
- When the client accepts, click **Convert to Invoice** on the quotation row.
- The system creates an invoice with identical line items and marks the quotation as Accepted.
- You are taken straight to the new invoice.

**Open Quotations KPI card:** The Sales Dashboard shows the total value of all open (draft + sent) quotations in the purple **Open Quotations** card. Click it to go to the quotations list.

---

## Aging of Receivables

**Who uses it:** Sales admin / finance.

The **Aging of Receivables** table sits at the bottom of the Sales Dashboard. It shows how much each customer owes, broken into 6 overdue time bands:

| Column | Means |
|---|---|
| < 30 Days | Invoice due within the last 30 days |
| 30–60 Days | 30–59 days past due |
| 61–90 Days | 60–89 days past due |
| 91–180 Days | 90–179 days past due |
| 181–365 Days | 180–364 days past due |
| > 365 Days | Over a year past due |

Rows are sorted by total outstanding (largest first). Paid and cancelled invoices are excluded. Use this table to prioritise collection calls.

---

## Invoice Templates

When previewing or printing an invoice, select a template from the Template drop-down in the invoice form. Three visually distinct layouts are available:

- **Classic / Agency** — Coloured logo box, coloured table header. Best for branded client-facing invoices.
- **Minimal** — Clean typographic layout, no coloured boxes, uppercase section labels. Best for simple or personal invoices.
- **Consulting** — Dark full-width header band with white text, striped table rows. Best for professional services.

---

## Fixed — Some Agents Could See "Access Denied" on Their Dashboard

**Status:** Resolved 2026-07-10

Some agent accounts could previously see an error when opening their Dashboard, even though everything else worked normally for them. This was happening specifically on workspaces that hadn't purchased the separate Analytics/Reports add-on — the Dashboard was mistakenly treating itself as part of that paid add-on, when it's actually meant to be available to everyone as their everyday home screen. This has been corrected — the Dashboard no longer depends on the Analytics add-on being purchased.

---

## Creating a Ticket Without an Existing Contact (Auto-Customer-Creation)

**Module:** Ticketing
**Who it affects:** All agents creating tickets, and the voice bot integration

### What it does
You no longer have to find an existing customer before you can create a ticket. If you type in a name, email, or phone number for someone who isn't already in the system, a new contact is created for them automatically — you don't need to stop and go create one separately first.

### How it works
1. Click **New Ticket**.
2. Try searching for the customer at the top as usual.
3. If they're not found, just fill in their name, email, and/or phone number in the fields below instead.
4. Click **Create Ticket**.
5. The system checks: does a contact with this email (or phone number, for calls) already exist?
   - **Yes** → the ticket is linked to that existing customer record — no duplicate is created.
   - **No** → a brand new customer record is created automatically and linked to the ticket.

### Why this matters
Previously, agents had to stop mid-task, go create a contact, then come back and create the ticket — two separate steps for something that should be one. This also applies to tickets created by the voice bot on a customer's behalf — same rule, matched by phone number instead of email.

### Rules & limits
- If a customer's email or phone changes later, the system won't automatically merge records — it matches by exact email or phone number.
- This does not remove the search option — searching and selecting an existing customer is still the fastest path if you already know they're in the system.

---

## Managers Can Now See Unclaimed Tickets Waiting to Be Picked Up

**Module:** Ticketing
**Who it affects:** Managers and Line Managers

### What it does
Previously, a manager's ticket list only showed tickets that had already been picked up (claimed) by one of their team. If a ticket was sitting unclaimed — nobody had grabbed it yet — the manager couldn't see it at all.

Now, managers can see that backlog too — any ticket waiting in their team's queue that nobody has claimed yet — so they can monitor workload and step in if something is sitting untouched for too long.

### Example scenario
> A ticket comes in overnight with no queue assignment. By morning, none of Amir's or Zoya's team has picked it up yet. Their manager, Mike, previously would have had no way of knowing this ticket even existed until someone claimed it. Now it shows up in Mike's ticket list immediately, so he can nudge his team or reassign it himself.

### Rules & limits
- Managers see unclaimed tickets only within their own team's scope — not the whole company's unclaimed backlog, just their team's queue (or tickets with no queue assigned).
- This does not change who can *claim* a ticket — that still follows the normal queue-membership rules for agents.

---

## Voice Bot Self-Service Configuration

**Who uses it:** Tenant admin (Settings → Voice Bot).

The self-service menu lets callers resolve common queries without speaking to an agent (e.g., "Check my balance", "Get account status").

**To configure:**
1. Go to **Settings → Voice Bot**.
2. Scroll to the **Self-Service Options** card.
3. Add up to 8 menu items. Each item has a label (what the caller hears) and an intent code (what the bot routes to).
4. Use the toggle to enable or disable each item without deleting it.
5. Click **Save** to apply changes immediately.

Disabled items are skipped by the voice bot but kept in the list so you can re-enable them later.


---

## Nadia — Self-Hosted Voice Agent (in setup, not yet live)

**Who uses it:** Tenant admin (Settings → Voice Bot → provider "livekit"). Callers experience it as a phone call, no login needed.

Most voice bots (Retell AI, Vapi) charge per minute at rates built for the US market — too expensive to run at Pakistani call volumes. Nadia is a voice bot your business runs itself instead: same idea (a caller talks, the bot understands, a support ticket gets created and routed to the right team) but without that per-minute bill.

### What it does
- Answers a call, has a natural back-and-forth conversation in Urdu/English/mixed ("Minglish"), and creates a real, trackable support ticket — the caller hears back the actual ticket number, not a made-up one.
- Speaks in proper Urdu script for clarity and a more natural voice, no matter which mix of languages the caller uses.
- Reads identifying numbers (CNIC, phone numbers, ticket numbers) one digit at a time in English, the way a Pakistani call-centre agent would — not as "forty-two thousand three hundred one".
- For a bank client (HBL Microfinance Bank), the conversation follows their own complaint-handling rules: what counts as urgent (fraud, account access issues) vs routine, what timeline to promise the caller, and how to handle a fraud report calmly and correctly.

### Configuring the bot (Voice Bot admin screen)
Go to **Settings → Voice Bot** and pick the **Self-Hosted Voice Bot** card. From there a tenant admin can change, with no technical help:
- **Bot Name** — what the bot calls itself in the greeting (default "Nadia"); takes effect on the very next call
- **Voice** — choose between the available Urdu voices (a warm female "helpdesk" voice or a polished male "support" voice); the platform owner can add more voices to this list over time
- **Tone** — empathetic / professional / friendly / formal
- **Speaking speed** — a slider from slower to faster
- **SIP Trunk Connection** ("Connect to your number via SIP trunking") — the telecom provider details (e.g. Telecard) that route real phone calls to the bot once your number is live: provider name, phone number, termination URI, SIP trunk username/password, a nickname, and outbound transport (TCP/UDP)
- **Test Call Nadia (Browser)** — a green "Call Nadia" button lets you talk to your configured bot right now, from the browser tab, using your microphone — no phone number or SIP trunk needed. Useful for checking the greeting, tone, and behaviour before going live with a real number.
- **Self-Service reasons (no ticket)** — pick from the built-in list, or add your own: type a name and a few keywords, and the bot will answer that type of question directly instead of creating a support ticket
- **Knowledge Base** — teach Nadia general answers (branch hours, standard policies, published timelines) so she can answer directly instead of raising a ticket. Add material three ways: type it in, upload a PDF/Word document, or paste a webpage link. Each entry has a few keywords — when a caller's question matches, Nadia answers from that entry.
- Plus the greeting text, behaviour instructions, and the usual ticket rules (queue, priority)

### Minutes usage
Since the bot is billed by the minute behind the scenes, the same Voice Bot page shows a
Minutes card: how many minutes your workspace has been allocated, how many have been used,
and how many remain — with a filter for today, last 7/30 days, this month, or all time. If
the remaining balance drops low, a warning appears. Running out of minutes will stop new
calls from reaching the bot (calls route to a human agent instead) — contact your platform
provider to top up before that happens. The platform operator manages allocations from their
own Super Admin console (per-workspace top-up with a note field, e.g. an invoice reference,
and a running history of every top-up).

### Current status
- Talking to the bot and creating real tickets both work and have been tested end-to-end: a real call creates a real ticket, which lands in a queue, and an agent can accept and work it — same as any other ticket.
- Tickets the bot creates now auto-assign to an available agent (same as tickets from any other channel), and route to the correct department queue (Support vs Sales vs Inquiry) instead of always landing in one default queue.
- Tickets the bot creates now show up on the normal Tickets page (agents don't need to check a separate screen).
- Ticket creation after a call now finishes in about 2 seconds (previously up to 10–15 seconds).
- Call recording (with a spoken consent notice) is now fully active, storing audio on a small self-hosted bucket on the relay server, with automatic cleanup so storage never fills up. Turn it on per-tenant in **Settings → Voice Bot → Self-Hosted Voice Bot → Record calls (audio)**.
- Call transcripts (previously blank due to a logging bug) now save correctly, labelled by speaker ("Caller:" / "Nadia:").
- The bot now captures a caller's full contact details as they come up naturally in conversation — email, CNIC/ID number, address, city — not just name and phone, so a caller's record on the Contacts page is complete. Calling back later fills in anything missing rather than creating a duplicate contact.
- A dedicated relay server has been set up to connect to Telecard's phone line with a fixed, whitelistable internet address; still waiting on Telecard to confirm that address before real phone calls can be tested (white-labelling confirmation pending on their side).
- Voice quality and response speed are still being tuned; a short "please wait" message during ticket creation, and independent controls for speaking speed vs. reply pause, are both planned next.

### Rules & limits
- Requires a working internet connection to LiveKit (the calling infrastructure) and Uplift AI (the voice); if either is down, calls won't be handled.
- Call recordings are stored on the same server used to connect to Telecard, not a separate dedicated storage service — an acceptable trade-off since that server's only job is call routing, but it means no independent backup of recordings.


---

## Communication Consent — WhatsApp, SMS & Email Opt-In

**Who uses it:** Managers, line managers, and agents (Contact page → Consent tab). Compliance teams for the audit history.

Before your business sends a customer a WhatsApp message, the customer must have said "yes, you may contact me there" — WhatsApp's owner (Meta) enforces this and can suspend a business's WhatsApp access for violations. The Consent tab is where that permission is recorded and proven.

### What it does
- Every contact now has a **Consent** tab on their profile with an on/off switch per channel: WhatsApp, SMS, and Email.
- Flipping a switch records a permission event — who recorded it, when, how the permission was obtained (an optional note), and whether it was an opt-in or opt-out.
- The record is permanent: opting out later doesn't erase the earlier opt-in — both stay in the history. Click **View consent history** to see every event ever recorded for that customer.

### It also works automatically
- When a customer picks WhatsApp or SMS as their preferred contact channel while raising a ticket (or tells the voice bot), the system files that choice as an opt-in on its own — no staff action needed.
- When an agent replies to a ticket, the system checks the customer's consent first. If the customer has opted out of WhatsApp, the reply automatically goes by email instead — the customer is never contacted on a channel they said no to.

### Example scenario
> A customer raises a ticket and chooses WhatsApp as their preferred channel. Permission is recorded automatically. Weeks later they message "please stop WhatsApp" — an agent flips the WhatsApp switch off with a note. From that moment, all ticket replies to them go by email. If Meta ever audits the workspace, the full permission history is on file.

### Rules & limits
- Consent is per customer per channel — saying yes to email doesn't mean yes to WhatsApp.
- One workspace's consent records are invisible to every other workspace on the platform.
- Future marketing/bulk WhatsApp campaigns will be held to a stricter rule: no recorded opt-in means no message at all.
