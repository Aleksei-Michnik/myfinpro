# Runbook — Connecting the Receipt LLM Extraction Provider

> **Scope**: how to switch receipt extraction from the built-in **mock**
> provider to a real vision LLM (Anthropic Claude by default), verify it, and
> roll back. Applies to staging and production (blue-green Docker on the
> deploy server) and to local dev.

> **Direction (accepted 2026-07-12)**: LLM access is becoming a **per-user
> setting** — each user picks their model from a curated Anthropic/OpenAI
> catalog, and every LLM-powered feature (Phase 7 extraction, the Phase 8
> product-candidate ranking that rides the same call, and future phases)
> uses the uploader's choice. See **§9** for the target design and how the
> env vars below are reinterpreted once it lands. Until that iteration
> ships, selection is still per-deployment exactly as §§1–8 describe.

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

## 9. Per-user LLM selection (accepted direction — next iteration)

> **Status**: design accepted 2026-07-12; implementation is the next
> LLM-track iteration. Everything in this section describes the target
> behavior; §§1–8 stay authoritative until it ships.

### 9.1 What changes

Model choice moves from the deployment to the **user profile**. Each user
selects one entry from a **curated model catalog** in
**Settings → Account → AI model**; every LLM call made on that user's
behalf (receipt extraction incl. product-candidate ranking, and any later
LLM feature) resolves the model at call time:

```
user.llmProvider/llmModel  →  else RECEIPT_EXTRACTION_PROVIDER/MODEL (deployment default)
                           →  else mock
```

- The choice is stored on the `users` row (`llm_provider`, `llm_model`) and
  editable via `PATCH /users/me`; changes take effect on the **next** LLM
  call — no redeploy.
- Optionally the user stores a **personal provider API key** (BYOK) so
  their calls run on their own account — handled under the §9.4 security
  model, which is a hard requirement for shipping this.
- Extraction log lines and audit details gain the resolved
  `provider`/`model` (and whether a user or shared key was used — never
  key material), so per-user usage stays attributable.

### 9.2 Model catalog

The catalog is a code-maintained allowlist (one shared constant — the
settings picker, the DTO validator, and the provider factory all read it;
free-typed model ids are rejected). Initial catalog:

| Provider    | Model id           | Shown to the user as       |
| ----------- | ------------------ | -------------------------- |
| `anthropic` | `claude-fable-5`   | Anthropic Claude Fable 5   |
| `anthropic` | `claude-sonnet-5`  | Anthropic Claude Sonnet 5  |
| `anthropic` | `claude-opus-4-8`  | Anthropic Claude Opus 4.8  |
| `anthropic` | `claude-haiku-4-5` | Anthropic Claude Haiku 4.5 |
| `openai`    | `gpt-5.6`          | OpenAI GPT-5.6             |
| `openai`    | `gpt-5.2`          | OpenAI GPT-5.2             |

Only Anthropic and OpenAI are offered for now; adding a provider (Google
Gemini and others are planned) means a new **provider connector** plus
catalog rows — the Phase 7 pluggable extraction interface is unchanged.

### 9.2b Connecting a provider — auth methods

Pasting an API key is the baseline, not the goal. Each catalog provider
declares its supported **connection methods**, and the Settings UI renders
the easiest one first:

| Method          | Flow                                                                                                                    | Used for                                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `oauth`         | Authorization-code **with PKCE** + `state`, server-side token exchange, encrypted refresh-token storage, silent renewal | Providers with end-user OAuth (e.g. "Sign in with Claude" / "Sign in with ChatGPT" subscription flows; Google account auth when Gemini lands) |
| `api_key`       | §9.4 BYOK — paste once, validated live, stored encrypted                                                                | All providers (fallback)                                                                                                                      |
| `shared` (none) | No user credential — the deployment's funded key (§9.3)                                                                 | Default experience                                                                                                                            |

Connector contract per provider: `{ authMethods, startOAuth(), exchange(),
refresh(), buildClient(credential) }` — so adding Gemini later is one
connector + catalog rows, no changes to callers. OAuth tokens
(access + refresh) are **user LLM secrets like any other** and go through
the full §9.4 pipeline: same encrypted table (`credential_kind:
'api_key' | 'oauth'`), same write-only surface (the UI only ever sees
"Connected as …" + scopes), same redaction, plus OAuth-specific layers:
exact-match redirect-URI allowlist, per-request `state` nonce, PKCE
verifier never persisted, minimal scopes, and disconnect = local wipe
**and** best-effort remote token revocation.

