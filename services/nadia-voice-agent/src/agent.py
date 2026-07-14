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

import httpx
from dotenv import load_dotenv
from livekit import agents, rtc
from livekit.agents import (
    Agent,
    AgentSession,
    ModelSettings,
    RoomInputOptions,
    RunContext,
    function_tool,
    vad,
)
from livekit.plugins import openai, silero, upliftai

from audio_speed import time_stretch
from config import AgentSettings, build_system_prompt, load_settings
from stt_whisper import WhisperSTT

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


class NadiaAgent(Agent):
    def __init__(self, settings: AgentSettings, tenant_id: str, call_id: str):
        super().__init__(instructions=build_system_prompt(settings))
        self.settings = settings
        self.tenant_id = tenant_id
        self.call_id = call_id
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
    ) -> str:
        """Create a support ticket in the CRM once the caller's complaint
        details have been collected. Call this exactly once per complaint
        (call it again for a genuinely separate additional complaint in the
        same call), as soon as you have name, phone, category, priority, and
        a subject. Read back the real ticket number this returns — never
        invent one yourself.

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
        """
        base_url = os.environ["CRM_API_BASE_URL"]
        secret = os.environ.get("LIVEKIT_INGEST_SECRET", "")
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{base_url}/api/v1/voice-bot/livekit/complaint",
                params={"tenantId": self.tenant_id},
                headers={"Authorization": f"Bearer {secret}"} if secret else {},
                json={
                    "reporterName": reporter_name,
                    "reporterPhone": reporter_phone,
                    "category": category,
                    "priority": priority,
                    "subject": subject,
                    "description": description,
                    "fraudAmount": fraud_amount,
                    "callId": self.call_id,
                },
            )
            resp.raise_for_status()
            data = resp.json()
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
    def _on_item(item) -> None:
        text = getattr(item, "text_content", None) or getattr(item, "text", None)
        if text:
            transcript_parts.append(text)
            dbg(f"conversation item: {str(text)[:80]}")

    @session.on("error")
    def _on_error(ev) -> None:
        dbg(f"SESSION ERROR: {getattr(ev, 'error', ev)}")

    async def _report_call_ended() -> None:
        base_url = os.environ["CRM_API_BASE_URL"]
        secret = os.environ.get("LIVEKIT_INGEST_SECRET", "")
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    f"{base_url}/api/v1/voice-bot/livekit/call-ended",
                    params={"tenantId": tenant_id},
                    headers={"Authorization": f"Bearer {secret}"} if secret else {},
                    json={
                        "voiceCallId": call_id,
                        "transcript": "\n".join(transcript_parts),
                    },
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
        try:
            await asyncio.wait_for(ctx.wait_for_participant(), timeout=20)
            dbg("caller present — greeting now")
        except asyncio.TimeoutError:
            dbg("no caller within 20s — greeting anyway")

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
    ))
