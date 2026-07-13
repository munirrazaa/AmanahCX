# Nadia — self-hosted LiveKit voice agent

Self-hosted alternative to Retell AI / Vapi for the Pakistani market: same
"customer calls → bot converses → ticket created → routed to the right
agent" flow, but running on your own infra so per-call cost is your server
+ local SIP minutes instead of a per-minute US-market API fee.

**Telephony:** Telecard (Pakistan) — SIP trunk + hosting, arriving in a
few days. **TTS:** Uplift AI, official LiveKit plugin, `helpdesk-agent`
voice, free Urdu testing plan. **STT:** self-hosted Whisper (open
source, no per-call fee — this part is not from Uplift, see below).

Status: **scaffold, not yet run end-to-end.** The Uplift AI wiring in
`agent.py` follows their own verified tutorial and should work as-is once
you have an API key. The self-hosted Whisper STT override is NOT from
that tutorial (Uplift has no STT product for Urdu — their own example
uses OpenAI's hosted STT instead) — test it via LiveKit's browser
Playground before trusting it on a real call. See the docstring at the
top of `src/agent.py`.

## How it fits with the CRM

The CRM (AmanahCX) side of this integration was already built before this
service existed — it's the same code path used for Vapi/Retell/Bland, just
with `provider = 'livekit'`:

- `packages/api/src/routes/voice-bot.ts` → `POST /voice-bot/livekit/complaint`
  (create ticket mid-call) and `POST /voice-bot/livekit/call-ended`
  (attach final transcript) — this agent calls both.
- `voice_bot_configs` table (migration `049_livekit_agent_config.sql`) —
  the per-tenant Retell-style settings this agent reads at call start.
- Auth: shared secret `LIVEKIT_INGEST_SECRET`, set the same value on both
  the CRM API server and this agent's `.env`.

What's still missing on the CRM side: a "LiveKit" card on the Voice Bot
Config page (`packages/frontend/src/pages/VoiceBotConfig.tsx` currently
only lists Vapi/Retell/Bland) — worth adding once this agent is live, so
tenant admins can set tone/voice without hitting the API directly.

## Uplift AI setup

1. Get an API key: https://platform.upliftai.org/studio/home (their free
   Urdu testing plan is enough to get end-to-end working).
2. Set `UPLIFTAI_API_KEY` in `.env`.
3. Default voice is `helpdesk-agent` — Uplift's own description: *"warm
   female customer service voice — patient, empathetic"* — purpose-built
   for exactly this use case. Override via `UPLIFT_VOICE_ID` or per-tenant
   `voiceId` in the CRM config if you want a different one later
   (browse more at docs.upliftai.org/orator_voices).
4. Uplift AI's TTS API has no documented speed/rate parameter as of this
   writing — the `speakingRate` config field is stored but not yet applied
   to the audio. If Uplift adds one later, wire it in the `upliftai.TTS(...)`
   call in `agent.py`.

## The Retell-style config format

This is what you asked for — the same knobs Retell AI's dashboard exposes
(language, tonality, speed, voice), as a JSON body to `PUT /api/v1/voice-bot/config`:

```json
{
  "provider": "livekit",
  "isActive": true,
  "language": "ur-PK",
  "tone": "empathetic",
  "speakingRate": 1.0,
  "voiceId": "helpdesk-agent",
  "sttLanguageHint": "ur-en",
  "llmModel": "gpt-4o-mini",
  "interruptionSensitivity": 0.5,
  "maxCallDurationSec": 600,
  "endCallPhrases": ["allah hafiz", "khuda hafiz", "bye"],
  "greetingMessage": "Assalam-o-Alaikum! Main Nadia bol rahi hoon...",
  "systemPrompt": "Always ask for the customer's account number before...",
  "autoCreateTicket": true,
  "defaultQueueId": null,
  "defaultPriority": "medium",
  "sipTrunkProvider": "telecard",
  "sipTrunkNumber": "+92XXXXXXXXXX"
}
```

| Field | Retell AI equivalent | Meaning |
|---|---|---|
| `language` | Agent → Language | Primary language tag (`ur-PK`) |
| `tone` | Agent → Voice → Style | professional / friendly / empathetic / formal — shapes the system prompt (Uplift's TTS itself has no separate style knob; the voice choice carries most of the tone) |
| `speakingRate` | Agent → Voice → Speed | Stored for future use — not yet applied (see "Uplift AI setup" above) |
| `voiceId` | Agent → Voice → Voice ID | Uplift AI voice ID, e.g. `helpdesk-agent` |
| `sttLanguageHint` | — (Retell doesn't need this; hosted STT) | Biases self-hosted Whisper: `ur-en` (code-switched), `ur`, or `en` |
| `interruptionSensitivity` | Agent → Interruption Sensitivity | 0 = ignore barge-in, 1 = stop the instant it hears sound |
| `maxCallDurationSec` | Agent → Max Call Duration | Hard cutoff |
| `endCallPhrases` | Agent → End Call Phrases | Bot ends the call when it says one of these |

## SIP wiring (Telecard, once the trunk arrives)

1. **Inbound trunk** — register the trunk in LiveKit (`CreateSIPInboundTrunk`
   API or `lk sip inbound create`) using the SIP credentials Telecard gives
   you (host/IP, port, auth username+password, or IP-based auth — ask them
   which). Restrict by their signalling IP if they can provide one.
2. **Dispatch rule** — tells LiveKit which room a call lands in. Use a
   per-tenant room-naming convention (e.g. `tenant-<tenantId>-<callId>`)
   and pass `tenant_id` through as room/participant metadata — `agent.py`
   reads it from `ctx.job.metadata` to load that tenant's config.
3. **Agent dispatch** — this worker's entrypoint is registered via
   `WorkerOptions(entrypoint_fnc=entrypoint)`; your dispatch rule (or an
   explicit `CreateSIPParticipant` call) routes the call into a room this
   worker is subscribed to.
4. Ask Telecard for: the DID (the published Pakistani number customers
   dial), the trunk's SIP signalling details, and whether they need you to
   register with them (residential/IP-auth) or they'll push calls to your
   LiveKit SIP URI directly. Since they're also hosting, confirm the
   server your LiveKit instance runs on has a public IP/domain they can
   reach.

Exact CLI/API syntax: `docs.livekit.io/sip` — verify at setup time.

## Running locally

```bash
cd services/nadia-voice-agent
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in LiveKit, CRM, OpenAI, Uplift values
python src/agent.py dev   # LiveKit Agents CLI dev mode — connects to a test room
```

Test path before Telecard's trunk arrives: use LiveKit's web/mobile
Playground (or Meet sample app) to join the same room as a browser
participant and talk to the agent directly — validates the STT → LLM →
TTS loop (including real Uplift AI audio) without needing telephony at all.
This is the point where you'll actually hear the `helpdesk-agent` voice
and can judge whether it sounds right for your callers.
