"""
Nadia — self-hosted LiveKit voice agent for the Pakistani market.

Pipeline: SIP call (Telecard trunk) -> LiveKit room -> Silero VAD (turn-taking)
-> self-hosted Whisper STT (Urdu/Minglish) -> gpt-4o-mini (brain) ->
Uplift AI TTS ("helpdesk-agent" voice) -> back down the same SIP call.

Entrypoint pattern and Uplift AI wiring below are copied from Uplift AI's
own verified tutorial (docs.upliftai.org/tutorials/livekit-voice-agent,
checked 2026-07-12) — that part should work as-is once dependencies are
installed. The self-hosted Whisper STT (stt_node override, in
stt_whisper.py) is NOT from that tutorial and is untested — Uplift's own
example uses OpenAI's hosted STT instead, since Uplift has no STT product
of its own for Urdu. We're using self-hosted Whisper here because you
specifically want an open-source STT with no per-call fee.

Verified 2026-07-12 against livekit-agents==1.5.1 installed locally:
  - AgentSession(stt=...) defaults to NOT_GIVEN — fine to omit.
  - Agent.default.stt_node() asserts `activity.stt is not None`, so it
    CANNOT be delegated to when no session-level STT is configured (it
    would crash immediately). stt_node below drives Silero VAD directly
    instead — confirmed VADEvent.frames on END_OF_SPEECH contains the
    full buffered utterance audio (livekit/plugins/silero/vad.py).

Remaining TODOs before a real call:
  1. Get an API key at https://platform.upliftai.org/studio/home (free
     Urdu testing plan) and set UPLIFTAI_API_KEY in .env.
  2. Point CRM_API_BASE_URL / LIVEKIT_INGEST_SECRET at a real CRM instance.
  3. Once Telecard hands over trunk credentials, follow README "SIP wiring".
"""

import asyncio
import json
import os

from dotenv import load_dotenv
from livekit import agents, rtc
from livekit.agents import (
    Agent,
    AgentSession,
    BackgroundAudioPlayer,
    ModelSettings,
    RoomInputOptions,
    RunContext,
    function_tool,
    vad,
)
from livekit.plugins import openai, silero, upliftai

from audio_speed import time_stretch
from config import AgentSettings, build_system_prompt, load_settings
from crm_client import get_client
from stt_whisper import WhisperSTT
from recording import start_recording, CONSENT_LINE_UR

load_dotenv()

# Direct file logging — stdout capture of this long-running process keeps
# going stale in the dev environment, leaving call sessions undiagnosable.
# This appends straight to a file with an immediate flush, bypassing stdout.
_DEBUG_LOG_PATH = os.environ.get("NADIA_DEBUG_LOG", "/tmp/nadia_debug.log")

def dbg(msg: str) -> None:
    try:
        from datetime import datetime
        with open(_DEBUG_LOG_PATH, "a") as f:
            f.write(f"{datetime.now().isoformat(timespec='seconds')} {msg}\n")
    except Exception:
        pass



# Played (non-blocking) while raise_ticket's ~2s API call is in flight, so the
# caller hears something instead of dead air. Requested 2026-07-13, built 2026-07-17.
# Spoken the instant ticket creation starts, per user wording request
# 2026-07-19: "please wait while I create the ticket".
HOLD_LINE = "براہ کرم انتظار کریں، میں آپ کا ٹکٹ بنا رہی ہوں۔"