### 9.3 What the env vars mean afterwards

| Var                           | Meaning after per-user selection lands                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY`           | Server-side **shared** key funding Anthropic calls for users without their own; unset → Anthropic entries hidden unless the user stored a personal key |
| `OPENAI_API_KEY`              | Same for OpenAI                                                                                                                                        |
| `RECEIPT_EXTRACTION_PROVIDER` | Deployment **default** for users who never picked (and dev/CI: keep `mock`)                                                                            |
| `RECEIPT_EXTRACTION_MODEL`    | Model for that default provider                                                                                                                        |
| `LLM_SECRETS_ENCRYPTION_KEY`  | **New secret** — 32-byte base64 master key for encrypting user-held LLM keys at rest (§9.4). Required once BYOK ships; boot fails without it           |

Key resolution per call: **user's own key** (if stored, for the chosen
provider) → **shared server key** → provider hidden/call refused. Users may
optionally bring their own provider key (BYOK) in Settings; billing for
their calls then rides their key.

### 9.4 Security model for user-held LLM secrets (required layers)

User API keys are credentials to the user's paid account — treat them like
passwords. All of the following are **required**, not optional:

1. **Dedicated table, application-layer encryption at rest.** Keys live in
   `user_llm_credentials` (one row per user × provider), NEVER on the
   `users` row — an accidental `SELECT *`/serialize of a user must not be
   able to leak them. Values are encrypted **before** they reach the DB:
   AES-256-GCM, random 96-bit IV per write, auth tag stored, ciphertext
   prefixed with a key-version tag (`v1:…`) for rotation. The master key
   comes from `LLM_SECRETS_ENCRYPTION_KEY` (GitHub **secret** → container
   env), is never written to the DB, the repo, or logs, and is therefore
   absent from DB dumps/backups by construction.
2. **Write-only API surface.** `PUT /users/me/llm-credentials/:provider`
   stores; `DELETE` revokes; reads return only `{ provider, keyHint }`
   (last 4 chars) + timestamps. The plaintext is **never** returned to any
   client after save — including the owner, including admins.
3. **Single decryption boundary.** One `LlmCredentialsService` owns
   decrypt; plaintext exists only inside the provider call path, resolved
   at call time, never cached, never put on request/job payloads (BullMQ
   jobs carry the user id, the worker resolves the key when it runs).
4. **Log + audit redaction.** The credentials endpoints are added to the
   pino `redact` paths (request bodies never logged); audit logs record
   `LLM_CREDENTIAL_SET/DELETED` with the key **hint only**; provider errors
   are sanitized so a 401 from Anthropic/OpenAI can't echo the key back.
5. **Format validation + live probe.** Keys are shape-checked per provider
   (`sk-ant-…` / `sk-…`) and verified with one cheap authenticated call on
   save — a typo fails at save time with a clear message, not at the next
   receipt.
6. **Abuse controls.** Strict throttle on the credential endpoints
   (mirrors the password-change limits); re-auth (fresh session) required
   to set or delete a key.
7. **Lifecycle.** `onDelete: Cascade` from the user + explicit wipe when an
   account-deletion request is accepted (credentials are purged at request
   time, not after the grace period — a pending deletion must not keep a
   usable key). Users can rotate by overwriting and revoke by deleting.
8. **Master-key rotation runbook.** New env key version → background
   re-encrypt of all rows (decrypt with vN, encrypt with vN+1, verify, then
   retire vN). The version prefix on each row makes this incremental and
   restartable.
9. **Transport & storage hygiene already in place** still applies: HTTPS
   only, keys never in URLs/query strings, `.env` untracked, no secrets in
   commits or compose files (deployment rules).

Shared server keys (§9.3) keep their existing handling: GitHub secrets →
env at container start; they are configuration, not user data, and never
touch the DB.

### 9.5 Ops checklist for the rollout

1. Generate and set `LLM_SECRETS_ENCRYPTION_KEY` (staging first):
   `openssl rand -base64 32` → `gh secret set … --env staging`.
2. Set the shared `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` you intend to
   offer as the funded default — §2.
3. Deploy the iteration (expand-only migrations: `users` selection columns
   - `user_llm_credentials`; settings UI).
4. Verify: pick a model in Settings, upload a receipt, and check the log
   line reports the chosen `provider=… model=…` (and `key=user|shared` —
   never the key itself).
5. Rollback semantics: clearing a user's choice falls back to the
   deployment default — §6 still applies unchanged.
