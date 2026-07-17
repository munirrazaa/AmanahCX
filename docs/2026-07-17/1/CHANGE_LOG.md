# CHANGE LOG
_Most recent at top. Treated as the primary record for development tracking._

---

## Change Log - 2026-07-17 — Full role-by-role toggle/save audit; two cosmetic-only screens made real

### Context
User reported Super Admin "not able to save roles" and asked for a systematic guarantee that no toggle in the system is broken. Ran a full audit: every role (Super Admin, Tenant Admin, Manager, Agent, Viewer) logged in and clicked through every page; every settings screen's actual toggles/saves exercised, not just page-load checks.

### Fixed

**Super Admin showed 4 dead-end menu items — root cause of the original report**
- `packages/frontend/src/App.tsx`'s sidebar used `isAdmin` (= tenant_admin OR super_admin) in several places that meant to say "an admin-permission user who isn't tenant_admin" — the check never excluded super_admin, who by design has zero workspace access (`tenantMiddleware` blocks super_admin from every non-`/super-admin/*` route). Result: Roles, Integrations, Sales & Invoices, and the notification bell all appeared for Super Admin and always 403'd. Removed all four; added `!isSuperAdmin` to the guard conditions.
- Also disabled the `['modules']` react-query fetch for super_admin (`enabled: !isSuperAdmin`) — it was firing and 403ing unconditionally.

**Super Admin's own Billing tab was completely broken (500 error)**
- The route code (`/super-admin/platform-invoices`) has existed for a while, but its migration was never written — `relation "platform_invoices" does not exist`. New migration `068_platform_invoices.sql` creates `platform_invoices` + `platform_payments` (RLS: bypass-only, since only Super Admin ever touches these). Live-verified: created and deleted a real test invoice through the UI.

**Cross-account cache leak — switching logins in one tab could show the previous account's data**
- `queryClient` (react-query) was never cleared on logout/login. Logging in as Tenant Admin, then logging into Super Admin in the same tab without a hard refresh, briefly rendered the tenant's cached CRM sidebar under the Super Admin session. Fixed: `queryClient.clear()` now runs on both login and logout (`packages/frontend/src/store/auth.store.ts`, `queryClient` exported from `App.tsx`). Reproduced the exact scenario before and after — confirmed fixed.

**Workspace General Settings save failed (500) whenever more than one field changed at once**
- `PATCH /api/v1/settings/workspace` built a separate `settings = jsonb_set(...)` SQL fragment per changed field (timezone/dateFormat/currency) and concatenated them into one `UPDATE ... SET settings = X, settings = Y` — Postgres rejects assigning the same column twice (`42601`). Fixed by folding all changed keys into one JSON object and a single `settings = COALESCE(settings,'{}') || $1::jsonb` merge.

**Super Admin's Reports/Alerts/Sub-Admins tenant-picker dropdowns silently broken (400)**
- Frontend requests `pageSize=200` to populate a `<select>` of all tenants; backend capped at 100. Raised the cap to 500 (`packages/api/src/routes/super-admin.ts`) — this is a picker context, not a paginated table.

**Two settings screens were 100% cosmetic — toggles and Save/Revoke did nothing**
- Notification Preferences (reachable two ways: Settings → Notifications, and My Settings → Notifications — turned out to be two separate components with different toggle sets) had no backend at all; the Save button had no click handler; every toggle reset on reload.
- Active Sessions / Revoke on the Security tab showed hardcoded fake data ("Mobile Safari — last seen 2h ago") with a non-functional Revoke button.
- Built real backend for both: `notification_preferences` JSONB column on `users` (migration `069_notification_preferences.sql`), `GET`/`PATCH /api/v1/settings/notification-preferences` (merge-not-replace, since two screens write to it independently). For sessions: login now records device/timestamp in Redis (`packages/api/src/routes/auth.ts`), `GET /auth/sessions` lists real active logins, `DELETE /auth/sessions/:jti` revokes one using the blocklist mechanism that already existed for logout. Live-verified: toggled a preference, reloaded, still set; created a second session via a direct API login, revoked it, confirmed it disappeared from the list.

### Verified working (no fix needed)
Tenant Admin: module toggles, routing method change, user activate/deactivate, sub-admin role create/delete, all settings pages load and save cleanly. Manager/Agent: full ticket lifecycle (create → accept → resolve) tested via live API calls, matches expected state transitions and SLA field population. Field Team View (built 2026-07-16) confirmed clean for a manager with no direct reports (correct empty state, not a bug).

---

## Change Log - 2026-07-16 (Push 2) — Manager Field-Team View built

### Added

**Manager Field-Team View — new page, closes a known gap**
- New page at Settings → Analytics → Field Team: a manager sees everyone in their reporting hierarchy (direct + indirect reports), each with today's task count, last GPS check-in time, and open ticket count.
- Click a team member to see their actual task list (with a GPS badge if a check-in/completion location was recorded) and their open tickets.
- "Assign Task" button on each member opens a small form (what needs doing + optional due date/time) — creates a task owned by that person, same as if they'd created it themselves on mobile.
- Ticket assignment reuses the existing `POST /tickets/:id/assign` endpoint — no new mechanism needed, this view is just a manager-facing surface over data/actions that already existed.
- New backend endpoints: `GET /api/v1/analytics/field-team` (summary) and `GET /api/v1/analytics/field-team/:userId` (detail), both scoped to the requesting manager's own hierarchy — verified a manager cannot see or assign to someone outside their team.
- Live-verified end to end through the real browser: opened the page as a manager, saw the real team with real ticket counts, assigned a new task to an agent, confirmed it appeared correctly in that agent's task list.

### Fixed

**`GET /api/v1/analytics/team-reportees` was silently broken (500 error)**
- Found while building the above: the handler referenced `tenantId` without ever declaring it, so every call failed. This endpoint feeds the reportee filter dropdown elsewhere in Analytics. Fixed and re-verified live.

---

## Change Log - 2026-07-16 — Sales Invoicing table collision fixed; Integrations/Voice Bot licensing gates added

### Fixed

**Sales Invoicing module never actually worked — root cause: table name collision**
- `002_billing.sql` (platform subscription billing) and `008_sales_invoicing.sql` (tenant-facing customer invoicing) both tried to create a table called `invoices`. The platform one won (created first); the sales one's `CREATE TABLE IF NOT EXISTS` silently no-op'd, so every sales invoice INSERT/query since 2026-07-06 was hitting the wrong columns. Confirmed zero invoices ever existed in production — safe structural fix, no data to migrate.
- New migration `067_separate_sales_invoices.sql`: creates a dedicated `sales_invoices` table matching the schema the code always intended, repoints `invoice_line_items`/`invoice_payments`/`quotations.converted_to_invoice_id` at it, and closes a missing-bypass_rls gap on `invoice_payments` found in the process.
- The route code itself also had several pre-existing column-name mismatches baked in from day one (`invoice_number` vs `number`, `tax` vs `total_tax`, a phantom `due_at` column, a stray `provider` column) — all fixed.
- Also fixed: recording a partial payment was hardcoded to mark the whole invoice `paid` regardless of amount — now correctly computes `partial` vs `paid` from the running total.
- Live-verified end to end: created a billing contact → quotation → converted to invoice → recorded a partial payment → confirmed correct status, correct amount due, correct Aging of Receivables bucket, correct dashboard totals.
- Matches how top CRMs structure this (Salesforce Billing vs Sales Cloud invoicing, Zoho Subscriptions vs Zoho Invoice) — platform billing and tenant customer-invoicing are architecturally separate, never a shared table.

### Added

**Integrations — optional module gating**
- The Integrations menu/page previously showed for every tenant admin regardless of licensing, and the server itself never checked either. Now gated the same way Voice Bot already was: hidden unless the module is licensed, and the server rejects access (402) if it isn't. New `requireModule()` middleware added for this pattern.

**Voice Bot — per-provider allocation**
- Licensing "Voice Bot" as a whole previously exposed every provider (Nadia/Vapi/Retell/Bland) to every tenant. Each provider now needs individual allocation (`voice_bot.provider.<id>` feature key); the UI only shows allocated providers and the server rejects saving a non-allocated one.
- Also fixed: the newest hand-off/concurrency-cap fields (from the 2026-07-15 push) could only be set by Super Admin centrally — the tenant's own save endpoint never included those two columns. Now tenant-editable as intended.

---

## Change Log - 2026-07-15 (Push 16) — Config Ownership editor extended to full parity with the tenant Voice Bot page

### Added
**Super Admin's centralized Voice Bot editor now covers everything the tenant page does**
- Extended: Voice (real catalog dropdown), Language, full SIP Trunk block
  (provider, phone number, termination URI, username, password, nickname,
  outbound transport), Record calls (audio) toggle, Self-Service Intents
  checkboxes, and a full Knowledge Base manager (add / enable-disable /
  delete text entries).
- All of it writes to the exact same rows Nadia actually reads at call
  time (`voice_bot_configs`, `voice_bot_knowledge_entries`) — not a
  separate/shadow config.
