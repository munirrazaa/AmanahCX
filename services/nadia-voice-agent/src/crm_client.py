"""
Nadia's CRM Connector Contract.

This is the ONE place Nadia talks to "the CRM." Every other file
(agent.py, config.py) calls functions on a CRMClient instance — none of
them build URLs, know route paths, or know auth headers for a specific
CRM's API. That means a different CRM (Salesforce, HubSpot, Microsoft
Dynamics, SugarCRM, etc.) can plug into Nadia by implementing the same
six operations below as its own webhook/API, not by touching Nadia's
voice/AI code at all.

Today there is exactly one connector: AmanahCXConnector, the reference
implementation this whole contract was extracted from. Adding a second
CRM means writing one new class with these same six methods and
registering it in get_client() — nothing else in this service changes.

The six operations, in plain terms:
  1. get_config          — fetch this tenant's bot settings before a call
  2. create_ticket        — file a complaint/case once details are collected
  3. search_knowledge_base — look up a general-question answer
  4. call_started          — register a call, learn if it's over capacity
  5. get_minutes_status    — learn if this tenant is out of allocated minutes
  6. call_ended            — report the final transcript/recording back
"""

from __future__ import annotations

import os
from typing import Any, Protocol

import httpx


class CRMConnector(Protocol):
    """The contract every CRM adapter must implement. Nadia's code only
    ever calls these six methods — never anything CRM-specific."""

    async def get_config(self, tenant_id: str) -> dict[str, Any] | None: ...

    async def create_ticket(self, tenant_id: str, call_id: str, ticket: dict[str, Any]) -> dict[str, Any]: ...

    async def search_knowledge_base(self, tenant_id: str, question: str) -> dict[str, Any] | None: ...

    async def lookup_contact(
        self, tenant_id: str, phone: str | None, nic: str | None, email: str | None,
    ) -> dict[str, Any]: ...

    async def get_hold_audio(self, tenant_id: str) -> bytes | None: ...

    async def call_started(self, tenant_id: str, call_id: str) -> dict[str, Any]: ...

    async def get_minutes_status(self, tenant_id: str) -> dict[str, Any]: ...

    async def call_ended(
        self, tenant_id: str, call_id: str, transcript: str, recording_url: str | None,
    ) -> None: ...


