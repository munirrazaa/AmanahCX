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
| 3b | `lookup_contact(tenant_id, phone, nic, email)` | The moment the caller shares any one of phone/NIC/email | Whether an existing contact matches, how confidently (see below), and a first name to read back for confirmation. Read-only — never creates a contact. |
| 4 | `call_started(tenant_id, call_id)` | Right after the caller connects | Whether this call is allowed to proceed, or whether the tenant/server is already at its concurrent-call limit. |
| 5 | `get_minutes_status(tenant_id)` | Right after the caller connects | Whether this tenant has used up its allocated minutes. |
| 6 | `call_ended(tenant_id, call_id, transcript, recording_url)` | When the call ends | Nothing — this just reports the outcome back for the CRM to store. |

## Identity matching rule (decided 2026-07-17)

A CRM connector's contact matching should follow this rule so returning
callers are recognised without over-trusting a single coincidence:

- **Strong match**: at least two of {phone, NIC, email} agree with the
  same existing contact. Safe to treat as confirmed — no need to ask the
  caller to verify further.
- **Weak match**: only one identifier was available this call and it
  matched. Nadia reads back a safe detail (first name) and asks the
  caller to confirm before relying on it being them.
- **No match**: create a new contact (only at ticket-creation time —
  `lookup_contact` itself never creates one).
- Every field a caller shares gets merged into the contact record, but
  never overwrites a value already on file (e.g. an old phone number
  stays authoritative even if the caller gives a new one this call,
  until updated some other explicit way).

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