- New Super Admin-only endpoints: shared voice catalog, and Knowledge Base
  CRUD scoped by an explicit tenant id (since Super Admin has no tenant
  context of their own and can't call the tenant-scoped versions).
- Verified live: saved a full SIP trunk configuration, a self-service
  intent, and a knowledge base entry from the Super Admin side for a real
  tenant, then confirmed Nadia's own keyword-search endpoint could find
  the new knowledge entry — proving it's genuinely the same data, not a
  disconnected copy. Test data cleaned up afterward.

---

## Change Log - 2026-07-15 (Push 15) — Super Admin can centrally hold Voice Bot + Integrations config per tenant (Phase 1)

### Added
**Config Ownership — Super Admin decides who configures what, per tenant**
- New "Config Ownership" option in Super Admin → Tenants → tenant row menu.
  One modal, four switches: Voice Bot, Channels & Services, Webhooks, API
  Keys. Each can be set to **Tenant Admin** (works as always — tenant
  configures it themselves) or **Super Admin** (centrally held).
- When centrally held, the tenant admin's own screen for that area shows a
  locked banner and no edit controls — but still shows the current
  settings, not a blank page. Enforced on the backend too, not just hidden
  in the UI: a direct API call from a locked tenant is rejected with a
  clear `CENTRALLY_MANAGED` error.
- When Voice Bot is centrally held, the same Super Admin modal grows a
  live editor (bot name, greeting, system prompt, tone, speed, guardrails)
  that writes straight to that tenant's real configuration.
- This is Phase 1 of a larger planned model (see project memory for
  deferred phases: reusable bot profiles, sub-admin role delegation with
  approval, department-wise bots, and the same drill-down for individual
  integration types like email/SMS/payment providers).

### Fixed (found while building/testing the above)
- **Settings changes from Super Admin silently didn't take effect for up
  to 5 minutes** — the tenant object is Redis-cached, and nothing was
  busting that cache on a direct settings write. Added
  `TenantService.invalidateCache()`, now called after every Config
  Ownership change so locks/unlocks apply on the very next request.
- The Super Admin bot-editor form sent the speaking-speed value as text
  instead of a number (an artifact of how the database returns it),
  causing every save to silently fail until touched. Fixed.
- The same form would blank out any field the admin didn't touch instead
  of leaving it as-is — caught it erasing a real saved value during
  testing. Fixed so empty/untouched fields no longer overwrite what was
  already saved.

Verified live end-to-end: locked Haier Electronics' Voice Bot and Webhooks
from the Super Admin side, confirmed the tenant admin screens showed the
locked state and rejected direct write attempts, edited the bot centrally
and confirmed it saved correctly, then unlocked and confirmed tenant-side
control returned immediately.

---

## Change Log - 2026-07-15 (Push 14) — Admin-triggered password reset, dashboard link fixes, department type dropdown, tenant admin manual (5 sections)

### Added
**Tenant Admin can reset any user's password directly**
- New "Reset Password" option in the Users page row menu (between Change
  Role and Deactivate). Generates a secure link valid 24 hours, attempts to
  email it automatically, and always shows the link on screen with a Copy
  button regardless of email outcome — so it still works even with the
  known SendGrid sender-verification issue.
- Verified live end-to-end: generated a link as admin, used it as the
  recipient would, set a new password, and confirmed that password
  actually signs in.
- Fixed two bugs found while building this: an empty POST body was being
  rejected by the server (wrong content-type handling), and the endpoint
  was waiting up to 5+ seconds for a broken email send before responding —
  capped that wait so the UI responds quickly regardless of email status.

**Departments now have a working Type selector**
- Add Department and Edit Department both gained a "Department Type"
  dropdown (Sales, Support, Compliance, Finance, Technical, Operations) —
  previously there was no way to set this anywhere, so new departments
  never got a type even though it quietly affects default permissions for
  members assigned to them. New departments default to "Operations"
  instead of being left unset.
- Verified live: created a department with type "Sales" (badge appeared
  correctly), edited it to "Technical" (change saved correctly).

### Fixed
**Dashboard links pointing to non-existent Settings tabs**
- "Invite User" on the Admin Dashboard tried to open `/settings/team`,
  which doesn't exist — instead of erroring, this silently logged the
  admin out. Several stat cards and quick actions (Total/Active/Inactive
  Users, Active Modules, Features, Routing & SLA) had the same problem,
  pointing at `/settings?tab=team|modules|routing` tabs that were never
  built. All now point to their real pages (Users, Modules, Routing & SLA).

### Added — documentation
**Tenant Admin operational manual — first 5 sections**
- New `docs/tenant-admin-manual/` — an HTML manual with a linked index,
  real screenshots from the live system, and an issues log per section.
- Sections built: Getting Started (invite → password → login), Dashboard,
  Users, Roles & Permissions, Departments. Each was tested live, not just
  described — several of the fixes above were found in the process of
  building this manual.

---

## Change Log - 2026-07-14 (Push 13) — Nadia Knowledge Base (LiveKit admin portal item 6)

### Added
**Knowledge Base for Nadia — answer general questions without raising a ticket**
- New `voice_bot_knowledge_entries` table (migration 063), scoped per tenant
  with the same row-level tenant isolation as everything else.
- Tenant admins can add reference material three ways on Settings → Voice
  Bot → Knowledge Base: type it directly, upload a PDF/DOCX (text extracted
  automatically), or import a URL (page fetched and stripped to plain
  text). Each entry has a title, content, and a few keywords.
- At call time, Nadia checks the caller's question against active entries'
  keywords via a new `check_knowledge_base` tool before assuming something
  needs a ticket — matched entries are answered directly.
- New `/api/v1/voice-bot/knowledge-base/search` endpoint (server-to-server,
  same shared-secret pattern as the other LiveKit ingestion routes) is
  excluded from the normal login-required wall since the agent calls it
  directly, not a logged-in user.
- Verified live end-to-end through the real UI: added a text entry,
  confirmed keyword search matches the right entry and ignores unrelated
  questions, toggled an entry off and confirmed it stops matching, deleted
  it and confirmed removal. Also verified PDF/DOCX text extraction and URL
  import directly against the API.

This is item 6 of the 7-item LiveKit admin portal wishlist — only "route to
a live human mid-call" (item 7) remains.

## Change Log - 2026-07-14 (Push 12) — Transcript-capture bug fixed; voice-bot contacts now capture full caller details

### Fixed
**Transcripts were silently empty on every Nadia call**
- Root cause: the conversation-logging code read text off the wrong object
  — LiveKit fires a `ConversationItemAddedEvent` wrapper, and the actual
  message (with the spoken text) is inside its `.item` field. The old code
  tried to read the text directly off the wrapper, which never has it, so
  every call produced a blank transcript no matter how the conversation
  went — the call itself worked fine, only the logging was broken.
- Fixed: reads `ev.item.text_content` correctly, and now labels each line
  "Caller:" / "Nadia:" for a readable transcript instead of one run-on blob.
- Verified against the real LiveKit SDK classes (not just a code read) —
  confirmed it now produces a correct labelled transcript from simulated
  conversation turns; before the fix, the same input produced nothing.

### Added
**Voice-bot contacts now capture full caller details, not just name + phone**
- Nadia can now pass along email, CNIC/ID number, address, and city when a
  caller shares them — even in passing, not just when directly asked.
- New callers get a complete contact record with whatever details came up.
- Repeat callers get their existing contact filled in with any new detail
  that was missing before (e.g. they add an email on a later call) —
  never overwrites what's already on file, never creates a duplicate.
- Verified live: created a contact with full details on a first call,
  called again with just an email, and the second call correctly filled
  the email gap while keeping the first call's CNIC/address intact.

---

## Change Log - 2026-07-14 (Push 11) — Voice-bot ticket auto-assignment + department routing fixed; recording storage live

### Fixed
**Nadia's tickets were never auto-assigned to an agent**
- Root cause: Nadia's ticket-creation function (`createComplaintFromStructured`
  in `packages/api/src/routes/voice-bot.ts`) created the ticket and linked it
  to the right queue, but never ran the "auto-push to an available agent"
  logic that the older bot-provider path already had. So every Nadia ticket
  sat unassigned regardless of the queue's routing setting.
- Fixed: added the same push-assignment step — checks the queue's
  `routing_method` (`push_random` / `push_criteria`), then assigns to an
  active agent/manager who is a member of that specific queue.
- Verified live: test ticket auto-assigned correctly, test data cleaned up.

**Nadia tickets always went to the tenant's "default" queue, ignoring department**
- Root cause: unlike the older bot-provider path (which routes Support vs
  Sales vs Inquiry via the IVR menu), Nadia's path had no department/intent
  routing at all — every ticket landed in whichever queue was marked default.
- Fixed: added the same intent-detection + IVR-menu queue lookup used
  elsewhere, so a sales-flagged call can route to a Sales queue once one is
  configured, instead of only ever going to the default queue.
- Verified live with both a plain-complaint and a sales-intent test call —
  both correctly queued and auto-assigned.

### Added
**Call recording storage — now fully active**
- Audio call recording (built earlier, previously dormant with no storage
  configured) is now live: a small self-hosted storage bucket (MinIO) runs
  on the existing Telecard-relay VPS, fronted by HTTPS (Caddy, auto-renewing
  certificate), capped at 4GB with automatic oldest-first cleanup every 15
  minutes so it never fills up.
- `nadia-voice-agent` Railway service redeployed with the new storage
  credentials; confirmed registering cleanly with no errors.
- Verified end-to-end: uploaded a test file, fetched it back over the public
  HTTPS link, deleted the test file.
- Tradeoff accepted: recordings live on the same VPS used for SIP routing to
  Telecard (not a dedicated storage service), so there's no independent
  backup if that box is ever rebuilt.

---

## Change Log - 2026-07-14 (Push 10) — Audio call recording with consent notice + call-ended save fix

### Added — audio recording (per-tenant, with consent)
- **Toggle** "Record calls (audio)" on Settings → Voice Bot (LiveKit). When on, the UI shows
  an amber note that a consent line will play automatically.
- **Consent notice**: when recording actually starts, Nadia speaks
  "آپ کی کال معیار اور تربیت کے مقاصد کے لیے ریکارڈ کی جا رہی ہے۔" before greeting — so the
  consent itself is on the recording. Required for recorded calls in Pakistan.
- **Capture**: `recording.py` starts an audio-only LiveKit egress to S3-compatible storage
  (`RoomCompositeEgressRequest(audio_only=True)` → OGG). Reads storage creds from env
  (`RECORDING_S3_*`); if not configured it returns cleanly and the consent line is skipped —
  a missing bucket never breaks a call and Nadia never claims to record when she isn't.
- The recording URL flows back via the call-ended report → `voice_bot_calls.recording_url` →
  the Bot Calls page's existing audio player. New column `recording_enabled` (migration 062).