class AmanahCXConnector:
    """Reference connector — AmanahCX's own API. Every URL/auth quirk that
    used to be scattered across agent.py and config.py now lives only
    here. Behaviour is unchanged from before this refactor; this is a
    pure extraction, not a rewrite of how AmanahCX itself is called."""

    def __init__(self, base_url: str, ingest_secret: str) -> None:
        self.base_url = base_url.rstrip("/")
        self._secret = ingest_secret

    def _bearer(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._secret}"} if self._secret else {}

    async def get_config(self, tenant_id: str) -> dict[str, Any] | None:
        # Uses /livekit/config, NOT the tenant-side /config — that one sits
        # behind the global tenant-auth wall (requires a real logged-in
        # user) and silently rejected every call from here, meaning every
        # tenant's config was falling back to hardcoded defaults the whole
        # time this session. Fixed 2026-07-18 — see the route's own comment.
        async with httpx.AsyncClient(timeout=10) as client:
            try:
                resp = await client.get(
                    f"{self.base_url}/api/v1/voice-bot/livekit/config",
                    params={"tenantId": tenant_id},
                    headers=self._bearer(),
                )
                resp.raise_for_status()
                configs = resp.json()["data"]
            except (httpx.HTTPError, KeyError):
                return None
        return next((c for c in configs if c.get("provider") == "livekit"), None)

    async def create_ticket(self, tenant_id: str, call_id: str, ticket: dict[str, Any]) -> dict[str, Any]:
        # 20s (was 10s): production Railway→Supabase round-trips can spike past
        # 10s, and a client-side timeout here loses a ticket confirmation the
        # server actually completed — the caller then hears "it failed" for a
        # ticket that exists. Retries are idempotent server-side now (same
        # call + same category returns the original ticket), but a longer
        # timeout avoids the spurious failure in the first place.
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{self.base_url}/api/v1/voice-bot/livekit/complaint",
                params={"tenantId": tenant_id},
                headers=self._bearer(),
                json={**ticket, "callId": call_id},
            )
            resp.raise_for_status()
            return resp.json()

    async def search_knowledge_base(self, tenant_id: str, question: str) -> dict[str, Any] | None:
        async with httpx.AsyncClient(timeout=5) as client:
            try:
                resp = await client.get(
                    f"{self.base_url}/api/v1/voice-bot/knowledge-base/search",
                    params={"tenantId": tenant_id, "q": question},
                    headers=self._bearer(),
                )
                resp.raise_for_status()
                return resp.json().get("data")
            except Exception:
                return None

    async def lookup_contact(
        self, tenant_id: str, phone: str | None, nic: str | None, email: str | None,
    ) -> dict[str, Any]:
        params: dict[str, str] = {"tenantId": tenant_id}
        if phone:
            params["phone"] = phone
        if nic:
            params["nic"] = nic
        if email:
            params["email"] = email
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(
                    f"{self.base_url}/api/v1/voice-bot/livekit/lookup-contact",
                    params=params,
                    headers=self._bearer(),
                )
                return resp.json() if resp.status_code == 200 else {"found": False}
        except Exception:
            return {"found": False}

    async def get_hold_audio(self, tenant_id: str) -> bytes | None:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{self.base_url}/api/v1/voice-bot/livekit/hold-audio",
                    params={"tenantId": tenant_id},
                    headers=self._bearer(),
                )
                if resp.status_code != 200:
                    return None
                return resp.content
        except Exception:
            return None

    async def call_started(self, tenant_id: str, call_id: str) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.post(
                    f"{self.base_url}/api/v1/voice-bot/livekit/call-started",
                    params={"tenantId": tenant_id},
                    headers=self._bearer(),
                    json={"callId": call_id},
                )
                return resp.json() if resp.status_code == 200 else {"overCapacity": False}
        except Exception:
            return {"overCapacity": False}

    async def get_minutes_status(self, tenant_id: str) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(
                    f"{self.base_url}/api/v1/voice-bot/livekit/minutes-status",
                    params={"tenantId": tenant_id},
                    headers=self._bearer(),
                )
                return resp.json() if resp.status_code == 200 else {"exhausted": False}
        except Exception:
            return {"exhausted": False}

    async def call_ended(
        self, tenant_id: str, call_id: str, transcript: str, recording_url: str | None,
    ) -> None:
        payload: dict[str, Any] = {"voiceCallId": call_id, "transcript": transcript}
        if recording_url:
            payload["recordingUrl"] = recording_url
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"{self.base_url}/api/v1/voice-bot/livekit/call-ended",
                params={"tenantId": tenant_id},
                headers=self._bearer(),
                json=payload,
            )


def get_client() -> CRMConnector:
    """Picks which CRM adapter this deployment talks to. Defaults to
    AmanahCX (today's only connector) so nothing changes for existing
    tenants. A future Salesforce/HubSpot/Dynamics/SugarCRM connector adds
    itself here as another `elif` — Nadia's own code never needs to know
    which one is active."""
    base_url = os.environ["CRM_API_BASE_URL"]
    secret = os.environ.get("LIVEKIT_INGEST_SECRET", "")
    connector = os.environ.get("CRM_CONNECTOR", "amanahcx").strip().lower()

    if connector == "amanahcx":
        return AmanahCXConnector(base_url, secret)

    raise ValueError(
        f"Unknown CRM_CONNECTOR '{connector}' — no adapter registered for it yet. "
        "Add a new class implementing CRMConnector's six methods and register it here."
    )
