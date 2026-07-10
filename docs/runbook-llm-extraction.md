# Runbook — Connecting the Receipt LLM Extraction Provider

> **Scope**: how to switch receipt extraction from the built-in **mock**
> provider to a real vision LLM (Anthropic Claude by default), verify it, and
> roll back. Applies to staging and production (blue-green Docker on the
> deploy server) and to local dev.

## 0. Current state (read this first)

Receipt extraction is **pluggable** and defaults to a deterministic **mock**
provider. As shipped, **both staging and production run `mock`** until you
explicitly configure a real provider **and redeploy**.

The mock always returns the same canned receipt:

```
merchant: "Mock Grocery"   total: $16.60   items: 2   confidence: high
```

**If every uploaded receipt comes back as "Mock Grocery / $16.60", you are
still on the mock provider — the LLM is not connected.** That is the #1 cause
of "recognition looks broken / falls back to garbage". Fix = the steps below.

There is **no silent runtime fallback to mock**: once a real provider is
selected, a failed extraction retries (3×, exponential backoff) and then the
receipt goes to `FAILED` with a reason — it never quietly returns mock data.

## 1. How the config flows

```
GitHub secret/variable ──▶ deploy workflow env: ──▶ SSH envs: passthrough
   ──▶ export ──▶ docker compose ${VAR} ──▶ API container ──▶ ExtractionProviderFactory
```

The extraction worker runs **in-process in the API container**, so all vars
live on the `api` service. Four vars control it:

| Var                           | Kind       | Default                       | Purpose                           |
| ----------------------------- | ---------- | ----------------------------- | --------------------------------- |
| `RECEIPT_EXTRACTION_PROVIDER` | variable   | `mock`                        | `mock` \| `anthropic` \| `openai` |
| `RECEIPT_EXTRACTION_MODEL`    | variable   | `claude-opus-4-8` (anthropic) | model override                    |
| `ANTHROPIC_API_KEY`           | **secret** | _(unset)_                     | required for `anthropic`          |
| `OPENAI_API_KEY`              | **secret** | _(unset)_                     | required for `openai`             |

Provider/model are non-sensitive → GitHub **variables**. API keys are
sensitive → GitHub **secrets**. The deploy jobs run under GitHub Environments
named **`staging`** and **`production`**, so you can scope these per
environment (e.g. Claude on staging, mock on production) or set them
repo-wide.

> **Critical**: env is read at **container start**. Setting a secret does
> **nothing** until the next deploy re-creates the container. Always redeploy
> after changing these (Step 3).

## 2. Connect — staging

Prerequisite: an Anthropic API key (`sk-ant-…`) with vision access and
budget. (Model default is `claude-opus-4-8`; for the most capable extraction
you may set `claude-fable-5` — note it may occasionally return a `refusal`,
which the code treats as a permanent per-receipt failure.)

### 2a. Via the `gh` CLI (from the repo root)

```bash
gh secret   set ANTHROPIC_API_KEY --env staging          # paste the key when prompted
gh variable set RECEIPT_EXTRACTION_PROVIDER --env staging --body anthropic
# optional model override:
gh variable set RECEIPT_EXTRACTION_MODEL --env staging --body claude-opus-4-8
```

### 2b. Via the GitHub UI

`Settings → Environments → staging`:

- **Environment secrets → Add**: `ANTHROPIC_API_KEY` = your key.
- **Environment variables → Add**: `RECEIPT_EXTRACTION_PROVIDER` = `anthropic`
  (and optionally `RECEIPT_EXTRACTION_MODEL`).

## 3. Redeploy (mandatory)

The new env only takes effect on a fresh container:

