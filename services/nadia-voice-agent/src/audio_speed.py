"""
Speed control for Uplift AI's TTS output.

Uplift has no speed/rate parameter in their API (checked both REST and
WebSocket docs, 2026-07-12) — this is confirmed missing, not something we
overlooked. This module fills the gap by time-stretching the audio they
return (changes speed, preserves pitch — unlike naive resampling, which
would make a sped-up voice sound like a chipmunk).

Requires `ffmpeg` on PATH. Present via Homebrew on this Mac; must also be
installed on whatever server Telecard hosts this on (e.g. `apt install
ffmpeg` on Debian/Ubuntu).
"""

import asyncio

from livekit import rtc

_FFMPEG_ATEMPO_MIN = 0.5
_FFMPEG_ATEMPO_MAX = 2.0


async def time_stretch(frames: list[rtc.AudioFrame], rate: float) -> list[rtc.AudioFrame]:
    """Speeds up/slows down buffered PCM16 audio frames via ffmpeg's atempo
    filter. `rate` is clamped to [0.5, 2.0] — ffmpeg's atempo supports that
    range in one pass, matching our own config's speaking_rate bounds."""

    if not frames:
        return frames

    rate = max(_FFMPEG_ATEMPO_MIN, min(_FFMPEG_ATEMPO_MAX, rate))
    sample_rate = frames[0].sample_rate
    num_channels = frames[0].num_channels
    pcm_in = b"".join(bytes(f.data) for f in frames)

    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-hide_banner", "-loglevel", "error",
        "-f", "s16le", "-ar", str(sample_rate), "-ac", str(num_channels), "-i", "pipe:0",
        "-filter:a", f"atempo={rate}",
        "-f", "s16le", "-ar", str(sample_rate), "-ac", str(num_channels), "pipe:1",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    pcm_out, stderr = await proc.communicate(pcm_in)
    if proc.returncode != 0:
        # Fail open — return original audio rather than dropping the reply.
        print(f"[nadia] time_stretch ffmpeg failed: {stderr.decode(errors='replace')}", flush=True)
        return frames

    frame_size = int(sample_rate * 0.02) * 2 * num_channels  # 20ms frames, int16
    out_frames = []
    for i in range(0, len(pcm_out), frame_size):
        chunk = pcm_out[i : i + frame_size]
        if not chunk:
            continue
        out_frames.append(rtc.AudioFrame(
            data=chunk,
            sample_rate=sample_rate,
            num_channels=num_channels,
            samples_per_channel=len(chunk) // (2 * num_channels),
        ))
    return out_frames
