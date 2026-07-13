"""
Mints a LiveKit access token for the manual browser test page (index.html
in this folder). Not part of the production agent — just a quick way to
talk to Nadia without depending on LiveKit's dashboard Console UI.
"""

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from dotenv import load_dotenv
from livekit import api

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

# Unique per run so a stale reused identity/room never silently skips the
# greeting again (LiveKit treats a repeat identity as a reconnect, not a
# fresh join, so the agent won't re-greet).
suffix = str(int(time.time()))
room_name = f"nadia-webtest-{suffix}"
identity = f"browser-tester-{suffix}"

token = (
    api.AccessToken(os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"])
    .with_identity(identity)
    .with_name(identity)
    .with_grants(api.VideoGrants(room_join=True, room=room_name, can_publish=True, can_subscribe=True))
    .to_jwt()
)

print("LIVEKIT_URL:", os.environ["LIVEKIT_URL"])
print("ROOM:", room_name)
print("TOKEN:", token)
