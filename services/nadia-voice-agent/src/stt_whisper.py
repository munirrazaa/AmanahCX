"""
Self-hosted STT via faster-whisper, tuned for Urdu / Roman-Urdu / English
code-switching ("Minglish").

Whisper does batch (non-streaming) inference, so this wraps it in the
standard pattern for non-streaming ASR inside LiveKit Agents: buffer audio
frames until Silero VAD reports the caller stopped talking, then run one
Whisper pass over the whole utterance and emit a single FINAL_TRANSCRIPT
event. Latency is "wait for silence + ~300-800ms Whisper pass" rather than
true word-by-word streaming — acceptable for a ticket-taking IVR flow,
noticeably worse than a cloud streaming STT (e.g. Deepgram) for fast
back-and-forth conversation. Revisit if call transcripts show the pause
feels sluggish to callers.

NOTE ON VERSION DRIFT: verified the SpeechEvent/SpeechEventType shape
against docs.livekit.io on 2026-07-11 — the Agents SDK API moves fast.
If this errors on `stt.SpeechEvent(...)` construction, check the installed
`livekit-agents` version's `stt` module for the current signature.
"""

import io
import os
import wave

import numpy as np
from faster_whisper import WhisperModel
from livekit import rtc
from livekit.agents import stt

# "Minglish" prompt bias: Whisper has no dedicated code-switch mode, but an
# initial_prompt containing both scripts measurably nudges it to transcribe
# Roman-Urdu words as Roman-Urdu instead of forcing them into English.
_INITIAL_PROMPT = (
    "Yeh call ek Pakistani customer support helpline ki hai. "
    "Caller Urdu, Roman Urdu, ya English mein baat kar sakta hai. "
    "شکایت، اکاؤنٹ، بل، آرڈر، سروس"
)

_WHISPER_LANGUAGE = {"ur-en": None, "ur": "ur", "en": "en"}  # None = auto-detect per utterance


class WhisperSTT:
    """Not a full livekit.agents.stt.STT plugin — used from Agent.stt_node
    (see agent.py) to batch-transcribe one buffered utterance at a time."""

    def __init__(self, language_hint: str = "ur-en"):
        model_size = os.environ.get("WHISPER_MODEL_SIZE", "large-v3")
        device = os.environ.get("WHISPER_DEVICE", "cpu")
        compute_type = "float16" if device == "cuda" else "int8"
        self._model = WhisperModel(model_size, device=device, compute_type=compute_type)
        self._language = _WHISPER_LANGUAGE.get(language_hint)

    def transcribe(self, frames: list[rtc.AudioFrame]) -> stt.SpeechEvent | None:
        if not frames:
            return None

        pcm = _frames_to_wav_bytes(frames)
        segments, info = self._model.transcribe(
            pcm,
            language=self._language,
            initial_prompt=_INITIAL_PROMPT,
            vad_filter=False,  # LiveKit's Silero VAD already segmented this utterance
        )
        text = " ".join(seg.text.strip() for seg in segments).strip()
        if not text:
            return None

        return stt.SpeechEvent(
            type=stt.SpeechEventType.FINAL_TRANSCRIPT,
            alternatives=[stt.SpeechData(text=text, language=info.language)],
        )


def _frames_to_wav_bytes(frames: list[rtc.AudioFrame]) -> io.BytesIO:
    sample_rate = frames[0].sample_rate
    num_channels = frames[0].num_channels
    pcm = np.concatenate([np.frombuffer(f.data, dtype=np.int16) for f in frames])

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(num_channels)
        wf.setsampwidth(2)  # int16
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())
    buf.seek(0)
    return buf
