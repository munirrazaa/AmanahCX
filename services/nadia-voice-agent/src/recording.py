"""
Optional call-audio recording to S3-compatible object storage.

Turned on per-tenant via the CRM Voice Bot settings (recording_enabled). When
on AND storage is configured via env, the agent records the room's audio and
saves a link back to the CRM. If storage is NOT configured, recording quietly
does nothing — a missing bucket must never break a live call.

Required env (any S3-compatible store — Vultr Object Storage, AWS S3, R2, …):
    RECORDING_S3_BUCKET        bucket name
    RECORDING_S3_REGION        region (e.g. "blr1", "us-east-1")
    RECORDING_S3_ENDPOINT      https endpoint (e.g. "https://blr1.vultrobjects.com")
    RECORDING_S3_ACCESS_KEY    access key
    RECORDING_S3_SECRET        secret key
    RECORDING_S3_PUBLIC_BASE   public URL base the saved file is reachable at
                               (e.g. "https://<bucket>.blr1.vultrobjects.com")
"""

import os

from livekit import api

# Spoken once, before the greeting, whenever a recording actually starts.
CONSENT_LINE_UR = "آپ کی کال معیار اور تربیت کے مقاصد کے لیے ریکارڈ کی جا رہی ہے۔"


def _s3_config() -> dict | None:
    keys = ["RECORDING_S3_BUCKET", "RECORDING_S3_ACCESS_KEY", "RECORDING_S3_SECRET"]
    if not all(os.environ.get(k) for k in keys):
        return None
    return {
        "bucket": os.environ["RECORDING_S3_BUCKET"],
        "region": os.environ.get("RECORDING_S3_REGION", ""),
        "endpoint": os.environ.get("RECORDING_S3_ENDPOINT", ""),
        "access_key": os.environ["RECORDING_S3_ACCESS_KEY"],
        "secret": os.environ["RECORDING_S3_SECRET"],
        "public_base": os.environ.get("RECORDING_S3_PUBLIC_BASE", "").rstrip("/"),
    }


async def start_recording(room_name: str, tenant_id: str) -> tuple[str | None, str | None]:
    """Start audio-only egress for the room. Returns (egress_id, public_url),
    or (None, None) if storage isn't configured or the start fails — the caller
    treats that as 'not recording' and skips the consent line.
    """
    cfg = _s3_config()
    if cfg is None:
        return None, None

    filepath = f"nadia-recordings/{tenant_id}/{room_name}.ogg"
    lkapi = api.LiveKitAPI(
        url=os.environ["LIVEKIT_URL"],
        api_key=os.environ["LIVEKIT_API_KEY"],
        api_secret=os.environ["LIVEKIT_API_SECRET"],
    )
    try:
        req = api.RoomCompositeEgressRequest(
            room_name=room_name,
            audio_only=True,
            file_outputs=[api.EncodedFileOutput(
                file_type=api.EncodedFileType.OGG,
                filepath=filepath,
                s3=api.S3Upload(
                    access_key=cfg["access_key"],
                    secret=cfg["secret"],
                    region=cfg["region"],
                    endpoint=cfg["endpoint"],
                    bucket=cfg["bucket"],
                    force_path_style=True,
                ),
            )],
        )
        info = await lkapi.egress.start_room_composite_egress(req)
        public_url = f"{cfg['public_base']}/{filepath}" if cfg["public_base"] else None
        return info.egress_id, public_url
    finally:
        await lkapi.aclose()
