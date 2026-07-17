# Nadia CRM Connector Contract

Nadia (this service) never talks to a CRM's real database or API shape
directly. Every interaction goes through six operations, implemented in
`src/crm_client.py`. Today only one connector exists — **AmanahCX**, the
reference implementation. Any other CRM (Salesforce, HubSpot, Microsoft
Dynamics, SugarCRM, or a custom in-house system) can plug Nadia in by
implementing the same six operations as its own API/webhooks — nothing
in Nadia's voice/AI code (the VAD → STT → LLM → TTS pipeline, SIP
handling, etc.) needs to change.

Think of it like a universal power socket: Nadia has one plug shape.
Each CRM brings its own small adapter that fits that shape internally,
however its own systems actually work.

## The six operations

| # | Operation | When Nadia calls it | What it needs back |
|---|---|---|---|
| 1 | `get_config(tenant_id)` | Once, at the start of every call | Bot settings: name, voice, tone, language, greeting, guardrails, minutes/capacity limits, human transfer destination, etc. `None` if not configured — Nadia uses safe defaults. |
| 2 | `create_ticket(tenant_id, call_id, ticket)` | Whenever a complaint/request needs a human follow-up | A ticket/case reference number Nadia can read back to the caller. |
| 3 | `search_knowledge_base(tenant_id, question)` | When the caller asks a general question | A matching answer, or `None` if nothing matches (Nadia proceeds normally). |
| 4 | `call_started(tenant_id, call_id)` | Right after the caller connects | Whether this call is allowed to proceed, or whether the tenant/server is already at its concurrent-call limit. |
| 5 | `get_minutes_status(tenant_id)` | Right after the caller connects | Whether this tenant has used up its allocated minutes. |
| 6 | `call_ended(tenant_id, call_id, transcript, recording_url)` | When the call ends | Nothing — this just reports the outcome back for the CRM to store. |

## Adding a new CRM

1. Write one new class in `src/crm_client.py` implementing the
   `CRMConnector` protocol (same six methods, any internal logic).
2. Register it in `get_client()` under a new `CRM_CONNECTOR` env value
   (e.g. `CRM_CONNECTOR=salesforce`).
3. Point that tenant's deployment at the new connector's base URL/auth.

Nothing else changes. A tenant using a different CRM runs the exact same
Nadia voice pipeline, SIP setup, and hosting — only which of these six
calls' destinations differ.

## Known simplification still needed

A few fields in today's contract lean on AmanahCX-specific concepts
(e.g. `priority: urgent/high/medium/low` mapping to AmanahCX's P1–P4,
specific ticket `category` values). A second real connector should
generalize these to CRM-neutral fields/enums rather than forcing
another CRM's data model into AmanahCX's shape.
