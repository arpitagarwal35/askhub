#!/usr/bin/env bash
# Pause: stop the VM, delete Cloud Run + VPC connector.
# Saves ~$22/month. The Qdrant disk is preserved — re-run setup.sh to resume.
#
# Dependency order:
#   Cloud Run → VPC connector (Cloud Run must release connector before deletion)
#   VPC connector → its auto-created firewall rules (cleaned up after)
set -euo pipefail

if [[ -f .env ]]; then set -a; source .env; set +a; fi

PROJECT=${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT}
REGION=${GOOGLE_CLOUD_LOCATION:-us-central1}
ZONE="${REGION}-a"
SERVICE=test-service
VM_NAME=test-service-db
CONNECTOR=test-service-vpc

echo ""
echo "==> Pause — resources to be stopped/deleted:"
echo "    Cloud Run service  : $SERVICE (deleted)"
echo "    VPC connector      : $CONNECTOR (deleted)"
echo "    VM                 : $VM_NAME (stopped, disk kept)"
echo "    NAT / Router       : kept (low cost, avoids recreation hassle)"
echo ""
read -r -p "Proceed? (y/N) " CONFIRM
[[ "$CONFIRM" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
echo ""

# 1. Cloud Run first — must release VPC connector before connector can be deleted
echo "==> Deleting Cloud Run service..."
gcloud run services delete "$SERVICE" \
  --region="$REGION" --project="$PROJECT" --quiet 2>/dev/null \
  && echo "    Done." || echo "    Already gone."

# 2. VPC connector — after Cloud Run
echo "==> Deleting VPC connector..."
gcloud compute networks vpc-access connectors delete "$CONNECTOR" \
  --region="$REGION" --project="$PROJECT" --quiet 2>/dev/null \
  && echo "    Done." || echo "    Already gone."

# 3. Clean up auto-created VPC connector firewall rules
echo "==> Cleaning up VPC connector firewall rules..."
for rule in $(gcloud compute firewall-rules list \
  --project="$PROJECT" \
  --filter="name~'^vpc-connector-${CONNECTOR}'" \
  --format="value(name)" 2>/dev/null); do
  gcloud compute firewall-rules delete "$rule" --project="$PROJECT" --quiet 2>/dev/null \
    && echo "    Deleted $rule" || true
done
echo "    Done."

# 4. Stop VM — disk is preserved
echo "==> Stopping VM (disk preserved)..."
gcloud compute instances stop "$VM_NAME" \
  --zone="$ZONE" --project="$PROJECT" --quiet 2>/dev/null \
  && echo "    Done." || echo "    Already stopped or gone."

echo ""
echo "==> Paused. To resume: GOOGLE_CLOUD_PROJECT=$PROJECT ./scripts/setup.sh"
