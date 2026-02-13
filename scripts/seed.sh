#!/usr/bin/env bash
set -euo pipefail

echo "🌱 Running database seed..."

# Run Prisma seed via the api package
pnpm --filter api exec prisma db seed

echo "✅ Seed completed"
