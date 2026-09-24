---
name: llm-extraction
description: How receipt extraction and the LLM layer work and how to change them safely — provider interface and implementations, per-user model selection with BYOK credentials, prompt and schema files, chunked continuation and truncation handling, the mock provider for tests, cost and privacy guardrails, and the operational runbook. Use for any change under apps/api/src/receipt/extraction or apps/api/src/llm, prompt edits, provider or model changes, and when investigating a failed extraction.
---

# LLM extraction

Domain page: `wiki/receipts-and-llm.md` (pipeline, statuses, API). Operations:
`docs/runbook-llm-extraction.md`. Design: `docs/phase-7-receipts-design.md`,
`docs/phase-8-receipt-intake-design.md`.

## Where things live

- Provider layer: `apps/api/src/receipt/extraction/` — provider interface, Anthropic and OpenAI
  providers, the mock provider, the output schema (`extraction.schema.ts`, output-token ceiling),
  prompt assembly, continuation logic.
- Per-user model selection and BYOK: `apps/api/src/llm/` (catalog in
  `packages/shared/src/types/llm.types.ts`, credentials encrypted by `llm-crypto.util.ts`).
- Worker: `receipt-extraction.processor.ts` (BullMQ; job ids must not contain `:`).

## Changing prompts, schema or providers

1. Reproduce with the mock provider or a recorded response in the receipt `__tests__` before
   touching the prompt; there are no image fixtures — add a recorded provider response when you
   change parsing.
2. Keep the schema the contract: providers return structured output validated against it;
   truncation is its own error, never "non-JSON output".
3. Model defaults come from env names (`RECEIPT_EXTRACTION_PROVIDER`, provider model vars); any
   default must exist in the shared catalog so the per-user picker and the default agree.
4. Continuation: long receipts are extracted in chunks; preserve item ordering and the reasoning
   persisted on the receipt.
5. Tests: provider unit specs, processor spec, integration for the intake endpoints; run the
   receipt suite and the web receipt specs.

## Guardrails

- User credentials are decrypted only in the provider call path; never logged, never returned by
  an endpoint, never in error messages.
- URL intake passes the SSRF guard (`receipt-url-guard.util.ts`); DNS-rebinding is a known
  accepted gap — do not claim otherwise.
- Cost: respect the output ceiling and continuation limits; a prompt change that grows tokens
  needs a note in the progress doc.
- Failed extraction triage: runbook sections on statuses, retry and the mock symptom test.
