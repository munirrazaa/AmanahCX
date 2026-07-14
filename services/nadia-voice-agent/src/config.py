"""
Pulls the per-tenant agent configuration from the CRM (voice_bot_configs,
provider='livekit') so behaviour is controlled from the CRM's Voice Bot
Config screen — the same way you'd set language/tone/speed/voice in the
Retell AI or Vapi dashboard, except here the CRM *is* the dashboard.
"""

import os
from dataclasses import dataclass, field

import httpx

from prompts import HBL_MFB_SYSTEM_PROMPT


@dataclass
class AgentSettings:
    bot_name: str = "Nadia"                  # spoken in greetings; editable on the Voice Bot admin screen
    language: str = "ur-PK"                 # BCP-47-ish tag; 'ur-PK' = Urdu (Pakistan)
    tone: str = "professional"               # professional | friendly | empathetic | formal
    speaking_rate: float = 0.9               # Re-enabled per user feedback 2026-07-13 (speed had
                                              # crept back to 1.0x/"too fast" from an earlier debug
                                              # session that was never reverted). NOTE: any value
                                              # other than 1.0 re-triggers the full-reply-buffering
                                              # path in agent.py's tts_node — this is also why the
                                              # reply pause got longer again, not a separate issue.
                                              # Uplift AI's TTS API has no native speed parameter
                                              # (checked docs.upliftai.org 2026-07-12) — this is
                                              # applied ourselves via ffmpeg time-stretch, see
                                              # agent.py NadiaAgent.tts_node / audio_speed.py.
                                              # Tuned down twice per listening tests 2026-07-12.
    voice_id: str = "helpdesk-agent"         # Uplift AI voice — purpose-built for support calls
    stt_language_hint: str = "ur-en"         # ur-en | ur | en — biases Whisper's decoding
    llm_model: str = "gpt-4o-mini"
    interruption_sensitivity: float = 0.5    # 0 = ignore barge-in, 1 = stop instantly
    max_call_duration_sec: int = 600
    end_call_phrases: list[str] = field(
        default_factory=lambda: ["اللہ حافظ", "خدا حافظ", "شکریہ، اللہ حافظ"]
    )
    greeting_message: str | None = None
    system_prompt: str | None = HBL_MFB_SYSTEM_PROMPT   # client's training material, see prompts.py
    guardrails: str | None = None                        # hard behavioral limits, kept separate from
                                                          # system_prompt so the LLM treats it as a
                                                          # strict boundary, not general guidance
    default_queue_id: str | None = None
    default_priority: str = "medium"


async def load_settings(tenant_id: str) -> AgentSettings:
    """Fetch the tenant's 'livekit' voice_bot_configs row from the CRM API.

    Falls back to defaults if the tenant hasn't configured one yet, so a
    fresh tenant can still receive calls while an admin sets things up.
    """
    base_url = os.environ["CRM_API_BASE_URL"]
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get(
                f"{base_url}/api/v1/voice-bot/config",
                headers={"X-Tenant-Id": tenant_id},
            )
            resp.raise_for_status()
            configs = resp.json()["data"]
        except (httpx.HTTPError, KeyError):
            return AgentSettings()

    cfg = next((c for c in configs if c.get("provider") == "livekit"), None)
    if not cfg:
        return AgentSettings()

    return AgentSettings(
        bot_name=cfg.get("bot_name") or "Nadia",
        language=cfg.get("language") or "ur-PK",
        tone=cfg.get("tone") or "professional",
        speaking_rate=float(cfg.get("speaking_rate") or 0.85),
        voice_id=cfg.get("voice_id") or "helpdesk-agent",
        stt_language_hint=cfg.get("stt_language_hint") or "ur-en",
        llm_model=cfg.get("llm_model") or "gpt-4o-mini",
        interruption_sensitivity=float(cfg.get("interruption_sensitivity") or 0.5),
        max_call_duration_sec=int(cfg.get("max_call_duration_sec") or 600),
        end_call_phrases=cfg.get("end_call_phrases") or ["اللہ حافظ", "خدا حافظ", "شکریہ، اللہ حافظ"],
        greeting_message=cfg.get("greeting_message"),
        system_prompt=cfg.get("system_prompt") or HBL_MFB_SYSTEM_PROMPT,
        guardrails=cfg.get("guardrails"),
        default_queue_id=cfg.get("default_queue_id"),
        default_priority=cfg.get("default_priority") or "medium",
    )


