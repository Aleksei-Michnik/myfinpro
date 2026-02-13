#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Starting MyFinPro development environment..."

# Check prerequisites
command -v docker >/dev/null 2>&1 || { echo "❌ Docker is required but not installed."; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "❌ pnpm is required but not installed."; exit 1; }

# Copy env files if they don't exist
for env_file in .env apps/api/.env apps/web/.env; do
  if [ ! -f "$env_file" ] && [ -f "${env_file}.example" ]; then
    cp "${env_file}.example" "$env_file"
    echo "📋 Created $env_file from template"
  fi
done

# Start infrastructure services first
echo "🐳 Starting infrastructure services..."
docker compose up -d mysql redis

# Wait for MySQL to be healthy
echo "⏳ Waiting for MySQL to be ready..."
until docker compose exec mysql mysqladmin ping -h localhost -u root --password=rootpassword_change_me --silent 2>/dev/null; do
  sleep 2
done
echo "✅ MySQL is ready"

# Run migrations
echo "📦 Running database migrations..."
pnpm --filter api exec prisma migrate dev

# Start all services
echo "🐳 Starting all services..."
docker compose up -d

echo ""
echo "✅ MyFinPro is running!"
echo "   Web:     http://localhost:${NGINX_PORT:-80}"
echo "   API:     http://localhost:${API_PORT:-3001}/api/v1"
echo "   Swagger: http://localhost:${NGINX_PORT:-80}/api/docs"
echo "   MySQL:   localhost:${MYSQL_EXTERNAL_PORT:-3307}"
echo "   Redis:   localhost:${REDIS_EXTERNAL_PORT:-6380}"
