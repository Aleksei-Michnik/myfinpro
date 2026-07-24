---
name: stack-versions
description: Authoritative runtime/dependency versions for the MyFinPro stack — matches staging & production. Read BEFORE spinning up local infra, choosing any container image or `image:` tag, launching the app, seeding/connecting a database, or debugging a version-mismatch symptom (auth-plugin/handshake errors, "pool timeout", driver incompatibilities). Answers "which MySQL / Redis / Node / pnpm / TypeScript version do we use?" and how to detect a stale local container that drifted from the pinned version.
---

# MyFinPro — correct stack versions

Staging and production run these versions. **Local dev must match them** —
version drift between local and prod is a real source of bugs (auth-plugin
handshakes, driver incompatibilities). Never substitute an older major/LTS
"because it's already running locally."

## Version matrix (authoritative)

| Component  | Version                  | Pinned in                                                    |
| ---------- | ------------------------ | ------------------------------------------------------------ |
| MySQL      | **9.7** (latest LTS)     | every `docker-compose*.yml` (`image: mysql:9.7`)             |
| Redis      | **8** (`redis:8-alpine`) | every `docker-compose*.yml`                                  |
| Node.js    | **26** (LTS)             | `.node-version`, `engines.node >= 26`, CI `node-version: 26` |
| pnpm       | **10.x** (`10.32.1`)     | root `package.json` → `packageManager`                       |
| TypeScript | **6** (`~6.0.3`)         | root + `apps/*/package.json`                                 |

**MySQL is 9.7, never 8.4.** 8.4 is far too old for this project. The compose
files are the source of truth — if a tag ever disagrees with this table, the
compose files win, and this table is stale (update it).

## The stale-container trap

The compose files pin `mysql:9.7`, but a **long-lived local container** may
still be an older image started before a version bump. `docker ps` shows the
container name, not the image version — always check the image:

```bash
docker inspect --format '{{.Config.Image}}' myfinpro-mysql   # must say mysql:9.7
```

If it reports `mysql:8.4` (or any non-9.7), it drifted. Recreate it from the
pinned compose — **destructive to local DB data**, so confirm with the user
first:

```bash
docker compose up -d --force-recreate mysql   # rebuilds at the pinned image
```

## Symptoms of running the wrong MySQL locally

- `caching_sha2_password` handshake failures from a **host** process (Prisma
  MariaDB adapter): `DriverAdapterError: pool timeout … active=0 idle=0`, even
  though `docker exec … mysql` authenticates fine. A host→container connection
  over non-TLS may need `?allowPublicKeyRetrieval=true` on the `DATABASE_URL`
  — but first confirm the container is the **correct 9.7 image**; drift is the
  more likely root cause.

## Related

- Running the app locally: see the `run` skill / `docs/` — this skill only
  fixes _which versions_, not _how to launch_.
- Journal note: "production on node 26, ts 6, mysql 9.7"
  (`docs/phase-8-progress.md`).