- **Staging**: push any commit to `develop`, or re-run the latest
  **Deploy Staging** workflow run (`gh run rerun <id>` or the UI "Re-run all
  jobs").
- **Production**: re-run the latest **Deploy Production** run, or merge to
  `main`.

Blue-green means the new slot must pass its health check before traffic
switches; a failure auto-rolls-back.

## 4. Verify

### 4a. Confirm the provider the container booted with

```bash
ssh -i ~/.ssh/id_ed25519_myfinpro deploy@<SERVER>
CID=$(docker ps --filter name=myfinpro-staging-api --format '{{.Names}}' | head -1)
docker logs "$CID" 2>&1 | grep -i "extraction provider" | tail -1
#   expect: "Receipt extraction provider: anthropic"
docker exec "$CID" printenv RECEIPT_EXTRACTION_PROVIDER   # expect: anthropic
docker exec "$CID" sh -c '[ -n "$ANTHROPIC_API_KEY" ] && echo "key: set" || echo "key: MISSING"'
```

(For production use `myfinpro-prod-api`.)

### 4b. End-to-end smoke test

1. Log in → **Receipts** → upload a **JPEG/PNG/PDF** of a real receipt.
2. The row goes `UPLOADED → EXTRACTING → REVIEW`. On success you'll see the
   **real** merchant/total/items — not "Mock Grocery".
3. Watch the provider log line for the call:
   ```bash
   docker logs -f "$CID" 2>&1 | grep "anthropic extraction:"
   #   anthropic extraction: model=claude-opus-4-8 durationMs=… input=…tok output=…tok stop=end_turn
   ```

## 5. Troubleshooting — "recognition works badly / falls back"

| Symptom                                                                              | Cause                                                                        | Fix                                                                                                                                                                  |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Every receipt = "Mock Grocery" / $16.60**                                          | Still on the **mock** provider                                               | `RECEIPT_EXTRACTION_PROVIDER` not set to `anthropic`, **or** set but **not redeployed**. Do Step 2 + Step 3; confirm the boot log (4a).                              |
| Boot log says `anthropic` but receipts go **FAILED** with a 401/authentication error | Key missing / typo / no vision access                                        | Re-set `ANTHROPIC_API_KEY` (Step 2), redeploy. Verify `key: set` in 4a.                                                                                              |
| **iPhone photos** fail / go `FAILED` (pre-7.11 builds only)                          | HEIC was stored as-is, and vision APIs reject `image/heic`                   | Fixed in 7.11: HEIC uploads are converted to JPEG at storage time. On current builds a HEIC rejection means the file itself is corrupt — re-shoot or export as JPEG. |
| Receipts intermittently `FAILED`, log shows `circuit breaker OPEN`                   | Repeated provider errors (rate limit / outage) tripped the breaker           | Wait out the 60s cooldown; check Anthropic status + your rate limits/budget. The breaker half-opens automatically and closes on the next success.                    |
| **URL receipts** recognize poorly                                                    | Pre-7.12: raw HTML noise; current builds reduce pages to readable text first | Still weaker than a photo/PDF for image-heavy pages (no rendering) — prefer uploading the file when quality matters.                                                 |
| Log shows `stop=refusal` → receipt `FAILED`                                          | Safety classifier declined the document (more likely on `claude-fable-5`)    | Use `claude-opus-4-8` for extraction, or retry the receipt.                                                                                                          |
| Blurry/rotated photo, wrong totals                                                   | Genuine recognition limit                                                    | Retake in good light; the review screen lets the user correct every field before confirming.                                                                         |

Quick "am I actually on the LLM?" check: upload one real receipt — if it does
**not** say "Mock Grocery", the LLM is connected.

## 6. Rollback (back to mock)

```bash
gh variable set RECEIPT_EXTRACTION_PROVIDER --env staging --body mock
# then redeploy (Step 3)
```

Or delete the variable (compose falls back to `mock` when unset). The
`ANTHROPIC_API_KEY` secret can stay — it's ignored while the provider is
`mock`.

## 7. Local development

Set the same vars in `apps/api/.env` and restart the API:

```
RECEIPT_EXTRACTION_PROVIDER=anthropic
RECEIPT_EXTRACTION_MODEL=claude-opus-4-8
ANTHROPIC_API_KEY=sk-ant-...
```

Leave `RECEIPT_EXTRACTION_PROVIDER=mock` (the default) for deterministic tests
and CI — the mock is what the unit/integration/E2E suites rely on.

## 8. Notes on cost & limits

- Each receipt = one vision call (`max_tokens: 8192`, adaptive thinking).
  Watch the `input=…tok output=…tok` log line for per-call usage.
- An unknown `RECEIPT_EXTRACTION_PROVIDER` value **fails the container boot**
  by design (a typo is a config error, not a silent mock) — check the API
  container logs if it won't start after a change.