class NadiaAgent(Agent):
    def __init__(self, settings: AgentSettings, tenant_id: str, call_id: str):
        super().__init__(instructions=build_system_prompt(settings))
        self.settings = settings
        self.tenant_id = tenant_id
        self.call_id = call_id
        # Branded hold audio — set by the entrypoint after session start when
        # the tenant has an uploaded clip; raise_ticket plays it while the
        # CRM round-trip is in flight (instead of the spoken hold line) and
        # stops it the instant the result is back.
        self.bg_audio = None
        self.hold_audio_path: str | None = None
        # STT_PROVIDER=openai → hosted transcription via the session-level
        # openai.STT (fast, ~$0.006/min) — required on small CPU hosts like
        # Railway, where local Whisper maxes the CPU and the job process gets
        # OOM-killed mid-call (seen live 2026-07-14: exit -9, load 0.98,
        # VAD 4.4s behind realtime). STT_PROVIDER=whisper (default) → free
        # self-hosted Whisper, for when this runs on real hardware (the
        # Telecard GPU box).
        self.stt_provider = os.environ.get("STT_PROVIDER", "whisper").lower()
        if self.stt_provider == "whisper":
            self.whisper = WhisperSTT(language_hint=settings.stt_language_hint)
        # min_silence_duration default is 0.55s — how long the caller must
        # be quiet before we decide they're done talking and start
        # responding. Lowered to reduce the reply pause; if this starts
        # cutting callers off mid-sentence (they pause briefly mid-thought),
        # raise it back up.
        self._vad = silero.VAD.load(min_silence_duration=0.3)

    # ── Custom STT: drive Silero VAD directly, buffer until the caller ──
    # ── stops talking, then run one batch Whisper pass over the utterance.
    # Whisper is non-streaming, so this is the standard wrap pattern for
    # batch ASR (see stt_whisper.py docstring for the latency trade-off).
    # NOTE: does not delegate to Agent.default.stt_node — see module
    # docstring for why that would crash with no session-level STT.
    async def stt_node(self, audio, model_settings: ModelSettings):
        if self.stt_provider == "openai":
            # Delegate to the default pipeline, which uses the session-level
            # openai.STT — safe here because entrypoint always passes stt=.
            dbg("stt_node: delegating to hosted openai STT")
            async for ev in Agent.default.stt_node(self, audio, model_settings):
                yield ev
            return

        dbg("stt_node started")
        vad_stream = self._vad.stream()
        frame_count = 0

        async def _forward_audio() -> None:
            nonlocal frame_count
            async for frame in audio:
                frame_count += 1
                vad_stream.push_frame(frame)
            vad_stream.end_input()
            dbg(f"stt_node: audio ended, {frame_count} frames")

        forward_task = asyncio.create_task(_forward_audio())
        try:
            async for ev in vad_stream:
                pass  # vad event (too chatty for the debug log)
                if ev.type == vad.VADEventType.END_OF_SPEECH:
                    dbg(f"whisper on {len(ev.frames)} frame(s)")
                    result = self.whisper.transcribe(ev.frames)
                    dbg(f"whisper result: {result.alternatives[0].text if result else None}")
                    if result:
                        yield result
        except Exception as e:
            dbg(f"stt_node CRASHED: {type(e).__name__}: {e}")
            raise
        finally:
            forward_task.cancel()
            await vad_stream.aclose()

    # ── Speed control for Uplift TTS output ──────────────────────────
    # Uplift has no speed/rate parameter in their API (checked REST +
    # WebSocket docs) — this applies time-stretch (pitch preserved)
    # ourselves via ffmpeg after their audio comes back.
    #
    # TRADE-OFF: unlike the default pass-through, this buffers the WHOLE
    # reply's audio before playing any of it (atempo needs a contiguous
    # clip — stretching tiny fragments causes clicking). At rate=1.0
    # (the default) this is skipped entirely so normal calls pay no
    # latency penalty; only tenants who explicitly set a non-default
    # speaking_rate trade some responsiveness for that control.
    async def tts_node(self, text, model_settings: ModelSettings):
        rate = self.settings.speaking_rate
        if abs(rate - 1.0) < 0.01:
            async for frame in Agent.default.tts_node(self, text, model_settings):
                yield frame
            return

        frames = [f async for f in Agent.default.tts_node(self, text, model_settings)]
        for f in await time_stretch(frames, rate):
            yield f

    # ── Tool the LLM calls the moment the caller shares ANY ONE of phone/ ──
    # ── NIC/email, so returning callers can be recognised without having ──
    # ── to repeat everything, while still confirming it's really them. ──
    @function_tool()
    async def identify_caller(
        self,
        context: RunContext,
        phone: str | None = None,
        nic: str | None = None,
        email: str | None = None,
    ) -> str:
        """Call this the moment the caller shares their phone number, NIC
        (national ID), or email — even before you know why they're calling.
        Looks up whether they're an existing contact.

        If this comes back "confirmed" (two of phone/NIC/email matched
        together), you may greet them by name and proceed normally — no
        need to ask further questions to verify identity.

        If it comes back "unconfirmed" (only the one detail they gave
        matched), read back the first name and explicitly ask them to
        confirm it's them (e.g. "I have a record under the name X — is
        that you?") BEFORE relying on any of their account details. If they
        say no, treat them as a new/different caller.

        If it comes back "no record", just continue the conversation
        normally — there's nothing to confirm.

        Args:
            phone: Caller's phone number, if they've given it.
            nic: Caller's CNIC / national ID number, if they've given it.
            email: Caller's email address, if they've given it.
        """
        result = await get_client().lookup_contact(self.tenant_id, phone, nic, email)
        if not result.get("found"):
            return "No record found — continue normally."
        name = result.get("firstName") or "the caller"
        if result.get("confidence") == "strong":
            return f"Confirmed match: {name}. You may greet them by name and proceed."
        return (
            f"Possible match: {name} — but only one detail matched, not confirmed. "
            f"Ask the caller to confirm: \"I have a record under the name {name}, is that you?\" "
            "Do not rely on this being them until they confirm."
        )

    # ── Tool the LLM calls to check the tenant's knowledge base before ──
    # ── assuming something needs a ticket (e.g. branch hours, policies) ──
    @function_tool()
    async def check_knowledge_base(self, context: RunContext, question: str) -> str:
        """Check the business's own reference material for a direct answer
        before raising a ticket — e.g. branch hours, standard policies,
        published timelines. Call this whenever the caller asks something
        that sounds like a general question rather than their own personal
        complaint. If this returns no match, proceed normally (collect
        details and raise a ticket as usual).

        Args:
            question: The caller's question, in your own words.
        """
        data = await get_client().search_knowledge_base(self.tenant_id, question)
        if not data:
            return "No match found — continue normally."
        return f"Found in knowledge base: {data['content']}"

    # ── Tool the LLM calls once it has enough info to raise a ticket ──
    @function_tool()
    async def raise_ticket(
        self,
        context: RunContext,
        reporter_name: str,
        reporter_phone: str,
        category: str,
        priority: str,
        subject: str,
        description: str,
        fraud_amount: str | None = None,
        reporter_email: str | None = None,
        reporter_nic: str | None = None,
        reporter_address: str | None = None,
        reporter_city: str | None = None,
    ) -> str:
        """Create a support ticket in the CRM once the caller's complaint
        details have been collected. Call this exactly once per complaint
        (call it again for a genuinely separate additional complaint in the
        same call), as soon as you have name, phone, category, priority, and
        a subject. Read back the real ticket number this returns — never
        invent one yourself.

        Whatever contact details the caller shares during the conversation —
        even in passing, not just when directly asked — should be passed
        through here so their CRM record stays complete for next time.

        Args:
            reporter_name: Caller's full name.
            reporter_phone: Caller's contact number.
            category: One of loan_issue, account_issue, staff_complaint,
                digital_banking, fraud, branch_service, other.
            priority: One of urgent, high, medium, low (maps to P1-P4).
            subject: One-line summary of the issue.
            description: Fuller description of what the caller reported.
            fraud_amount: Amount involved, only for category=fraud. Omit
                otherwise.
            reporter_email: Caller's email address, if they gave one.
            reporter_nic: Caller's CNIC / National ID number, if they gave one.
            reporter_address: Caller's street/house address, if they gave one.
            reporter_city: Caller's city, if they gave one.
        """
        # Fire-and-forget — don't await, so this plays WHILE the API call below is in
        # flight, not before it. allow_interruptions=False so a caller talking over
        # it (common — they're often still adding detail) doesn't cut it short or
        # confuse the turn-taking state.
        hold_handle = None
        if self.bg_audio is not None and self.hold_audio_path:
            # Branded hold clip (e.g. the client's product jingle) — played
            # while the CRM call is in flight, stopped the moment it's done
            # so the reply isn't spoken over the music.
            try:
                hold_handle = self.bg_audio.play(self.hold_audio_path)
            except Exception:
                hold_handle = None
        if hold_handle is None:
            context.session.say(self.settings.hold_message or HOLD_LINE, allow_interruptions=False)

        try:
            data = await get_client().create_ticket(
                self.tenant_id, self.call_id,
                {
                    "reporterName": reporter_name,
                    "reporterPhone": reporter_phone,
                    "category": category,
                    "priority": priority,
                    "subject": subject,
                    "description": description,
                    "fraudAmount": fraud_amount,
                    "reporterEmail": reporter_email,
                    "reporterNic": reporter_nic,
                    "reporterAddress": reporter_address,
                    "reporterCity": reporter_city,
                },
            )
        finally:
            if hold_handle is not None:
                hold_handle.stop()
        return f"Ticket {data['ticketNumber']} created."