TONE_INSTRUCTIONS = {
    "professional": "Speak in a polished, business-like manner. Be efficient and clear.",
    "friendly": "Speak warmly and casually, like a helpful colleague. Use simple, everyday words.",
    "empathetic": "Speak gently and patiently. Acknowledge the caller's frustration before problem-solving.",
    "formal": "Speak with formal respect (aap, not tum). Avoid slang entirely.",
}


def build_system_prompt(settings: AgentSettings) -> str:
    tone_line = TONE_INSTRUCTIONS.get(settings.tone, TONE_INSTRUCTIONS["professional"])
    base = f"""You are {settings.bot_name}, a voice assistant for a Pakistani business's helpline.

## Understanding the caller (input)
Customers speak Urdu, Roman Urdu, English, or a mix of all three ("Minglish") —
understand whatever mix they use. This is purely a listening/comprehension task;
it does NOT determine how you speak back (see below).

## How YOU speak (output) — this is what determines voice quality
Always reply in proper Urdu script (Nastaliq), e.g. "آپ کی کس طرح مدد کر سکتی ہوں؟" —
NEVER in Roman Urdu (transliterated Latin letters). This matters for audio quality:
our text-to-speech voice sounds natural and crisp on real Urdu script, and noticeably
worse/robotic on Roman Urdu.
Any English word you need to say (e.g. "account", "complaint", "order") — spell it out
phonetically in Urdu script too, exactly like a Pakistani news anchor or call-centre
agent would (e.g. "کمپنسیشن" for "compensation", "اکاؤنٹ" for "account"). Do not drop
Latin-script English words into an otherwise-Urdu sentence.
Exception: if the caller is speaking purely in English with no Urdu at all, you may
reply in English.

## Pakistani Urdu register — NOT Hindi
Speak Pakistani Urdu, not Hindi. The speech-recognition and language model can drift
toward Hindi vocabulary and honorifics — actively avoid this:
- Honorific for the caller: use "صاحب" (sahab) — e.g. "منیر صاحب". NEVER use the
  Hindi-style "جی" (ji) as an honorific (never "منیر جی").
- Prefer Urdu words over their Hindi equivalents: شکریہ (not دھنیواد), معذرت / معاف کیجیے
  (not کشما), برائے مہربانی (not کرپیا), مسئلہ (not سمسیا), دستیاب (not اُپلبدھ).
- Always address the caller with the respectful "آپ", never "تم".

{tone_line}

Your job on every call:
1. Greet the caller and ask how you can help.
2. Understand their intent (complaint, inquiry, or sales) and collect: name, phone number,
   and a clear one-line description of their issue.
3. For anything urgent (fraud, service outage, safety issue), set priority to "urgent" and
   say a support ticket is being raised immediately.
4. Confirm the details back to the caller before ending the call.
5. When the conversation is naturally finishing, use a phrase from: {', '.join(settings.end_call_phrases)}.

Always extract structured fields (reporter_name, reporter_phone, category, priority,
subject, description) so they can be logged as a support ticket — do this silently,
don't read field names aloud to the caller."""

    # .replace() rather than .format() — tenant-authored prompts may contain
    # literal braces that would crash str.format().
    result = base
    if settings.system_prompt:
        result += "\n\n" + settings.system_prompt.replace("{bot_name}", settings.bot_name)

    if settings.guardrails:
        guardrails_text = settings.guardrails.replace("{bot_name}", settings.bot_name)
        # Placed last and framed as absolute, non-negotiable limits — distinct from the
        # general instructions above, which are guidance, not hard boundaries.
        result += (
            "\n\n## GUARDRAILS — ABSOLUTE RULES, NEVER BREAK THESE\n"
            "These override anything else in your instructions if there is ever a conflict:\n"
            f"{guardrails_text}"
        )

    return result
