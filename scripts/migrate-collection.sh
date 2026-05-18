#!/usr/bin/env bash
# Migrate a Qdrant collection from local Docker to the GCE VM.
#
# Usage:
#   GOOGLE_CLOUD_PROJECT=my-project \
#     ./scripts/migrate-collection.sh --collection=codp
#
# Optional flags:
#   --local-url=http://localhost:6333  (default)
#   --from=<name>  source collection on local  (defaults to --collection)
#   --to=<name>    target collection on VM      (defaults to --collection)
set -euo pipefail

# ── Parse args ────────────────────────────────────────────────────────────────
COLLECTION=""
LOCAL_URL="http://localhost:6333"
FROM=""
TO=""

for arg in "$@"; do
  case "$arg" in
    --collection=*) COLLECTION="${arg#*=}" ;;
    --local-url=*)  LOCAL_URL="${arg#*=}" ;;
    --from=*)       FROM="${arg#*=}" ;;
    --to=*)         TO="${arg#*=}" ;;
  esac
done

if [[ -z "$COLLECTION" && -z "$FROM" ]]; then
  echo "Usage: $0 --collection=<name> [--local-url=...] [--from=<name>] [--to=<name>]"
  exit 1
fi

FROM="${FROM:-$COLLECTION}"
TO="${TO:-$COLLECTION}"

PROJECT=${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT}
REGION=${GOOGLE_CLOUD_LOCATION:-us-central1}
ZONE="${REGION}-a"
VM_NAME=test-service-db
IAP_FIREWALL=allow-ssh-iap

echo ""
echo "==> Migration plan"
echo "    Local  : ${LOCAL_URL}/collections/${FROM}"
echo "    VM     : ${VM_NAME} → collection: ${TO}"
echo "    Project: ${PROJECT}"
echo ""
read -r -p "Proceed? (y/N) " CONFIRM
[[ "$CONFIRM" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

# ── Firewall: open IAP SSH, always clean up on exit ──────────────────────────
cleanup() {
  echo ""
  echo "==> Removing IAP firewall rule..."
  gcloud compute firewall-rules delete "$IAP_FIREWALL" \
    --project="$PROJECT" --quiet 2>/dev/null || true
}
trap cleanup EXIT

echo ""
echo "==> Opening IAP SSH firewall rule..."
gcloud compute firewall-rules create "$IAP_FIREWALL" \
  --project="$PROJECT" \
  --direction=INGRESS --action=ALLOW \
  --rules=tcp:22 --source-ranges=35.235.240.0/20 \
  --target-tags=qdrant-server --quiet

# ── Step 1: Create snapshot on local Qdrant ───────────────────────────────────
echo ""
echo "==> Creating snapshot of '${FROM}' on local Qdrant..."
SNAP=$(curl -sf -X POST "${LOCAL_URL}/collections/${FROM}/snapshots" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['name'])")

if [[ -z "$SNAP" ]]; then
  echo "    Failed to create snapshot. Is local Qdrant running at ${LOCAL_URL}?"
  exit 1
fi
echo "    Snapshot: ${SNAP}"

# ── Step 2: Download snapshot to /tmp ─────────────────────────────────────────
echo "==> Downloading snapshot..."
TMP_SNAP="/tmp/${SNAP}"
curl -sf -o "$TMP_SNAP" "${LOCAL_URL}/collections/${FROM}/snapshots/${SNAP}"
echo "    Saved to ${TMP_SNAP} ($(du -sh "$TMP_SNAP" | cut -f1))"

# ── Step 3: Copy snapshot to VM ───────────────────────────────────────────────
echo "==> Copying snapshot to VM (${VM_NAME})..."
gcloud compute scp "$TMP_SNAP" "${VM_NAME}:/tmp/${SNAP}" \
  --zone="$ZONE" --project="$PROJECT"
echo "    Done."

# ── Step 4: Restore on VM ─────────────────────────────────────────────────────
echo "==> Restoring '${TO}' on VM..."
gcloud compute ssh "$VM_NAME" \
  --zone="$ZONE" --project="$PROJECT" \
  --command="
    curl -sf -X POST 'http://localhost:6333/collections/${TO}/snapshots/upload?priority=snapshot' \
      -H 'Content-Type: multipart/form-data' \
      -F 'snapshot=@/tmp/${SNAP}' \
    && rm /tmp/${SNAP}
  "
echo "    Restored."

# ── Step 5: Verify ────────────────────────────────────────────────────────────
echo "==> Verifying collection on VM..."
gcloud compute ssh "$VM_NAME" \
  --zone="$ZONE" --project="$PROJECT" \
  --command="curl -sf http://localhost:6333/collections/${TO} | python3 -c \"
import sys, json
info = json.load(sys.stdin)['result']
count = info.get('vectors_count') or info.get('points_count') or 0
print(f'    Collection: ${TO}')
print(f'    Vectors   : {count}')
\""

# ── Cleanup local temp file ───────────────────────────────────────────────────
rm -f "$TMP_SNAP"

echo ""
echo "==> Migration complete."