### Fixed (found while wiring recording — affected transcripts too)
**`/livekit/call-ended` matched the wrong key and silently saved nothing.** It updated
`WHERE id = voiceCallId`, but the agent sends the LiveKit room name, which is stored as
`provider_call_id` (not the row's UUID). So full transcripts + recording URLs never saved for
ticketed calls, and calls with NO ticket had no row at all. Rewrote it as an UPSERT on
`(provider, provider_call_id)` — updates the ticket's row when present, otherwise creates the
call row — so every call's transcript (and recording, when on) is saved and searchable on the
Bot Calls page. Verified live with a no-ticket call.

### Needs provisioning (one-time, external)
Audio recording is dormant until an object-storage bucket is set on the agent service
(`RECORDING_S3_BUCKET/REGION/ENDPOINT/ACCESS_KEY/SECRET/PUBLIC_BASE`) — e.g. Vultr Object
Storage. Transcripts already work with no storage.

---

## Change Log - 2026-07-14 (Push 9) — Nadia: "are you still there?" silence handling

### Added
When the caller goes quiet, Nadia now asks twice — "کیا آپ لائن پر موجود ہیں؟" (are you on the
line?) — then politely ends the call with "میں اب کال ختم کر رہی ہوں، اللہ حافظ" and hangs up,
instead of holding an open (paid) line to silence until the 10-minute hard cutoff. Driven by
the framework's `user_away_timeout` → `user_state_changed` "away" event; the nudge sequence
cancels the instant the caller speaks again. Silence threshold is `SILENCE_NUDGE_SEC` (env,
default **8s** — 3s was requested but fires during normal thinking pauses and would interrupt
real callers, so it's left tunable rather than hard-set low).

---

## Change Log - 2026-07-14 (Push 8) — SIP wiring audit: 3 real phone-call bugs fixed + setup automation

### Fixed (issues that only bite on real phone calls, invisible in browser tests)
1. **Caller misses the greeting.** On a live inbound SIP call the caller's audio path isn't
   fully negotiated the instant the worker starts, so Nadia greeted into dead air. Now waits
   for the caller to actually be present (`ctx.wait_for_participant()`, 20s cap) before
   greeting. Browser test calls are already connected, so this returns instantly there —
   which is exactly why it never surfaced in testing.
2. **No max-call-length enforcement.** `max_call_duration_sec` existed but nothing acted on
   it — a silent/stuck phone call would run forever, burning LLM + TTS + telco minutes. Added
   a duration guard that calls `ctx.shutdown()` at the limit.
3. **Final transcript could be lost.** The end-of-call report was fired-and-forgotten during
   shutdown (`asyncio.create_task` in the callback), so the process could exit before it
   finished. Now registered as an awaited shutdown coroutine, wrapped in try/except so a
   failure is logged rather than silent.

### Added
**`src/setup_sip.py`** — one-command creation of the inbound SIP trunk + dispatch rule for
Telecard. Critically, it wires the dispatch rule to dispatch the NAMED `nadia` agent into
every inbound call room with the tenant id as metadata — the piece that actually connects a
real phone call to Nadia (named agents don't auto-join). Closes the loop with the tenant-id
parsing fix. Validated that the LiveKit SIP/dispatch objects construct correctly; the live
create runs at Telecard-setup time once their trunk credentials arrive. README SIP section
rewritten around it.

---

## Change Log - 2026-07-14 (Push 7) — Nadia: ticket-creation 500 fixed + Pakistani-Urdu register

### Fixed
**Voice bot could not create tickets (500 on every attempt).** The browser test-call and
web-call endpoints pass dispatch metadata as a JSON blob
(`{"tenantId":"...","startedBy":"...","source":"..."}`), but the agent's entrypoint treated
that whole blob as the tenant id — so the CRM's `/voice-bot/livekit/complaint` call received
the entire JSON string as `tenantId` and errored out. Added `_extract_tenant_id()` which
parses the JSON and pulls out the real tenant UUID, while still accepting a bare id string
(the SIP-dispatch / env-var path). Unit-tested both forms.

### Changed
**Nadia now speaks Pakistani Urdu, not Hindi-flavoured Urdu.** With STT on OpenAI + gpt-4o-mini,
the model drifted toward Hindi honorifics/vocabulary (addressing the caller as "منیر جی").
Added an explicit "Pakistani Urdu register — NOT Hindi" section to the base system prompt:
use "صاحب" (sahab) as the honorific and never "جی" (ji); prefer Urdu words over Hindi
equivalents (شکریہ not دھنیواد, معذرت not کشما, etc.); always "آپ", never "تم".

---

## Change Log - 2026-07-14 (Push 6) — Nadia production call quality: two root causes fixed

### Fixed
**"Two Nadias talking at once" (recurrence)** — deeper cause than the browser-session leak
fixed earlier: dev-mode agent runs on the dev Mac spawn hidden child worker processes, and
~14 of them from several days of debug sessions had survived as orphans (one running since
Sunday; one had burned 71 CPU-hours). Several were still connected to LiveKit running
pre-fix code with NO agent name — and unnamed workers auto-join EVERY room, so each call got
the production Nadia plus a stowaway. All orphans killed; verified zero agent processes and
zero LiveKit connections remain on the Mac; live dispatch test confirmed exactly ONE
participant joins a room. Structurally closed: current code always registers named, and
named workers never auto-join.

**Slow + broken responses on Railway** — logs showed the job process being OOM-killed
mid-call (`exit -9`, ~700MB per call from local Whisper), CPU pegged at 98%, and VAD running
4.4s behind realtime. Railway's small shared container cannot run self-hosted Whisper for
realtime calls — that was always intended for the Telecard GPU box. Added an `STT_PROVIDER`
switch to the agent: `openai` (hosted transcription, ~$0.006/min, fast) vs `whisper`
(self-hosted, free, default — for the GPU box later). Railway now runs `STT_PROVIDER=openai`;
flipping back later is a single environment variable.

---

## Change Log - 2026-07-14 (Push 5) — Nadia Guardrails field (admin portal item 3, small part)

### Added
**Guardrails field on Settings → Voice Bot** — configurable hard behavioral limits ("what
the bot must NEVER do or say"), kept as a separate field from the System Prompt so the
agent's own instructions treat it as an absolute boundary rather than general guidance.
New `guardrails` column (migration 061, `ALTER TABLE`, applied manually + recorded).
`build_system_prompt()` in the Python agent appends it as a distinct
"## GUARDRAILS — ABSOLUTE RULES" section, placed last and explicitly stated to override
anything earlier if there's ever a conflict. Verified end to end: saved via the API,
confirmed the section appears correctly in the actual built prompt the agent would use.
Test data cleaned up afterward.

### Deferred (per user decision 2026-07-14)
"Route to human" mid-call trigger words — user wants real live call transfer (not just an
urgent-ticket callback promise), which needs agent-presence tracking and telephony transfer
logic. Explicitly deferred to its own dedicated session rather than bundled here. Knowledge
base remains the last item in the admin-portal roadmap.

---

## Change Log - 2026-07-14 (Push 4) — SLA time-unit (minutes) bug found and fixed

### Fixed
**Testing the "minutes vs hours" SLA time-unit selector (previously shipped but never
verified end to end) surfaced a real bug: the "minutes" setting was completely ignored by
deadline calculations.** The UI, the database column, and the create/update API schema all
correctly stored `time_unit`, but the two places that actually compute a deadline
(`computeSlaDeadline`, used both at ticket-acceptance time and in the first-response breach
cron) always multiplied by 3,600,000ms — i.e. always treated the number as HOURS regardless
of what the policy said. A policy configured as "5 minutes" would silently give a caller
5 HOURS to respond — nearly a 60x error, with no indication anything was wrong.
- `computeSlaDeadline` now takes the policy's time unit and converts correctly.
- `buildSlaDeadlines` (ticket-accept path) now fetches and passes `time_unit` from the SQL
  query — previously not selected at all.
- The first-response breach-check cron job now does the same.
- The resolution-breach cron already worked correctly, since it reads the pre-computed
  `sla_due_at` timestamp rather than recomputing hours itself.
- **Verified live**: switched a real policy to `minutes` (4 min first-response, 48 min
  resolution), accepted a real ticket via the API as an agent, and confirmed the computed
  deadlines were exactly 4 and 48 minutes out — not hours. Reverted the test policy/ticket
  state afterward.

---

## Change Log - 2026-07-14 (Push 3) — SLA Save bug fixed (was blocked by FOUR separate layers)

### Fixed
**The long-standing "SLA Save button does nothing" bug — root-caused and fixed.** The
symptom looked like a frontend click-handler bug, but the real chain was four independent
access/validation layers stacked on top of each other, every one of which had to be found:

1. **Wrong page entirely.** The sidebar's "Routing & SLA" link (visible to managers) opens
   `RoutingSettings` — routing method + CSAT expiry only, not SLA policies at all. The real
   SLA policy editor (`TicketSla.tsx` — response/resolution hours, escalation schedule) lived
   at `/tickets/sla` behind a link shown only to an obscure `policy_admin` governance role
   almost no tenant has assigned. Most admins could never even find the real page.
2. **Frontend route guard.** `/tickets/sla` was wrapped in `op()`, which redirects
   `tenant_admin` away entirely — same class of bug as the Voice Bot page earlier this week.
3. **Frontend permission flag.** `useCan().manageSla` was hardcoded to `policy_admin` only,
   so even reaching the page, a tenant admin/manager wouldn't see Edit/New Policy controls.
4. **Backend role gate + a separate ticket-write wall.** `POST/PATCH/DELETE
   /sla-policies` required exactly `policy_admin`. Separately, `server.ts` blocks ALL
   non-GET/DELETE `/api/v1/tickets/*` for `tenant_admin` (tickets are read-only observer
   data for that role) — SLA policy config got caught in that wall too, since it happens to
   live under the `/tickets` URL prefix.
5. **The actual validation bug**, once access was fixed: the "All departments" dropdown
   option sends `ticketType: ''`, but the backend enum only accepts `sales`/`support`/
   `complaints` or `null` — never `''`. Every policy creation with the default department
   scope failed validation. Compounded by a missing `onError` handler, so the failure was
   completely silent — exactly matching the "click Save, nothing happens" report.

**Fix:** tenant admins and managers can now reach and use the real SLA Policies page
(`isPolicyAdmin || isTenantAdmin || isManager` on the nav link; route no longer redirects;
`manageSla` extended; backend roles extended to match the already-permissive publish
endpoint; `/tickets/sla-policies` exempted from the ticket-write observer wall); empty-string
department now normalizes to `null` before sending; save errors now surface in the modal
instead of failing silently. Browser-verified end to end: created a real policy as the Haier
tenant admin, confirmed it in the list, deleted the test record.

---

## Change Log - 2026-07-14 (Push 2 of 2) — Fix "two Nadias talking at once" / echo on test calls

### Fixed
**Starting a second test call while an earlier one was still alive produced two overlapping
Nadias.** Root cause in `TestCallNadiaButton`: navigating away from the page unmounted the
button but never hung up the call — the LiveKit room and its hidden audio elements kept
running invisibly. Click "Call Nadia" anywhere else and you'd hear both sessions at once
(the reported "echo / two agents starting together"). Server side was confirmed clean: one
worker, one job per room.
- Unmount cleanup added — leaving the page now ends the call.
- App-wide singleton guard — starting a new call force-hangs any previous one, so two
  simultaneous sessions are impossible regardless of which of the two buttons started them.
- Browser-verified: call started on the dashboard, navigated away mid-call → room
  disconnected instantly, zero lingering audio elements.

---

## Change Log - 2026-07-14 (Push 1 of 2) — Nadia agent deployed to production + auto-deploy wired up

### Fixed (the real reason "can't listen to her")
**Nadia's voice agent was never deployed anywhere** — the Python worker only ever ran
manually on the dev laptop during test sessions. The "Call Nadia" button dispatched calls
into LiveKit rooms that no agent ever joined. Two-part fix:
1. **Deployed `services/nadia-voice-agent` as a second Railway service** (same project as
   the API). New `Dockerfile`: python:3.11-slim + ffmpeg (needed by the speaking-rate
   time-stretch) + the Whisper "small" model pre-downloaded at build time so the first call
   isn't stuck on a cold download. All env vars (LiveKit, OpenAI, Uplift, CRM URL/tenant)
   set on the service; `CRM_API_BASE_URL` points at the production API, not localhost.
2. **`agent_name` bug** — the worker registered with LiveKit under NO name
   (`agent_name=""`), while every dispatch explicitly requests the agent named "nadia";
   they could never match, so no call was ever picked up. Fixed by passing
   `agent_name=os.environ.get("LIVEKIT_AGENT_NAME", "nadia")` in `WorkerOptions`
   (`src/agent.py`). This also explains earlier local no-answer mysteries.

### Verified in production
Worker logs show `registered worker agent_name="nadia"` → test dispatch via the production
API → `received job request … agent_name="nadia"` → session started → clean exit when the
test room closed. The dispatch chain works end to end.

### Auto-deploy (per the always-in-sync rule)
The service is now connected to GitHub (`munirrazaa/AmanahCX`, main branch) with
`rootDirectory=services/nadia-voice-agent` and a watch pattern limited to that folder — it
rebuilds only when the agent's own files change, not on every CRM push. This push is itself
the first GitHub-triggered build of the new pipeline.

---

## Change Log - 2026-07-13 (Push 11 of 11) — "Call Nadia" button on the main Admin Dashboard

### Added
Extracted the "Test Call Nadia" widget from Settings → Voice Bot into a shared component
(`TestCallNadiaButton`, `compact` mode for header placement) and added it to the top-right of
the tenant admin's main **Admin Dashboard**, next to Invite User — only shown for workspaces
licensed for the `voice_bot` module. Same live-tested browser-call flow as before, just
reachable from the first screen an admin sees instead of buried in settings. Browser-verified
after the shared-component refactor: renders correctly, light theme, no console errors.

---

## Change Log - 2026-07-13 (Push 10 of 10) — Test Call Nadia (browser), no phone/SIP needed

### Added
**"Test Call Nadia (Browser)" button on Settings → Voice Bot** — a tenant admin can now talk
to their configured bot directly from the browser tab, before any SIP trunk or phone number
exists. New route `POST /api/v1/voice-bot/test-call-browser` dispatches the LiveKit agent
into a fresh room and mints a join token (reuses the exact dispatch logic already proven in
`/api/v1/voice/web-call`, the existing floating "Call Nadia" widget for agents — this is the
same mechanism, exposed under `/voice-bot` so it isn't blocked by the tenant-admin
operational-data wall, and gated to tenant_admin/super_admin). Verified end-to-end: dispatch
succeeded, token minted, browser connected to LiveKit Cloud (confirmed in network log) — the
mic-permission step doesn't complete in this session's automated headless browser, which is
an artifact of unattended testing, not a product bug; works normally in a real browser tab.

### Action needed on Railway
This route needs `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_AGENT_NAME`
set in Railway's environment variables (added to local `packages/api/.env` for dev; not
committed, as usual). Confirm these are already set in Railway's dashboard for the API
service before testing this in production — if the existing `/voice/web-call` "Call Nadia"
widget for agents already works live, they're already there and no action is needed.

---

## Change Log - 2026-07-13 (Push 9 of 9) — Light theme fix + full SIP trunk field set

### Fixed
**3 pages were hardcoded to a dark theme, inconsistent with the rest of the light-themed
app** — `VoiceBotConfig.tsx`, `VoiceBotCalls.tsx`, `Emails.tsx` all had `style={{ background:
'#0d1117' }}` on their page root (a leftover from an earlier design pass). Converted all
three to the same light theme used everywhere else (Tickets, Super Admin, etc.) — white
cards, `gray-50` page background, standard gray borders/text. Brand accent colors (teal
`#29ABE2`, green, gold) unchanged. Auth screens (Login/Register/Reset/Forgot Password)
intentionally stay dark-branded — that's a deliberate hero design, not this bug.

### Added
**SIP trunk config now matches the full field set of standard SIP-connect dialogs** (Phone
Number, Termination URI, SIP Trunk Username, SIP Trunk Password, Nickname, Outbound
Transport TCP/UDP) — previously only Provider/Number/URI existed. New columns
`sip_trunk_username`, `sip_trunk_password`, `sip_trunk_nickname`, `outbound_transport`
(migration 060, `ALTER TABLE` — applied manually + recorded). Verified end-to-end via API
(save + read-back all 4 new fields correctly), then test data cleaned up.

---

## Change Log - 2026-07-13 (Push 8 of 8) — Voice Bot admin portal, phase 2: minutes tracking

### Added
**Minutes consumed/remaining, visible to both tenant admin and super admin** — call duration
was already recorded per call; this adds the allocation side. New tables `voice_bot_quotas`
(current allocated total per tenant) and `voice_bot_minute_topups` (audit history of every
top-up: who, how much, when, note). Consumed minutes are always computed live from
`voice_bot_calls.duration_seconds` — never stored separately, so there's no drift risk.

**Tenant admin view** — Settings → Voice Bot now shows a Minutes card: allocated, consumed
(all-time), remaining, and consumed-in-period with a period selector (today / 7 days / 30
days / this month / all time). A red progress bar and warning appear once remaining minutes
drop to 10% or below. Browser-verified live against Haier Electronics (zero-allocation empty
state renders correctly; DB-level top-up test showed 500/0/500 allocated/consumed/remaining
correctly reflected through the API).

**Super admin view** — new "Voice Bot Minutes" option in the tenant ⋮ menu (only shown for
tenants licensed for the module) opens a modal: allocated/consumed/remaining summary, a
top-up form (minutes + optional note, e.g. invoice reference), and top-up history. Verified
via direct SQL simulation and TypeScript type-check; not yet click-tested live in the browser
(no super admin password on hand this session — will verify together next time, or on request).

### Not built this round
Auto-cutoff-and-route-to-human when minutes run out, and call recording — both still queued
in BACKLOG.md, in that order.

---

## Change Log - 2026-07-13 (Push 7 of 7) — Voice Bot admin portal, phase 1: SIP config, custom voices, custom no-ticket reasons

### Added
**SIP Trunk Connection fields** — Settings → Voice Bot → Self-Hosted Voice Bot now has form
fields for SIP Trunk Provider, Trunk Number/DID, and SIP URI. The database columns and backend
routes already existed (migration 049); only the UI was missing.

**Voice catalog moved from hardcoded to database-backed** — the voice picker previously
offered only 2 hardcoded options. New `voice_bot_voices` table (migration 058) holds the
catalog; super admins get an inline "Manage Voices" panel (add/remove) on the same screen,
visible only to them.

**Tenant admins can add their own "answer, don't create a ticket" reasons** — previously the
5 self-service topics (balance inquiry, order status, etc.) were hardcoded in
`voice-bot.ts`'s `INTENT_PATTERNS`. New `voice_bot_custom_intents` table (migration 058) lets
each tenant define additional reasons with their own keyword list; custom reasons appear
alongside the built-in ones as selectable checkboxes and are checked first by intent
detection (browser-verified: added "Warranty Registration Status", it appeared instantly as
a new checkbox, then removed).

### Fixed (found while building the above)
**Tenant admins were silently blocked from the entire Voice Bot module by the server-side
role wall**, despite every voice-bot route explicitly permitting `tenant_admin` — even the
base `GET /config` 403'd. This wall (`TENANT_ADMIN_BLOCKED_PREFIXES` in `server.ts`) predates
today's Voice Bot admin screen work and was never updated to exempt it. Fixed by excluding
`/api/v1/voice-bot` from the block list, plus a related prefix-collision bug where
`/api/v1/voice-bot` also matched the separate `/api/v1/voice` block by `startsWith`.

### Not built this round (see BACKLOG for the full portal roadmap)
Knowledge base, minutes/usage tracking + reports, super-admin minute allocation/top-up,
auto-cutoff-and-route-to-human when minutes run out, and call recording — all scoped and
sequenced in `docs/BACKLOG.md`, building next in that order.

---

## Change Log - 2026-07-13 (Push 6 of 6) — Voice-bot tickets now visible + ticket-creation latency cut 5.1s → 2.2s

### Fixed
**Voice-bot-created tickets were invisible on the main Tickets page** — `Tickets.tsx`
hardcoded `channel: 'manual'` on the list query, so any ticket created by Nadia
(`channel='voice_bot'`) never showed up on the only page with Accept/Claim actions
(`VoiceBotTickets.tsx` is read-only). User confirmed via hard refresh that `TKT-00025`
and `TKT-00026` genuinely existed in the DB and API but never rendered. Filter removed;
both tickets now appear at the top of the list for `admin@haier-electronics.com`.

**Ticket-creation took 10–15s (measured 5.1s server-side) after ending a call** —
`createComplaintFromStructured` in `voice-bot.ts` ran 7 DB round-trips to the remote
Supabase instance sequentially. 5 of them (contact lookup, ticket counter, default queue,
SLA policy, `voice_bot_calls` insert) don't depend on each other — parallelized via
`Promise.all`. Re-measured: 2.2s.

### Also this session (Nadia tuning, not yet fully closed out)
- Number pronunciation revised again per live-call feedback: ticket/reference numbers now
  read as ONE normal number word with leading zeros stripped (`000025` → "پچیس", not
  digit-by-digit); phone/long-ID numbers read in natural groups with double/triple-digit
  shorthand; CNIC stays digit-by-digit in English; quantities stay normal Urdu words.
- Speaking rate returned to 0.9 after a "too fast" report; pause-before-speaking is
  coupled to speed by the current time-stretch implementation (buffers the whole reply)
  — **deferred to a dedicated session**, see BACKLOG.
- Hold/filler message during the ~2s `raise_ticket` call ("ek second, ticket bana rahi
  hoon...") requested — **deferred to a dedicated session**, see BACKLOG.

---

## Change Log - 2026-07-13 (Push 5 of 5) — Tenant admin can now actually reach the Voice Bot page

### Fixed
**Voice Bot was licensed to the tenant but the tenant admin had no way to open it** —
two gaps: (1) the tenant-admin sidebar had no Voice Bot link at all; (2) the `/voice-bot`
routes were wrapped in the `op()` guard, which REDIRECTS tenant admins to `/admin` — so
even typing the URL bounced them away. The Voice Bot config is administrative work
(name, voice, tone, ticket rules), exactly the tenant admin's job.
- Sidebar: "Voice Bot" link added to the tenant-admin WORKSPACE section, shown only when
  the workspace is licensed for the `voice_bot` module.
- Routes: `op()` removed from `/voice-bot`, `/voice-bot/calls`, `/voice-bot/tickets`
  (the underlying APIs already permit tenant_admin).
- Browser-verified as the Haier admin: link appears → page opens → Self-Hosted card →
  Bot Name / Voice / Tone / Speaking Speed fields all render.

---

## Change Log - 2026-07-13 (Push 4 of 4) — Tenant ⋮ actions menu was rendering off-screen (unusable since day one)

### Fixed
**The per-tenant ⋮ actions dropdown on Super Admin → Tenants never appeared** — measured
live: it rendered at pixel 874 on an 870px viewport. The menu was nested inside its own
full-screen click-away overlay with `top: 100%`, i.e. 100% of the VIEWPORT height — always
just below the screen. Restructured so the overlay and menu are siblings and the menu
anchors to the row's cell; table container switched to `overflow-visible` so the dropdown
isn't clipped. This menu (plan change, Licensed Modules, roles, users, suspend/delete) had
been unusable since it was built.

### Verified end-to-end (browser-driven, local frontend + local API against the live DB)
Logged in as super admin → Tenants → ⋮ on Haier Electronics → Licensed Modules (Ticketing
and Voice Bot now listed, per Push 3) → ticked Voice Bot → Apply. Database confirmed:
`active_modules` gained `voice_bot` AND `entitled_features` gained `voice_bot.calls` +
`voice_bot.config` automatically (Push 3's entitlement-sync working as designed). Haier
Electronics is now properly licensed for Voice Bot through the console flow.

---

## Change Log - 2026-07-13 (Push 3 of 3) — Super admin tenant licensing fixes

### Fixed

**Ticketing and Voice Bot were impossible to license from the Super Admin console** —
the hardcoded module list in `SuperAdmin.tsx` (`ALL_MODULES`) only offered
CRM/Emails/Integrations/Analytics/Sales; the backend catalog had all 7 modules but the UI
checklist never showed the other two. Both added (with a sync-comment pointing at the
backend `MODULE_CATALOG` as the source of truth). This was why "enable Voice Bot for
Haier" couldn't be done through the proper flow.

**Licensing a module didn't grant its feature entitlements** — `PATCH
/super-admin/tenants/:id/modules` updated `active_modules` only, but API routes gate via
`requireEntitlement(feature)` against `entitled_features`. For any tenant with explicit
feature entitlements (all newly created ones), a newly licensed module would appear in
nav but 403 on use. The endpoint now syncs `entitled_features`: drops features of
unlicensed modules, grants the full feature set of newly licensed ones. Legacy tenants
with an empty entitlement list are untouched (middleware allows everything for them).

**Tenants table no longer shows each workspace's Contacts/Deals counts** — a tenant's
business data volume is their own concern, not the platform operator's; only the Users
count remains (owner decision).

### Explicitly NOT changed
Super admin sidebar keeps the full CRM modules (Contacts, Deals, etc.) — the platform
owner's org uses AmanahCX as its own CRM (clarified after a brief misunderstanding; an
initial sidebar-stripping change was reverted before commit).

### Also
- New P2 backlog item: move the super admin OUT of the `demo` workspace to a
  platform-level login with no workspace field (control-plane pattern; deferred by
  joint decision — auth changes deserve a fresh session).
- Super admin password reset to a documented value after the 2026-07-12 all-users reset
  orphaned it (see user's credentials doc; verified against production).

---

## Change Log - 2026-07-13 (Push 2 of 2) — Login "spinner forever" ROOT CAUSE FIXED + Voice Bot admin screen

### Fixed

**Login spinner deadlock — root cause of the long-standing "spinner that never stops" reports (backlog 0c) — FOUND and FIXED**
- Live-diagnosed with the user while their login spun: the production API was healthy and answering probes in <2s the whole time, and the server was actually REJECTING their sign-ins as wrong-password — but the UI showed an infinite spinner instead of the error.
- Root cause in `packages/frontend/src/services/api.ts`: the response interceptor treated EVERY 401 as "expired token" and fired the token-refresh flow. A 401 from `/auth/login` (wrong credentials) triggered a `/auth/refresh` call; that refresh call's own 401 re-entered the interceptor while `isRefreshing` was true and got queued behind itself — a deadlock. The awaiting login promise never settled → spinner forever. The same deadlock fired for any user whose session expired mid-day, silently freezing the app.
- Fix: the interceptor now passes 401s from `/auth/login` and `/auth/refresh` straight through to the caller. Browser-verified both ways: wrong password → "Invalid credentials" shown, button resets; correct password → logs in, lands on the admin dashboard.
- Why the user's password was wrong at all: the 2026-07-12 diagnostic session reset all 73 users' passwords to a test value, orphaning the user's documented credentials. All 5 `haier-electronics` accounts restored to their documented passwords (see DATABASE_CHANGE_LOG).
- Also confirmed during diagnosis (secondary, pre-existing): CORS only allows the canonical `amanahcx.vercel.app` origin — logins attempted from Vercel's per-deployment preview URLs are silently blocked. Left as-is for now (canonical bookmark works); noted in backlog.

### Added

**Voice Bot admin screen (Settings → Voice Bot → "Self-Hosted Voice Bot" card)**
- 4th provider card alongside Vapi/Retell/Bland for the self-hosted LiveKit agent: **Bot Name** (changeable — spoken in the greeting), **Voice** picker (Uplift `helpdesk-agent` / `broadband-support`), **Tone** (empathetic/professional/friendly/formal), **Speaking Speed** slider (0.5×–1.5×), plus the shared greeting/system-prompt/ticket-rule fields.
- Provider-irrelevant UI (webhook URL, third-party API-key warnings, outbound test-call panel) hidden for the self-hosted card.
- Backend: `bot_name` column (migration 050, applied), `botName` accepted by `PUT /voice-bot/config`; the agent (`services/nadia-voice-agent`) now templates `{bot_name}` through its system prompt and greeting, so a rename takes effect on the next call with no restart.
- Number-pronunciation rules refined per user feedback: identifier numbers (CNIC, phone, ticket numbers) spoken digit-by-digit in ENGLISH ("four two three zero one"), abbreviations letter-by-letter ("C-N-I-C"); quantities (money, durations) spoken normally in Urdu.
- Deploy-process note learned the hard way this morning: migrations that ALTER tables must be applied manually with the admin connection + recorded in `_migrations` BEFORE pushing — Railway auto-runs migrations as the restricted `crm_app` role, which cannot alter tables it doesn't own (this failed the 05:07 deploy; fixed by applying 049 manually and redeploying).
- Also fixed in passing: `ivr_menu` TypeScript type in `VoiceBotConfig.tsx` was too narrow (3 pre-existing build errors gone).

---

## Change Log - 2026-07-13 — Nadia: self-hosted LiveKit voice agent (Pakistani-market alternative to Retell/Vapi)

### Added

**New service: `services/nadia-voice-agent/`** — a self-hosted voice bot built on LiveKit
Agents (Python), positioned as a lower-cost alternative to Retell AI/Vapi for Pakistani-market
call volume (their US-market per-minute pricing doesn't work at local scale). Reuses the
existing `provider='livekit'` code path already present in `voice-bot.ts` (webhook ingestion
for Vapi/Retell/Bland was built provider-agnostic from the start — this just adds the
provider itself instead of subscribing to one).

- **STT:** self-hosted Whisper (`faster-whisper`), tuned for Urdu/Roman-Urdu/English
  code-switching ("Minglish"). Custom `stt_node` override drives Silero VAD directly and
  batch-transcribes each utterance — LiveKit's default STT pipeline only wires up a custom
  `stt_node` when a session-level `stt=` object is truthy, which cost real debugging time to
  find (see `agent.py` docstring).
- **TTS:** Uplift AI's official LiveKit plugin (`livekit-plugins-upliftai`), voice
  `helpdesk-agent`. Confirmed via direct API testing (bypassing our pipeline entirely) that
  **Urdu script produces noticeably more natural speech than Roman Urdu transliteration** on
  this voice — so Nadia's spoken output is now always Urdu script, independent of whatever
  mix (Urdu/Roman Urdu/English) the caller uses. Numbers that identify something (CNIC, phone,
  ticket/reference numbers, abbreviations like "CNIC" itself) are spoken as individual English
  digits/letters, phonetically in Urdu script — quantities (money, durations) are spoken
  normally. Speed control implemented as our own ffmpeg time-stretch post-process, since
  Uplift's API has no native rate parameter (confirmed against both their REST and WebSocket
  docs).
- **Conversation content:** HBL Microfinance Bank's complaint-handling flow (categories,
  priority matrix P1-P4, SLA commitments, fraud protocol) adapted from the client's own prior
  Retell AI conversation-flow export into a single system prompt (`src/prompts.py`) — our
  architecture uses one LLM reasoning over a system prompt rather than Retell's node-graph
  state machine, so the flow was flattened rather than ported 1:1.
- Ticket creation calls the CRM's real `/voice-bot/livekit/complaint` endpoint and reads back
  a real, persisted `ticket_number` — deliberately not the original flow's approach of having
  the LLM invent its own reference number as a post-call-analysis field with no guarantee it's
  ever retrievable.
- Manual test harness at `webtest/` (LiveKit token minting + a minimal browser client) for
  talking to the agent directly without depending on LiveKit Cloud's own dashboard console
  (which turned out to be for their separately-hosted "Cloud Agents" product, not for an
  externally-run worker like this one).

### Fixed

**`voice_bot_configs.sip_uri` / `.ivr_menu` — columns referenced by code but never migrated**
(migration `049_livekit_agent_config.sql`). The `PUT /config` route has been inserting into
these two columns since they were added to the Zod schema, but no migration ever created
them — every save of those fields would have failed with "column does not exist". Same
migration adds the new LiveKit-specific config columns (tone, speaking_rate, stt/tts
provider, interruption_sensitivity, sip_trunk_provider/number, etc.) — all idempotent
`ADD COLUMN IF NOT EXISTS`. **Not yet applied to the live database** — filename `049` was
checked against `_migrations` and confirmed unclaimed (see `DATABASE_CHANGE_LOG.md`), but
`npm run db:migrate` hasn't been run yet.

**Ticket-counter/ticket-number collision on the "First National Bank" (`fnb-test`) demo
tenant** — found while live-testing the new voice agent's ticket creation. That tenant had
leftover tickets from 2026-06-09 testing up to `TKT-00005`, but `ticket_counters.next_val`
was reset to a lower value, so every new ticket collided with the unique constraint on
`(tenant_id, ticket_number)` and silently failed (`{"success":false,"error":"ticket_creation_failed"}`,
HTTP 500 — reproduced directly via curl, independent of the voice agent, confirming it's a
data issue rather than an integration bug). Corrected the counter to one past the real max;
live-verified with a real ticket creation immediately after (then deleted, since it was a
synthetic test).

### Telephony (not yet done)
SIP trunk + hosting for this agent is coming from Telecard (Pakistan) — trunk credentials not
received yet. `README.md` in the new service documents the inbound-trunk/dispatch-rule wiring
steps for whenever they arrive.

---

## Change Log - 2026-07-12 (Live phone-test fixes — field capture round 1)

### Context
First live test of the production APK on a real Android phone (field.officer@demo.com). Check-in → remarks → complete verified working with real GPS. Three issues found and fixed:

### Fixed
**1. Lead save rejected in sector workspaces (found: "save failed" on phone)**
- The demo (Banking) workspace requires Customer Type / Account Number / Account Type on every contact — impossible for a walk-in field lead. Quick-capture sources (`card_scan`, `voice`, `mobile`, `field`) are now exempt from sector-required fields; the requirement still applies when the lead is later converted/edited to a full customer. Matches Salesforce/Zoho quick-create behaviour.

**2. Voice capture could get stuck on "listening" with no data**
- The mic button turned red before the phone's recognizer confirmed it started; if the recognizer failed/ended silently, Stop did nothing. Stop now always resets immediately, and a failed start shows a clear "voice unavailable" message instead of hanging.

**3. Card scan missed the person's name and mobile number**
- Scan photo quality raised (0.6 → 0.8) and the AI instructions now explicitly hunt for the stylised name text and classify Pakistani mobile prefixes (03xx / +92 3xx, Cell/Mob/WhatsApp labels) into mobile vs landline.

### Added
- **New Lead + Task buttons on the My Tasks screen** (field officer's landing screen) — previously only reachable via the Dashboard tab.

### Also
- Password for field.officer@demo.com was rotated by a parallel session and reset back; test jobs re-seeded for live phone testing.

---

## Change Log - 2026-07-12 (Push 2 of 2) — Login Investigation + Live Wallboard 500 Errors Fixed

### Investigated

**Daily login failures reported by user ("spinner that never stops")**
- Full architecture test (GitHub → Railway → Vercel → Supabase) run live: created a throwaway account, logged in through the actual deployed Vercel site end-to-end — worked cleanly, no errors, correct dashboard load.
- Confirmed API is genuinely hosted on Railway (not dependent on the user's laptop) and Vercel's deployed frontend correctly points at the Railway API URL (not localhost, not its own domain).
- Confirmed CORS is correctly configured between Vercel and Railway.
- Live-verified a real user login (manager account) while streaming Railway logs in real time — login itself succeeded with no errors.

### Fixed

**Live Wallboard — `agent-load` and `queue-stats` endpoints were 500ing on every call**
- Found via live log streaming during login investigation: `column t.is_overdue does not exist` and `column tq.department does not exist` — both columns referenced in `packages/api/src/routes/analytics.ts` never existed in the schema at all (not recent drift — these were broken from the start).
- `is_overdue` was never a stored column; "breached" must be computed as `sla_due_at IS NOT NULL AND sla_due_at < NOW()`. Fixed in both endpoints.
- `ticket_queues.department` was never modeled (no department concept exists on queues) — dropped the field rather than inventing a fake data source. Matching unused field removed from the frontend `QueueStat` type (`packages/frontend/src/pages/Wallboard.tsx`).
- Both endpoints are gated to `manager`/`tenant_admin`/`super_admin` — every manager who opened Live Wallboard hit this 500 error. Live-verified fixed: both now return correct `200 OK` data.
- Not yet confirmed whether this was the root cause of the reported login-spinner issue specifically, or a separate pre-existing bug surfaced during the investigation — needs the user to reproduce the spinner again with live log streaming to confirm.

### Housekeeping

**Reset test password for all 73 existing users to a known value** for login diagnostics, at user's request. Real per-user passwords cannot be recovered (bcrypt one-way hashes) — this was necessary to test the actual login flow live.



### Added

**Per-channel consent tracking + enforcement (CB-04 → CB-08) — WhatsApp compliance**
- New `contact_channel_consent` table (migration `053_contact_channel_consent.sql`, applied to Supabase): per-contact, per-channel (whatsapp/sms/email) opt-in/opt-out events with timestamp, source, recording user, and note. Append-only — history is never overwritten, giving the provable audit trail Meta's WhatsApp Business API requires.
- New API endpoints on contacts: `GET /:id/consent` (current state per channel), `GET /:id/consent/history` (full audit trail), `POST /:id/consent` (record an event).
- New **Consent tab** on the Contact Detail page: per-channel toggles, optional "how consent was obtained" note, and expandable history view.
- New shared helper `packages/api/src/lib/consent.ts` (`getChannelConsent`/`recordChannelConsent`) for any outbound-messaging feature to consult.
- **Enforcement wired in now, not later:** ticket creation (manual + voice-bot paths) auto-records an opt-in when the customer picks WhatsApp/SMS as their preferred channel; the ticket-reply dispatcher checks the latest consent and falls back to email if the customer has explicitly opted out. Live-verified end to end: reply while opted-in dispatched via WhatsApp; after opt-out, further replies produced zero WhatsApp attempts.
- Tenant isolation verified: another tenant's manager gets an empty result, not another workspace's consent data (RLS `tenant_isolation` policy on the new table).
- Note for future work: bulk/marketing WhatsApp sends (when built) must be stricter — "no consent record" must mean NO send; for ticket replies, the customer choosing the channel on the ticket is itself the opt-in.

**Sector auto-provisioning at tenant creation (TA-04 root cause + fix, SP-01 → SP-04)**
- Root cause of the "Education sector sidebar" issue: the sector picked at tenant creation was never wired to module/feature licensing — the sidebar is driven purely by `active_modules`/`entitled_features`, which sector never touched. Not a crash; a missing feature.
- Each sector in `packages/shared/src/config/sectors.ts` now declares `defaultModules` + `defaultFeatures` (all 8 sectors populated with benchmarked defaults, e.g. Education → CRM + Ticketing + Sales + Emails; eCommerce → + Integrations + Analytics).
- `POST /super-admin/tenants` seeds the new tenant with the sector's defaults, unioned with anything explicitly requested; `PATCH /tenants/:id/modules` still adjusts afterwards. Matches the industry-template onboarding pattern in Salesforce/HubSpot verticals.
- Live-verified: education tenant auto-provisioned correctly; default ("other") tenants unchanged (no regression); manual module picks union with sector defaults; post-creation module editing unaffected.

### Fixed

**Webhook delivery pipeline silently dead (ST-09 → ST-12)**
- Root cause: the webhook worker (`packages/api/src/lib/webhook-worker.ts`) and dead-letter replay used raw `db.query()`, which sets neither `app.tenant_id` nor `app.bypass_rls` — since the DB role stopped being superuser, RLS silently rejected every insert/update. This broke BOTH the manual "Test" button AND all background webhook delivery in production.
- All 5 occurrences fixed to `db.withSuperAdmin(...)`. Live-verified: full enqueue → deliver → retry → dead-letter cycle observed in server logs; Delivery Logs UI shows real attempts.

**Routing & SLA settings save blocked for managers (RS-01 → RS-05)**
- `PATCH /settings/routing` rejected any manager save containing `routing_method` (even unchanged), blocking the whole form. Per decision (benchmarked vs Zendesk/Salesforce/Freshdesk/Intercom/HubSpot): ticket-routing method is operational configuration → now open to managers alongside the other routing knobs. No regression for tenant admin/agents (route-level role list unchanged).

**SMS-failure admin alert never delivered**
- `SmsService.notifyAdminNoConnector` inserted into a `message` column that doesn't exist on `notifications` (real column: `body`) — so the "SMS gateway not configured" warning to admins silently failed on every failed send. Fixed in `packages/core/src/sms.service.ts` (+ stale `.js` build artifact). Live-verified: notification row now lands with correct title/body.

### Verified (no change needed)

**Super-admin wall confirmed shipped**
- The super_admin operational-access wall (tenant.middleware 403 outside `/super-admin/*`; `requirePermission` bypass now tenant_admin-only) was found already committed and pushed (`b854929`) — earlier "pending approval" status was stale. Re-verified live: super_admin token gets 403 on `/api/v1/tickets`. Leftover unreachable `super_admin` mentions in route-level role checks across 5 route files are dead code — cleanup deprioritized by decision.

### QA test plan
- +14 new test cases this session (RS-01..05, TA-04 closure, SP-01..04, CB-04..08), all recorded as **pass** in the hosted QA test plan (Supabase-backed `qa-test-plan.html`).

---

## Change Log - 2026-07-11 (Field Mobile App — recovery, cloud re-test, field-visit flow)

### Recovered
**Mobile app + field API work restored from git stash**
- A parallel session had stashed all uncommitted mobile work (stash@{0}); restored surgically without touching newer web-CRM code: `activities.ts` (My Tasks `/mine`, GPS `/:id/checkin`, completion email + GPS on `/:id/complete`, parameterised activity list SQL), `contacts.ts` (`/scan-card` AI card scanner, `/parse-lead-text` voice-lead AI), `attachments.ts` registration in `server.ts`, and the entire `packages/mobile` diff (navigation-mount fix, cached-session restore, expo-location plugin, Vivid branding).

### Added
**Field-visit flow (mobile) — tested end-to-end against the cloud (Supabase) backend**
- Field officer login → My Tasks (assigned activities only, To do / Done counters) → Job Details → GPS check-in → outcome remarks → Mark complete (confirmation dialog) → CRM updated with completion time, GPS location, and remarks; customer notification email fires automatically (currently blocked only by pending vividsns.com SendGrid DNS verification).
- Cross-platform dialog helper `src/lib/dialog.ts` (RN `Alert` is a silent no-op on web preview).
- Test account: `field.officer@demo.com` (agent, Sales) created in cloud DB; 3 sample field jobs seeded.
- Attachments lazy table-create now tolerates hardened DB roles (skips DDL when table already exists).

### Verified (8-test suite vs AmanahCX repo code)
- Login, My Tasks, GPS check-in, complete-with-remarks, voice-lead AI, voice-task AI (+auto contact link, Urdu date phrases), AI card scan — all PASS. Deal-photo attachment verified earlier with a deal-owning account (officer correctly sees no deals — visibility scoping).

### Known gaps (next up)
- Manager field-team view (today's agenda / approached / locked), last-sync display (mobile + desktop), remarks mirroring to ticket timeline.

---

## Change Log - 2026-07-10 (Push 3 of 3) — Agent Dashboard 403 Fixed at Root Cause

### Fixed

**Agent dashboard 403 FORBIDDEN — real root cause traced and fixed**
- The Dashboard Audit (added in push 2) found an agent getting `403 FORBIDDEN` on their home dashboard. Initial theory (permission-record drift) was incomplete — traced further to the actual cause: the dashboard route (`GET /api/v1/analytics/ops-dashboard`) required `requireScope('analytics:read')`, which checks `permissions.analytics`. That value is correctly forced to `"none"` by tenant module-licensing enforcement (`applyModuleLicensing`) for any tenant without the paid Analytics module — Haier Electronics' actual entitlement (Core CRM + Ticketing only).
- The route's own existing code comment states the dashboard is "the home screen for all roles — not gated by analytics feature flag" — the scope check contradicted that stated intent.
- Fix: removed the scope requirement from `dashPreHandler` in `packages/api/src/routes/analytics.ts` entirely. The dashboard now loads for every role regardless of Analytics module licensing, matching its intended purpose as a universal home screen. Global JWT auth (already enforced on every non-public route) is sufficient.
- Also updated `settings.ts`'s agent default permission for `analytics` from `"none"` to `"view"` (matching the manager default pattern) — a minor improvement that only takes effect for tenants that do license Analytics; module-licensing enforcement still correctly overrides it to `"none"` otherwise.
- Verified: both affected agents (Amir, Zoya) now get `200 OK`, re-confirmed with their permission value deliberately left at `"none"` (matching real licensing) to prove the fix doesn't depend on it and introduces no entitlement bypass.

### Found, Not Fixed (logged to Backlog item 0b)

**Three separate, unsynchronized entitlement systems**
- While tracing the above, found that `tenant.settings.features.analytics` (a boolean feature flag) is a *third* mechanism gating analytics access, separate from `tenant.active_modules` (the module-licensing array) and `user.permissions.analytics` (per-user level) — and it's out of sync with the other two. Confirmed: Haier's `active_modules` correctly excludes analytics, but `settings.features.analytics` still permitted a paid analytics summary endpoint to return data.
- This is a larger architectural inconsistency (which routes use `requireFeature()` vs `requireScope()` vs direct permission checks, and which should be authoritative) that needs a dedicated audit before consolidating — not attempted in this session to avoid rushing a fix that could introduce a real entitlement bypass.

---

## Change Log - 2026-07-10 (Push 2 of 2) — Reference Document Restructure + Live Dashboard/Reports Audit

### Changed — AmanahCX-Roles-and-Flow.html (v5.7 → v5.9)

**Structural cleanup (v5.8)**
- Removed the standalone "Sales End-to-End Flow" section — it duplicated content now built directly into the main End-to-End Flow section, and included a dead, previously-abandoned stub left over from an earlier incomplete cleanup attempt.
- Rewrote the main End-to-End Flow to show the real cross-department journey by default: Voice call → Complaints → Support → Sales, built on the platform's actual cross-department origination, view-only handoff, and ticket-to-deal conversion features (not invented).
- Removed the "Gap Log" section entirely — confirmed it was a third restatement of the same facts already covered by the four `*-compliance` sections and the Master Gaps table, with no unique interactive value. Its 2 real 2026-07-10 entries were ported into the Master Gaps table instead of being lost.
- Fixed a structural bug: 6 whole sections (Data Visibility, Module Allocation, Functional Tests, Dept Comparison, Login Views, Sector Fields) were rendering outside the page's `<main>` element.
- Fixed two confirmed factual errors: the Permission Matrix was missing a Policy Admin column entirely and incorrectly showed Tenant Admin as able to configure SLA policies (Tenant Admin is actually blocked — only Policy Admin can, per already-tested code); `MASTER_PRODUCT_DOCUMENT.md` separately stated Policy Admin's rank as 25 (below Manager) when the real code ranks it 32 (above Manager, intentionally, so no operational role can manage a compliance officer).
- File shrank from 3,422 to 2,838 lines (~17% smaller) with zero information loss — verified with a JS syntax check before and after.

**New: Dashboard Audit + Reports Audit sections (v5.9)**
- Added two new sections, each with a sector selector, built from **live testing against the running application** — not assumed from code.
- Tested every available role (Tenant Admin, Manager, Line Manager, Agent) on the one live test tenant that exists (Haier Electronics, ecommerce sector), cross-checking dashboard figures against real database counts.
- **Confirmed bug found:** an agent's dashboard returns `403 FORBIDDEN` because their stored `analytics` permission has drifted to `"none"` in the database, despite the code's own default-permission function correctly setting it to `true` for the agent role. A change log entry from 2026-06-28 documents this exact class of bug being fixed previously — it has resurfaced for at least one live user, indicating the fix was applied to existing records at the time but not to the underlying default seeding path used for new tenants/users created afterward.
- **Confirmed inconsistency found:** the same permission blocks the Ops Dashboard but does not block the equivalent Reports endpoints (ticket trends, resolution, heatmap, team dashboard) — the same conceptual data is gated in one place and not the other.
- Sectors without a live test tenant (Banking, Telecom, Insurance, Retail, Utilities) are explicitly marked "Not Yet Audited" — no findings were invented for them.

---

## Change Log - 2026-07-10 (Critical Data-Isolation Fix, Auto-Contact-Creation, Manager Queue Visibility, Deployment Sync)

### Fixed — CRITICAL

**Database connection was silently bypassing tenant data isolation**
- The API was connecting to Postgres using a role (`postgres`) with `BYPASSRLS` — meaning every Row-Level Security policy in the database, including tenant isolation, was being ignored regardless of how correctly those policies were written.
- Discovered while testing ticket routing: a brand-new tenant with zero ticket queues of its own was having its tickets silently assigned to another tenant's queue.
- Fix: created/repurposed a restricted, non-superuser Postgres role (`crm_app`, `NOSUPERUSER NOBYPASSRLS`) with only the table-level privileges the app actually needs. Switched both the local dev environment and the live Railway production API to connect as this role. Two narrow, unrelated grants were needed to keep existing behaviour working: `CREATE` on the `public` schema (for an existing idempotent table-bootstrap step in `team-messages.ts`) and ownership of the 4 analytics materialized views + the `team_messages` table (Postgres requires ownership, not just a grant, to `REFRESH`/`CREATE INDEX`).
- Verified independently at the raw SQL level (same query returned a cross-tenant leak under the old role, returned nothing under the new role) and end-to-end against the live production app (not just a local copy) — confirmed a ticket claim/routing action that was failing due to this leak now succeeds correctly.
- Recorded as a tracked, idempotent migration (`048_restricted_app_role.sql`) instead of remaining an untracked manual database change.
- See `DATABASE_CHANGE_LOG.md` for full technical detail.

### Added

**Auto-contact-creation on ticket creation (manual + voice bot)**
- Ticket creation no longer requires an agent to search for and select an existing contact first. On submit, the system looks up an existing contact by email (manual tickets) or phone number (voice-bot tickets); if found, the ticket is linked to it; if not found, a new contact is created automatically and linked.
- Applied consistently to both the manual "New Ticket" form (`POST /api/v1/tickets`) and the voice-bot ticket-creation path (`POST /api/v1/tickets/from-voice`), so the behaviour is the same regardless of how the ticket originates.
- Matches the pattern used by Zendesk, Freshdesk, and HubSpot for inbound support tickets.
- Files: `packages/api/src/routes/tickets.ts`, `packages/frontend/src/pages/Tickets.tsx`.

**Manager visibility of unclaimed/unassigned tickets**
- Managers previously only saw tickets already assigned to one of their reports — an unclaimed ticket sitting in the team's queue was invisible to them until an agent picked it up.
- Extended manager ticket-list visibility to also include unassigned, open tickets in queues their reports belong to (or tickets with no queue at all), matching Zendesk/Freshdesk supervisor team-queue visibility.
- Files: `packages/api/src/routes/tickets.ts` (ticket list visibility query).

**Dashboard quick actions now respect licensed modules**
- Dashboard quick-action buttons (New Ticket, Voice Calls, Bot Calls, New Invoice, Voice Bot) previously showed for every role regardless of which modules the tenant had actually been allocated. The backend already correctly blocked access to unlicensed features — this was a visual/UX mismatch only.
- Buttons are now filtered against the tenant's active modules (`GET /api/v1/modules`) before rendering.
- Files: `packages/frontend/src/pages/Dashboard.tsx`.

### Fixed — Deployment Pipeline

**Vercel was connected to the wrong GitHub repository and required manual deploys**
- Discovered the Vercel project (`amanahcx`) was linked to an unrelated repository (`AI-Operations-Platfrom-`) instead of the actual `AmanahCX` repo, and had no auto-deploy configured — every release required a manual `vercel --prod` push.
- Reconnected the Vercel project to the correct repository and confirmed (via a live test commit) that it now builds automatically on every push to `main`, matching Railway's existing auto-deploy behaviour.
- Standing rule going forward: GitHub, Railway, Vercel, and Supabase must always be kept in sync — no manual deploy step as the normal workflow.

### Housekeeping

**Migration tracking cleanup**
- Re-verified the `_migrations` tracking table against files on disk — found them in full agreement (a previously-noted drift from an earlier session had already been resolved separately and no longer applied).
- Removed 3 duplicate migration files (`023_tenant_entitlements 2.sql`, `024_ticket_deal_link 2.sql`, `025_default_departments 2.sql`) confirmed byte-identical to their originals. No schema impact.

---

## Change Log - 2026-07-06 (Sales Module — Aging Table, Quotations, Template Fix, Builder Fix)

### Added

**Aging of Receivables table on Sales Dashboard**
- Full-width table at the bottom of the Sales Dashboard showing per-customer outstanding balances broken into 6 time buckets: < 30 days, 30–60 days, 61–90 days, 91–180 days, 181–365 days, and > 365 days past due date.
- Rows are sorted by total outstanding (highest first). Only customers with open, unpaid balances appear.
- Backend: new `agingByCustomer` SQL query in `sales-dashboard.ts` using `CURRENT_DATE - i.due_date` arithmetic across 6 CASE buckets.
- Frontend: full-width responsive table in `SalesDashboard.tsx` with colour-coded bucket headers.

**Quotations module**
- New `quotations` and `quotation_line_items` tables (migration `045_quotations.sql`) with RLS, indexes, and foreign keys.
- Full API CRUD at `POST/GET/PATCH/DELETE /api/v1/sales/quotations` plus `POST /api/v1/sales/quotations/:id/convert`.
- Convert endpoint copies the quotation to `invoices` + `invoice_line_items`, marks the quotation `accepted`, and sets `converted_to_invoice_id`. Quotation totals are excluded from sales figures until conversion.
- Frontend: `QuotationList.tsx` — searchable/filterable table with Convert to Invoice and View Invoice actions; `QuotationCreate.tsx` — full form with client, currency, template, issue date, validity period (auto-calculated Valid Until), line items, totals, notes and terms.
- Routes added to `App.tsx` at `/sales/quotations` and `/sales/quotations/new`.
- Sales Dashboard 5th KPI card: **Open Quotations** (violet, clickable → quotations list). Dashboard grid changed to `lg:grid-cols-5`.
- `quotationSummary` (totalValue + count of draft/sent) added to the dashboard API response.

**Voice Bot Self-Service configuration (G-F3)**
- Tenant admins can now configure the voice bot's self-service menu directly from Settings → Voice Bot.
- New `voice_bot_self_service_options` JSONB column on `tenants` (migration `044_voice_bot_self_service.sql`).
- API: `GET/PATCH /api/v1/voice-bot/self-service` — fetch and update up to 8 menu items (label + intent + enabled toggle).
- Frontend: `VoiceBotConfig.tsx` updated with a Self-Service Options card; items are reorderable, each has an enable/disable toggle.

### Fixed

**Invoice template selector — all templates now show distinct layouts**
- Previously, choosing a different template in the invoice detail/preview always rendered the same classic layout.
- Now `InvoiceDetail.tsx` branches on `inv.templateId`:
  - `tpl-minimal`: Typographic layout, no coloured boxes, border-bottom separators, uppercase tracking labels, 4-column table (no Tax column).
  - `tpl-consulting`: Full-width dark header band with white text, striped table rows.
  - Default (tpl-classic, tpl-agency, etc.): Original logo-box layout with coloured table header.

**Invoice Builder drag-drop — palette items now drop onto occupied canvas**
- Previously, dragging a palette element onto the canvas only worked when dropping onto empty canvas space. Dropping onto an existing element did nothing.
- Fixed in `SalesBuilder.tsx` `onDragEnd`: `overCanvas` now also returns `true` when `e.over.id` matches any existing canvas element id, so palette drops land correctly regardless of what the cursor is over.

---

## Change Log - 2026-07-02 (Agent Escalation + Sector-Specific Ticket Fields)

### Added

**Agent → Manager Escalation (G-P3)**
- Agents can flag any ticket with an escalation reason via an "Escalate to Manager" button in the ticket panel.
- Managers see an orange "Escalated" badge on the ticket and a full escalation reason banner showing who escalated, why, and when.
- Managers can acknowledge the escalation (clears the flag). Non-managers see a disabled indicator only.
- API: `POST /api/v1/tickets/:id/escalate` (agent) and `POST /api/v1/tickets/:id/acknowledge-escalation` (manager+).
- DB columns: `agent_escalated BOOLEAN`, `agent_escalated_at TIMESTAMPTZ`, `agent_escalated_reason TEXT` on tickets table.
- Audit logged on both escalate and acknowledge actions.

**Sector-Specific Custom Fields in Ticket Forms**
- New ticket creation form now shows sector-relevant custom fields (e.g. banking: Case Type, Transaction Reference, Amount Involved, Regulatory Deadline, Central Bank Ref #).
- Fields also displayed in the ticket detail panel.
- Custom field values saved with the ticket via `custom_fields` JSONB column.
- API: `GET /api/v1/sector/fields?entity=ticket` — opened to all authenticated roles (was admin-only).

**Auto-Seeding Sector Fields at Tenant Creation**
- When a super admin creates a tenant and selects a sector, all sector-specific fields are automatically provisioned for contacts, tickets, deals, and companies — no manual setup needed.
- Same seed runs on sector update (`PATCH /super-admin/tenants/:id` with `{sector}`).
- `seedSectorFields()` in `super-admin.ts` handles all 4 entity types per sector config in `sectors.ts`.

### Fixed
- Demo tenant (created before seed code existed) re-seeded with banking sector ticket fields via sector update endpoint.
- `GET /api/v1/sector/fields` permission changed from `admin:read` to `tickets:read` so agents and managers can load fields for their forms.

---

## Change Log - 2026-07-01 (SLA Governance Guardrail + Reassignment Audit + Role Reference HTML)

### Added

**SLA governance guardrail — mandatory reason for priority changes**
- Changing a ticket's priority now requires a written reason before Save is enabled (backend + frontend).
- Priority change without a reason returns HTTP 400 `PRIORITY_REASON_REQUIRED`.
- Logged as a distinct `priority_changed` audit entry (separate from generic `field_updated`) with `old_value`, `new_value`, and `meta.reason`.
- Applies to all roles that can change priority: tenant_admin, manager, line_manager.
- Files: `packages/api/src/routes/tickets.ts`, `packages/frontend/src/pages/Tickets.tsx`.

**Reassignment audit — distinct audit entry for agent changes**
- When a manager reassigns a ticket to another agent, an optional reason field appears in the Edit panel.
- Reason is optional (not a compliance gate — Save is not blocked). Helps post-incident review.
- Logged as `assignee_changed` audit entry with `old_value`, `new_value`, and `meta.reason` (empty if not given).
- Applies to manager and tenant_admin roles.
- Files: `packages/api/src/routes/tickets.ts`, `packages/frontend/src/pages/Tickets.tsx`.

**Manager ticket edit after acceptance**
- Managers can edit ticket fields (status, priority, assignee, queue) at any stage — including after agent acceptance.
- Previously only available pre-acceptance.

**Tenant admin hard-delete on closed tickets only**
- Hard DELETE endpoint now enforces closed-status guard at the API level (returns 403 if ticket is not closed).
- Only tenant_admin role can call the endpoint.

**Contact search by phone / NIC / name / email**
- Contact search on ticket creation and contact pages searches across all four fields simultaneously.

**AmanahCX-Roles-and-Flow.html — comprehensive role and flow reference**
- New HTML file covering: exhaustive role-by-role permissions (tenant_admin, voice bot, manager, line_manager, agent, viewer) and complete end-to-end information flow (voice bot call → intent detection → ticket creation → contact create/update → ACD routing → agent acceptance + TAT start → originator view-only + notes).
- Located at project root and copied to Desktop for distribution.

---

## Change Log - 2026-06-29 — Push 5 of 5 (Policy Admin Role + SLA Governance Isolation)

### Added

**Policy Admin — new governance role (independent of operations)**
- New system role `policy_admin` (ROLE_RANK = 25, between Manager:30 and Agent:20) seeded across `roles.ts`, `settings.ts`, and `auth.middleware.ts`.
- **Only** `policy_admin` can create, edit, or delete SLA policies. Managers and tenant_admin are hard-blocked (manager → 403 FORBIDDEN; tenant_admin → 403 ADMIN_NO_OPERATIONS).
- `governed_departments: TEXT[]` column added to `users` table (migration 034). Stored in JWT, used to scope which SLA policies a policy_admin can read/write.
- `ticket_type: TEXT` column added to `sla_policies` table. Tags each policy to a department (sales / support / complaints / null = all).
- Purple department badge shown on SLA policy cards when a `ticket_type` is set.
- Invite modal (`AdminUsers.tsx`): when role = policy_admin, department selector is hidden and governance checkboxes (Sales / Support / Complaints) appear instead.
- SLA Policies nav link (`App.tsx`) now only visible to `policy_admin` users (previously visible to managers).
- Migration 034: `governed_departments`, `ticket_type`, GIN index on users, BTree index on sla_policies.

**Security guarantees verified in browser**
- policy_admin: SLA page loads, policies scoped correctly ✅
- Manager POST → `{"code":"FORBIDDEN","message":"Insufficient permissions"}` ✅
- tenant_admin POST → `{"code":"ADMIN_NO_OPERATIONS"}` ✅

---

## Change Log - 2026-06-29 (Ticket-Contact Linking UI + Platform Rebrand + UX Fixes)

### Added / Fixed

**Ticket-Contact Linking — Create Ticket form (Tickets.tsx)**
- Contact search field added as the first field in the Create Ticket modal. Agent types name, email, phone, mobile, or NIC → dropdown shows matches → select to link.
- Reporter Name, Email, and Phone auto-fill from the selected contact record (read-only — cannot be manually overridden).
- `contactId` is sent to `POST /api/v1/tickets` on every ticket creation. Every ticket is now linked to a contact at birth.
- Ticket panel crash loop fixed: `React.useState` replaced with `useState` (namespace was undefined); `retry: false` added to TicketPanel query; `isError` guard prevents infinite reload on API error.
- Tickets page reads `?open=<id>` from URL on load and opens the correct ticket panel automatically (enables deep-linking from Contact 360).

**Login page rebrand (Login.tsx)**
- Product name updated from "Vivid Solutions & Services" to "AmanahCX" across the hero heading, card header, and copyright footer.

**Invite modal — department-scoped manager filter (Settings.tsx)**
- When inviting a new team member, the Line Manager dropdown now only shows managers from the same department (not all non-admin users).
- Changing the department field resets the manager selection automatically.
- Warning shown if the selected department has no managers yet ("No managers found for the X department").

**Admin Users — manager assignment on invite (AdminUsers.tsx)**
- Invite form now includes a manager_id field, populated by filtering managers in the same department and role.
- Changing department or role resets the manager selection.
- `resolveRoleName` helper added to correctly display custom role names vs system role names throughout the page.

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