def _extract_tenant_id(raw: str) -> str:
    """Pull the tenant UUID out of the job metadata.

    The metadata arrives one of two ways:
      • a bare tenant-id string (SIP dispatch rules / CRM_TENANT_ID env), or
      • a JSON blob like {"tenantId": "...", "startedBy": "...", "source": "..."}
        (the CRM's browser test-call + web-call endpoints wrap it this way).
    Treating the whole JSON blob as the tenant id made the CRM return 500 on
    every ticket create (seen live 2026-07-14) — so parse it defensively.
    """
    raw = (raw or "").strip()
    if raw.startswith("{"):
        try:
            obj = json.loads(raw)
            return str(obj.get("tenantId") or obj.get("tenant_id") or "").strip()
        except (ValueError, TypeError):
            return ""
    return raw


async def entrypoint(ctx: agents.JobContext) -> None:
    # Dispatch rules should attach tenant_id in room/participant metadata —
    # see README "SIP wiring" for how the trunk -> dispatch rule -> room
    # naming convention carries this through.
    tenant_id = _extract_tenant_id(ctx.job.metadata or "") or os.environ.get("CRM_TENANT_ID", "")
    call_id = ctx.room.name
    dbg(f"entrypoint start room={call_id} tenant={tenant_id[:8]}")

    settings = await load_settings(tenant_id)
    dbg(f"settings loaded bot={settings.bot_name} voice={settings.voice_id} rate={settings.speaking_rate}")
    nadia = NadiaAgent(settings=settings, tenant_id=tenant_id, call_id=call_id)
    dbg("NadiaAgent constructed")

    tts = upliftai.TTS(
        voice_id=settings.voice_id,
        output_format=os.environ.get("UPLIFT_OUTPUT_FORMAT", "MP3_22050_128"),
    )

    # How long the caller can be silent before Nadia checks if they're still
    # there. Default 8s — 3s (as first suggested) fires during normal thinking
    # pauses and interrupts real callers, so it's a tunable env var.
    silence_sec = float(os.environ.get("SILENCE_NUDGE_SEC", "8"))

    session = AgentSession(
        llm=openai.LLM(model=settings.llm_model),
        tts=tts,
        vad=silero.VAD.load(min_silence_duration=0.3),
        # After this many seconds with no caller speech, the session fires a
        # user_state_changed → "away" event, which drives the nudge sequence.
        user_away_timeout=silence_sec,
        # AgentActivity only wires up a custom stt_node override when
        # `self.stt` is truthy (agent_activity.py: `stt=self._agent.stt_node
        # if self.stt else None`) — confirmed by tracing a live session where
        # our stt_node never fired with stt= omitted. This placeholder is
        # never actually called (NadiaAgent.stt_node fully replaces its
        # behavior); it only needs to exist to pass that truthy check.
        stt=openai.STT(model="gpt-4o-mini-transcribe"),
    )

    # ── Silence handling ──────────────────────────────────────────────────
    # If the caller goes quiet, Nadia asks twice whether they're still on the
    # line, then politely ends the call — instead of holding an open line to
    # silence until the hard max-duration cutoff.
    NUDGE_LINE = "کیا آپ لائن پر موجود ہیں؟"
    SILENCE_BYE = "میں اب کال ختم کر رہی ہوں، اللہ حافظ۔"
    nudge_task: dict[str, object] = {"t": None}

    async def _silence_sequence() -> None:
        try:
            for _ in range(2):  # ask twice
                await session.say(NUDGE_LINE)
                await asyncio.sleep(silence_sec)  # cancelled if caller speaks
            # Still silent after two prompts — say goodbye and end the call.
            await session.say(SILENCE_BYE)
            dbg("caller silent after 2 nudges — ending call")
            ctx.shutdown(reason="caller_silent")
        except asyncio.CancelledError:
            dbg("caller responded — silence sequence cancelled")

    @session.on("user_state_changed")
    def _on_user_state(ev) -> None:
        new_state = getattr(ev, "new_state", None)
        t = nudge_task["t"]
        if new_state == "away" and (t is None or t.done()):
            nudge_task["t"] = asyncio.create_task(_silence_sequence())
        elif new_state == "speaking" and t is not None and not t.done():
            t.cancel()  # caller came back — stop nudging

    transcript_parts: list[str] = []

    @session.on("conversation_item_added")
    def _on_item(ev) -> None:
        # ev is a ConversationItemAddedEvent; the actual ChatMessage is ev.item.
        item = getattr(ev, "item", None)
        text = getattr(item, "text_content", None) if item else None
        if text:
            role = getattr(item, "role", "") or ""
            speaker = "Caller" if role == "user" else "Nadia" if role == "assistant" else role
            transcript_parts.append(f"{speaker}: {text}" if speaker else text)
            dbg(f"conversation item [{role}]: {str(text)[:80]}")

    @session.on("error")
    def _on_error(ev) -> None:
        dbg(f"SESSION ERROR: {getattr(ev, 'error', ev)}")

    # Filled in below if call recording is enabled + storage is configured.
    recording = {"url": None}

    async def _report_call_ended() -> None:
        try:
            await get_client().call_ended(
                tenant_id, call_id, "\n".join(transcript_parts), recording["url"],
            )
            dbg("call-ended report sent")
        except Exception as e:
            dbg(f"call-ended report FAILED: {type(e).__name__}: {e}")

    # Register the coroutine itself (not a fire-and-forget task) so LiveKit
    # awaits it during shutdown — otherwise the final transcript can be lost
    # when the process exits before the request finishes.
    ctx.add_shutdown_callback(_report_call_ended)

    # Hard cap on call length. The setting existed but nothing enforced it —
    # on a real phone line a silent/stuck caller would otherwise run forever,
    # burning LLM + TTS + telco minutes. Browser tests never hit this (you
    # just close the tab), which is why it went unnoticed.
    async def _enforce_max_duration() -> None:
        try:
            await asyncio.sleep(max(30, settings.max_call_duration_sec))
            dbg(f"max call duration {settings.max_call_duration_sec}s reached — ending call")
            ctx.shutdown(reason="max_call_duration_reached")
        except asyncio.CancelledError:
            pass

    duration_guard = asyncio.create_task(_enforce_max_duration())

    try:
        await session.start(
            room=ctx.room,
            agent=nadia,
            room_input_options=RoomInputOptions(),
        )
        dbg("session started")

        # On a real inbound SIP call the caller's audio path may not be fully
        # negotiated the instant the worker starts — greeting immediately means
        # the caller misses the first line (dead air / "hello? …hello?"). Wait
        # for the caller to actually be present first. Browser test calls are
        # already connected, so this returns almost instantly there.
        caller_participant = None
        try:
            caller_participant = await asyncio.wait_for(ctx.wait_for_participant(), timeout=20)
            dbg("caller present — greeting now")
        except asyncio.TimeoutError:
            dbg("no caller within 20s — greeting anyway")

        async def _handoff_to_human(subject: str, description: str) -> None:
            """Used when Nadia can't take a call herself (minutes exhausted or
            over capacity). Always raises an urgent ticket FIRST with the full
            transcript-so-far and a plain-language reason, so whoever picks up
            the call already has the caller's context and doesn't have to ask
            them to repeat themselves — that's the "warm" part. Then, only if
            this tenant has a confirmed human_transfer_destination configured,
            actually moves the live call there (a real SIP transfer, so the
            caller is connected to a person immediately instead of waiting for
            a callback). If no destination is configured yet, or the transfer
            itself fails, falls back to the original behaviour: apologise and
            end the call, relying on the ticket for the follow-up.
            """
            try:
                await get_client().create_ticket(
                    tenant_id, call_id,
                    {
                        "priority": "urgent",
                        "category": "other",
                        "subject": subject,
                        "description": (
                            description + "\n\nConversation so far:\n" + "\n".join(transcript_parts)
                            if transcript_parts else description
                        ),
                    },
                )
            except Exception as e:
                dbg(f"handoff ticket creation FAILED: {type(e).__name__}: {e}")

            destination = (settings.human_transfer_destination or "").strip()
            if destination and caller_participant is not None:
                await session.say(
                    "ایک لمحہ رکیں، میں آپ کو ابھی ہماری ٹیم کے نمائندے سے ملا رہی ہوں۔"
                )
                try:
                    await ctx.transfer_sip_participant(caller_participant, destination)
                    dbg(f"live transfer to {destination} succeeded")
                    duration_guard.cancel()
                    ctx.shutdown(reason="transferred_to_human")
                    return
                except Exception as e:
                    dbg(f"live transfer to {destination} FAILED, falling back: {type(e).__name__}: {e}")

            await session.say(
                "معذرت، اس وقت ہماری وائس لائن دستیاب نہیں ہے۔ "
                "ہماری ٹیم کا ایک نمائندہ جلد آپ سے رابطہ کرے گا۔ شکریہ، اللہ حافظ۔"
            )
            duration_guard.cancel()
            ctx.shutdown(reason="handoff_fallback")

        # Concurrency gate — register this call and find out, in the same
        # round trip, whether this tenant's own fairness cap or the whole
        # VPS's hardware capacity is already full. Checked BEFORE the
        # minutes gate: if there's no room to run the call at all, there's
        # no point spending a minutes-status lookup on it.
        try:
            concurrency = await get_client().call_started(tenant_id, call_id)
        except Exception as e:
            dbg(f"call-started/concurrency check FAILED (continuing call): {type(e).__name__}: {e}")
            concurrency = {"overCapacity": False}

        if concurrency.get("overCapacity"):
            dbg(f"over capacity ({concurrency.get('reason')}) — handing off to a human")
            await _handoff_to_human(
                subject="Caller could not be served — voice bot at capacity",
                description="This caller reached the voice line while this workspace (or the shared "
                            "server) was already at its concurrent-call limit.",
            )
            return

        # Minutes gate — checked once per call, right after the caller is
        # actually connected. If this tenant has used up its allocated
        # minutes, Nadia does not run her normal flow at all: she explains
        # a representative will follow up, raises an urgent ticket so a
        # human actually does, and ends the call. (This is a ticket-based
        # follow-up, not a live phone transfer — real live transfer to an
        # available agent is a separate, not-yet-built feature.)
        try:
            status = await get_client().get_minutes_status(tenant_id)
        except Exception as e:
            dbg(f"minutes-status check FAILED (continuing call): {type(e).__name__}: {e}")
            status = {"exhausted": False}

        if status.get("exhausted"):
            dbg("minutes exhausted — handing off to a human")
            await _handoff_to_human(
                subject="Caller could not be served — voice bot minutes exhausted",
                description="This caller reached the voice line after this workspace's allocated "
                            "Voice Bot minutes ran out.",
            )
            return

        # Branded hold audio: if this tenant uploaded a clip, fetch it once
        # and stand up a background player so raise_ticket can play it while
        # the CRM round-trip runs (stopped the instant the result is back).
        # Any failure here just means the spoken hold line is used instead —
        # never breaks the call.
        if settings.hold_audio_filename:
            try:
                audio_bytes = await get_client().get_hold_audio(tenant_id)
                if audio_bytes:
                    ext = os.path.splitext(settings.hold_audio_filename)[1] or ".mp3"
                    hold_path = f"/tmp/nadia_hold_{tenant_id[:8]}{ext}"
                    with open(hold_path, "wb") as f:
                        f.write(audio_bytes)
                    bg_audio = BackgroundAudioPlayer()
                    await bg_audio.start(room=ctx.room, agent_session=session)
                    nadia.bg_audio = bg_audio
                    nadia.hold_audio_path = hold_path
                    dbg(f"hold audio ready ({len(audio_bytes)} bytes)")
            except Exception as e:
                dbg(f"hold audio setup FAILED (using spoken hold line): {type(e).__name__}: {e}")

        # If recording is enabled AND storage is configured, start the audio
        # egress first (so the consent notice itself is captured), then say the
        # consent line before greeting. If storage isn't set up, start_recording
        # returns (None, None) and we skip both — a missing bucket must never
        # break a live call, and we never claim to record when we aren't.
        if settings.recording_enabled:
            try:
                egress_id, rec_url = await start_recording(call_id, tenant_id)
                if egress_id:
                    recording["url"] = rec_url
                    dbg(f"recording started egress={egress_id} url={rec_url}")
                    await session.say(CONSENT_LINE_UR)
                else:
                    dbg("recording enabled but storage not configured — skipping")
            except Exception as e:
                dbg(f"recording start FAILED (continuing call): {type(e).__name__}: {e}")

        if settings.greeting_message:
            await session.generate_reply(instructions=f"Greet the caller with: {settings.greeting_message}")
        else:
            # No per-tenant override — follow the greeting already specified in
            # the system prompt's "Call structure" step 1 (see prompts.py for
            # HBL MFB's exact wording).
            await session.generate_reply(instructions="Greet the caller now, following your instructions.")
        dbg("greeting dispatched")
    except Exception as e:
        dbg(f"ENTRYPOINT CRASHED: {type(e).__name__}: {e}")
        duration_guard.cancel()
        raise


if __name__ == "__main__":
    agents.cli.run_app(agents.WorkerOptions(
        entrypoint_fnc=entrypoint,
        agent_name=os.environ.get("LIVEKIT_AGENT_NAME", "nadia"),
        initialize_process_timeout=60,
        # Hardware-based ceiling: LiveKit measures this process's CPU load
        # and stops accepting new jobs once it crosses this fraction, so a
        # burst of calls can't pile up past what the box can actually run.
        # The exact number of calls this maps to depends on the VPS size
        # (see the hardware sizing table shared with the tenant/ops team);
        # the deterministic per-call NADIA_GLOBAL_MAX_CONCURRENT_CALLS cap
        # (enforced in call-started) is the number to tune per box.
        load_threshold=float(os.environ.get("NADIA_LOAD_THRESHOLD", "0.75")),
    ))
