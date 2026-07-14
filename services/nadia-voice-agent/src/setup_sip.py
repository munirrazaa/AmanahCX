"""
One-time SIP wiring for Nadia — run this once Telecard hands over trunk details.

Creates, in LiveKit Cloud:
  1. an INBOUND SIP trunk (the door Telecard's phone network delivers calls to), and
  2. a DISPATCH RULE that puts every inbound call into its own room AND dispatches
     the named "nadia" agent into it, carrying the tenant id as metadata.

That metadata is what the agent reads via _extract_tenant_id() to load the right
tenant's config and file tickets against the right workspace. Because our worker
registers with agent_name="nadia" (named agents don't auto-join), this dispatch
rule is the piece that actually connects a real phone call to Nadia.

Usage (values from env, or override with flags):
    python src/setup_sip.py \
        --number "+92XXXXXXXXXX" \
        --allowed-ip "<telecard signalling IP>"     # optional but recommended
        --auth-user "<username>" --auth-pass "<password>"   # only if Telecard uses registration auth

Reads from env: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, CRM_TENANT_ID,
and (as fallbacks for the flags) SIP_TRUNK_NUMBER, SIP_ALLOWED_IP,
SIP_AUTH_USERNAME, SIP_AUTH_PASSWORD, MAX_CALL_DURATION_SEC.

Idempotent-ish: pass --replace to delete existing Nadia trunks/rules first so a
re-run doesn't stack duplicates.
"""

import argparse
import asyncio
import json
import os

from dotenv import load_dotenv
from livekit import api

TRUNK_NAME = "nadia-inbound"
RULE_NAME = "nadia-inbound-rule"
AGENT_NAME = "nadia"


async def _main() -> None:
    load_dotenv()
    p = argparse.ArgumentParser()
    p.add_argument("--number", default=os.environ.get("SIP_TRUNK_NUMBER", ""))
    p.add_argument("--allowed-ip", default=os.environ.get("SIP_ALLOWED_IP", ""))
    p.add_argument("--auth-user", default=os.environ.get("SIP_AUTH_USERNAME", ""))
    p.add_argument("--auth-pass", default=os.environ.get("SIP_AUTH_PASSWORD", ""))
    p.add_argument("--replace", action="store_true", help="delete existing Nadia trunk/rule first")
    args = p.parse_args()

    tenant_id = os.environ.get("CRM_TENANT_ID", "")
    if not tenant_id:
        raise SystemExit("CRM_TENANT_ID must be set (the workspace calls belong to).")
    if not args.number:
        raise SystemExit("A phone number is required (--number or SIP_TRUNK_NUMBER).")

    lk = api.LiveKitAPI(
        url=os.environ["LIVEKIT_URL"],
        api_key=os.environ["LIVEKIT_API_KEY"],
        api_secret=os.environ["LIVEKIT_API_SECRET"],
    )

    if args.replace:
        for t in (await lk.sip.list_sip_inbound_trunk(api.ListSIPInboundTrunkRequest())).items:
            if t.name == TRUNK_NAME:
                await lk.sip.delete_sip_trunk(api.DeleteSIPTrunkRequest(sip_trunk_id=t.sip_trunk_id))
                print(f"deleted existing trunk {t.sip_trunk_id}")
        for r in (await lk.sip.list_sip_dispatch_rule(api.ListSIPDispatchRuleRequest())).items:
            if r.name == RULE_NAME:
                await lk.sip.delete_sip_dispatch_rule(api.DeleteSIPDispatchRuleRequest(sip_dispatch_rule_id=r.sip_dispatch_rule_id))
                print(f"deleted existing dispatch rule {r.sip_dispatch_rule_id}")

    max_call = int(os.environ.get("MAX_CALL_DURATION_SEC", "600"))

    trunk = api.SIPInboundTrunkInfo(
        name=TRUNK_NAME,
        numbers=[args.number],
        allowed_addresses=[args.allowed_ip] if args.allowed_ip else [],
        auth_username=args.auth_user,
        auth_password=args.auth_pass,
        krisp_enabled=True,  # background-noise cancellation on the caller's audio
    )
    created_trunk = await lk.sip.create_sip_inbound_trunk(
        api.CreateSIPInboundTrunkRequest(trunk=trunk)
    )
    print(f"✓ inbound trunk created: {created_trunk.sip_trunk_id}")

    # Per-call rooms ("call-xxxx"), each with the named nadia agent dispatched
    # in and the tenant id carried as metadata (what the agent parses).
    rule = api.SIPDispatchRuleInfo(
        name=RULE_NAME,
        trunk_ids=[created_trunk.sip_trunk_id],
        rule=api.SIPDispatchRule(
            dispatch_rule_individual=api.SIPDispatchRuleIndividual(room_prefix="call-")
        ),
        room_config=api.RoomConfiguration(
            agents=[api.RoomAgentDispatch(
                agent_name=AGENT_NAME,
                metadata=json.dumps({"tenantId": tenant_id, "source": "sip"}),
            )],
        ),
    )
    created_rule = await lk.sip.create_sip_dispatch_rule(
        api.CreateSIPDispatchRuleRequest(
            dispatch_rule=rule,
            trunk_ids=[created_trunk.sip_trunk_id],
            room_config=rule.room_config,
        )
    )
    print(f"✓ dispatch rule created: {created_rule.sip_dispatch_rule_id}")

    sip_host = os.environ["LIVEKIT_URL"].replace("wss://", "").replace("ws://", "")
    print("\n── Give Telecard this SIP endpoint to deliver calls to ──")
    print(f"   sip:{args.number}@{sip_host};transport=tcp")
    print(f"   (number {args.number} → tenant {tenant_id[:8]}… → agent '{AGENT_NAME}')")

    await lk.aclose()


if __name__ == "__main__":
    asyncio.run(_main())
