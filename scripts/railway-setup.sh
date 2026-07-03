#!/usr/bin/env bash
# Configure Biko on Railway (Postgres + api + web + modo-sync).
# Requires: railway CLI logged in, repo linked to project.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROJECT_ID="${RAILWAY_PROJECT_ID:-}"
ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"

if [[ -z "$PROJECT_ID" ]]; then
  PROJECT_ID="$(railway status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
fi

ENV_ID="$(railway status --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["environments"]["edges"][0]["node"]["id"])')"

echo "Project: $PROJECT_ID  Environment: $ENVIRONMENT ($ENV_ID)"

ensure_service() {
  local name="$1"
  local repo="${2:-}"
  if railway service list --json | python3 -c "import json,sys; names={s['name'] for s in json.load(sys.stdin)}; sys.exit(0 if '$name' in names else 1)"; then
    echo "Service '$name' already exists"
  else
    if [[ -n "$repo" ]]; then
      railway add --service "$name" --repo "$repo" --json >/dev/null
    else
      railway add --service "$name" --json >/dev/null
    fi
    echo "Created service '$name'"
  fi
}

ensure_service "api"
ensure_service "web"
ensure_service "modo-sync"

# Remove legacy single-service deploy if present
if railway service list --json | python3 -c "import json,sys; names={s['name'] for s in json.load(sys.stdin)}; sys.exit(0 if 'biko' in names else 1)"; then
  echo "Removing legacy 'biko' service..."
  railway service delete --service biko --yes --json >/dev/null || true
fi

JWT_SECRET="${JWT_SECRET:-\${{ secret(32, \"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\") }}}"

echo "Setting api variables..."
railway variable set \
  --service api \
  'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
  "JWT_SECRET=$JWT_SECRET" \
  'RAILPACK_BUILD_CMD=npm install && npx prisma generate --schema apps/api/prisma/schema.prisma' \
  'RAILPACK_START_CMD=npm run railway:release --workspace @biko/api && npm run start --workspace @biko/api' \
  'CORS_ORIGIN=https://${{web.RAILWAY_PUBLIC_DOMAIN}}' \
  --skip-deploys --json >/dev/null

echo "Setting web variables..."
railway variable set \
  --service web \
  'VITE_API_URL=https://${{api.RAILWAY_PUBLIC_DOMAIN}}' \
  'RAILPACK_BUILD_CMD=npm install && npm run build --workspace @biko/web' \
  'RAILPACK_START_CMD=npm run start --workspace @biko/web' \
  --skip-deploys --json >/dev/null

echo "Setting modo-sync variables..."
railway variable set \
  --service modo-sync \
  'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
  'RAILPACK_BUILD_CMD=npm install && npx prisma generate --schema apps/api/prisma/schema.prisma' \
  'RAILPACK_START_CMD=npm run sync:modo --workspace @biko/api' \
  --skip-deploys --json >/dev/null

echo "Generating public domains..."
API_DOMAIN="$(railway domain --service api --json 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("domain") or d.get("url","").replace("https://",""))' || true)"
WEB_DOMAIN="$(railway domain --service web --json 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("domain") or d.get("url","").replace("https://",""))' || true)"
echo "  api: ${API_DOMAIN:-pending}"
echo "  web: ${WEB_DOMAIN:-pending}"

# Apply deploy settings (healthcheck, cron, watch paths) via environment config
python3 <<'PY' | railway environment edit -m "Configure Biko services" --json
import json, subprocess, sys

status = json.loads(subprocess.check_output(["railway", "status", "--json"]))
env_id = status["environments"]["edges"][0]["node"]["id"]
services = {e["node"]["serviceName"]: e["node"]["serviceId"]
            for e in status["environments"]["edges"][0]["node"]["serviceInstances"]["edges"]}

cfg = json.loads(subprocess.check_output(["railway", "environment", "config", "--json"]))

def svc(sid):
    return cfg["services"].setdefault(sid, {})

if "api" in services:
    s = svc(services["api"])
    s.setdefault("build", {})["buildCommand"] = "npm install && npx prisma generate --schema apps/api/prisma/schema.prisma"
    s.setdefault("deploy", {})["startCommand"] = "npm run railway:release --workspace @biko/api && npm run start --workspace @biko/api"
    s["deploy"]["healthcheckPath"] = "/health"
    s.setdefault("build", {})["watchPatterns"] = ["apps/api/**", "packages/shared/**", "package.json", "package-lock.json"]

if "web" in services:
    s = svc(services["web"])
    s.setdefault("build", {})["buildCommand"] = "npm install && npm run build --workspace @biko/web"
    s.setdefault("deploy", {})["startCommand"] = "npm run start --workspace @biko/web"
    s.setdefault("build", {})["watchPatterns"] = ["apps/web/**", "packages/shared/**", "package.json", "package-lock.json"]

if "modo-sync" in services:
    s = svc(services["modo-sync"])
    s.setdefault("build", {})["buildCommand"] = "npm install && npx prisma generate --schema apps/api/prisma/schema.prisma"
    s.setdefault("deploy", {})["startCommand"] = "npm run sync:modo --workspace @biko/api"
    s["deploy"]["cronSchedule"] = "0 9 * * *"
    s["deploy"]["restartPolicyType"] = "NEVER"

print(json.dumps(cfg))
PY

echo ""
echo "Deploying services..."
railway up --service api --detach --message "Deploy api"
railway up --service web --detach --message "Deploy web"
railway up --service modo-sync --detach --message "Deploy modo-sync"

echo ""
echo "Done. Check status: railway service list --json"
