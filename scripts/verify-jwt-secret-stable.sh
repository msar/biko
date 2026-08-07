#!/usr/bin/env bash
# Verify JWT_SECRET does not change across a Railway api redeploy.
# Usage: ./scripts/verify-jwt-secret-stable.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fp() {
  railway run -s api -- node -e \
    'const c=require("crypto");process.stdout.write(c.createHash("sha256").update(process.env.JWT_SECRET||"").digest("hex").slice(0,12))'
}

BEFORE="$(fp)"
echo "Before redeploy fp=$BEFORE (len via vars checked separately)"

if [[ ${#BEFORE} -ne 12 ]]; then
  echo "ERROR: could not read JWT_SECRET fingerprint from railway run" >&2
  exit 1
fi

railway redeploy --service api --yes
echo "Waiting 60s for deploy..."
sleep 60

AFTER="$(fp)"
echo "After redeploy fp=$AFTER"

if [[ "$BEFORE" != "$AFTER" ]]; then
  echo "FAIL: JWT_SECRET rotated on redeploy. Delete it and set a fixed literal:" >&2
  echo "  railway variable delete JWT_SECRET --service api" >&2
  echo "  railway variable set --service api JWT_SECRET=\"\$(openssl rand -base64 48)\"" >&2
  exit 1
fi

echo "OK: JWT_SECRET stable across redeploy"
