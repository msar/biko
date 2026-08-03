#!/usr/bin/env bash
# Configure Biko on Railway (Postgres + api + web + promotions-sync).
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
ensure_service "promotions-sync"

# Remove legacy services if present
for legacy in biko modo-sync mercadopago-sync; do
  if railway service list --json | python3 -c "import json,sys; names={s['name'] for s in json.load(sys.stdin)}; sys.exit(0 if '$legacy' in names else 1)"; then
    echo "Removing legacy '$legacy' service..."
    railway service delete --service "$legacy" --yes --json >/dev/null || true
  fi
done

# Never rotate JWT_SECRET on re-runs — regenerating invalidates every logged-in client.
EXISTING_JWT="$(railway variable list --service api --json 2>/dev/null | python3 -c 'import json,sys
try:
  raw=json.load(sys.stdin)
  vars_=raw if isinstance(raw, dict) else {v.get("name"): v.get("value") for v in raw}
  print(vars_.get("JWT_SECRET") or "")
except Exception:
  print("")' || true)"

API_VARS=(
  'DATABASE_URL=${{Postgres.DATABASE_URL}}'
  'RAILPACK_BUILD_CMD=npm install && npx prisma generate --schema apps/api/prisma/schema.prisma'
  'RAILPACK_START_CMD=npm run railway:release --workspace @biko/api && npm run start --workspace @biko/api'
  'CORS_ORIGIN=https://${{web.RAILWAY_PUBLIC_DOMAIN}}'
  'WEBAUTHN_RP_ID=${{web.RAILWAY_PUBLIC_DOMAIN}}'
  'WEBAUTHN_ORIGIN=https://${{web.RAILWAY_PUBLIC_DOMAIN}}'
)

if [[ -n "${JWT_SECRET:-}" ]]; then
  API_VARS+=("JWT_SECRET=$JWT_SECRET")
  echo "Using JWT_SECRET from environment"
elif [[ -n "$EXISTING_JWT" ]]; then
  echo "Keeping existing JWT_SECRET (not overwriting)"
else
  # Fixed random once; Railway template secret() can regenerate on re-apply.
  GENERATED_JWT="$(openssl rand -base64 48 | tr -d '\n/=+' | head -c 48)"
  API_VARS+=("JWT_SECRET=$GENERATED_JWT")
  echo "Generated a new stable JWT_SECRET"
fi

echo "Setting api variables..."
railway variable set \
  --service api \
  "${API_VARS[@]}" \
  --skip-deploys --json >/dev/null

echo "Setting web variables..."
railway variable set \
  --service web \
  'VITE_API_URL=https://${{api.RAILWAY_PUBLIC_DOMAIN}}' \
  'RAILPACK_BUILD_CMD=npm install && npm run build --workspace @biko/web' \
  'RAILPACK_START_CMD=npm run start --workspace @biko/web' \
  --skip-deploys --json >/dev/null

echo "Setting promotions-sync variables..."
railway variable set \
  --service promotions-sync \
  'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
  'RAILPACK_BUILD_CMD=npm install && npx prisma generate --schema apps/api/prisma/schema.prisma' \
  'RAILPACK_START_CMD=npm run sync:promotions --workspace @biko/api' \
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

if "promotions-sync" in services:
    s = svc(services["promotions-sync"])
    s.setdefault("build", {})["buildCommand"] = "npm install && npx prisma generate --schema apps/api/prisma/schema.prisma"
    s.setdefault("deploy", {})["startCommand"] = "npm run sync:promotions --workspace @biko/api"
    s["deploy"]["cronSchedule"] = "0 9 * * *"
    s["deploy"]["restartPolicyType"] = "NEVER"

print(json.dumps(cfg))
PY

echo ""
echo "Deploying services..."
railway up --service api --detach --message "Deploy api"
railway up --service web --detach --message "Deploy web"
railway up --service promotions-sync --detach --message "Deploy promotions-sync"

echo ""
echo "Done. Check status: railway service list --json"
