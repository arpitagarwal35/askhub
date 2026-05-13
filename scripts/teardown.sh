#!/usr/bin/env bash
# Teardown: deletes ALL infrastructure including the Qdrant disk.
# This is irreversible — all indexed data will be lost.
#
# Dependency order:
#   Cloud Run → VPC connector (Cloud Run must release connector before deletion)
#   VPC connector → its auto-created firewall rules (cleaned up after)
#   VM → data disk (disk cannot be deleted while VM exists)
#   Cloud NAT → Cloud Router (NAT must be removed before router)
set -euo pipefail

if [[ -f .env ]]; then set -a; source .env; set +a; fi

PROJECT=${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT}
REGION=${GOOGLE_CLOUD_LOCATION:-us-central1}
ZONE="${REGION}-a"
SERVICE=test-service
REPO=test-service
VM_NAME=test-service-db
DISK_NAME=test-service-data
CONNECTOR=test-service-vpc
SECRET=test-service-config

echo ""
echo "==> Teardown — ALL of the following will be permanently deleted:"
echo "    Cloud Run service  : $SERVICE"
echo "    VPC connector      : $CONNECTOR"
echo "    VM                 : $VM_NAME"
echo "    Persistent disk    : $DISK_NAME  *** Qdrant data will be lost ***"
echo "    Secret             : $SECRET"
echo "    Artifact Registry  : $REPO"
echo "    Cloud NAT          : test-service-nat"
echo "    Cloud Router       : test-service-router"
echo "    Firewall rules     : allow-qdrant-internal + vpc-connector auto-created"
echo ""
echo "    This cannot be undone."
echo ""
read -r -p "Type 'delete' to confirm: " CONFIRM
[[ "$CONFIRM" == "delete" ]] || { echo "Aborted."; exit 0; }
echo ""

# 1. Cloud Run first — must release VPC connector before connector can be deleted
echo "==> Deleting Cloud Run service..."
gcloud run services delete "$SERVICE" \
  --region="$REGION" --project="$PROJECT" --quiet 2>/dev/null \
  && echo "    Done." || echo "    Already gone."

# 2. Artifact Registry — delete-tags ensures images don't block deletion
echo "==> Deleting Artifact Registry repository..."
gcloud artifacts repositories delete "$REPO" \
  --location="$REGION" --project="$PROJECT" --quiet 2>/dev/null \
  && echo "    Done." || echo "    Already gone."

# 3. VPC connector — must come after Cloud Run
echo "==> Deleting VPC connector..."
gcloud compute networks vpc-access connectors delete "$CONNECTOR" \
  --region="$REGION" --project="$PROJECT" --quiet 2>/dev/null \
  && echo "    Done." || echo "    Already gone."

# 4. Clean up auto-created VPC connector firewall rules (GCP creates these automatically
#    and sometimes leaves them behind after connector deletion)
echo "==> Cleaning up VPC connector firewall rules..."
for rule in $(gcloud compute firewall-rules list \
  --project="$PROJECT" \
  --filter="name~'^vpc-connector-${CONNECTOR}'" \
  --format="value(name)" 2>/dev/null); do
  gcloud compute firewall-rules delete "$rule" --project="$PROJECT" --quiet 2>/dev/null \
    && echo "    Deleted $rule" || true
done
echo "    Done."

# 5. VM — must be deleted before data disk
echo "==> Deleting VM..."
if gcloud compute instances describe "$VM_NAME" --zone="$ZONE" --project="$PROJECT" &>/dev/null; then
  gcloud compute instances delete "$VM_NAME" \
    --zone="$ZONE" --project="$PROJECT" --quiet
  echo "    Done."
else
  echo "    Already gone."
fi

# 6. Data disk — only after VM is confirmed gone
echo "==> Deleting data disk..."
gcloud compute disks delete "$DISK_NAME" \
  --zone="$ZONE" --project="$PROJECT" --quiet 2>/dev/null \
  && echo "    Done." || echo "    Already gone."

# 7. Qdrant internal firewall rule
echo "==> Deleting firewall rule..."
gcloud compute firewall-rules delete allow-qdrant-internal \
  --project="$PROJECT" --quiet 2>/dev/null \
  && echo "    Done." || echo "    Already gone."

# 8. Cloud NAT — must come before Cloud Router
echo "==> Deleting Cloud NAT..."
gcloud compute routers nats delete test-service-nat \
  --router=test-service-router \
  --region="$REGION" --project="$PROJECT" --quiet 2>/dev/null \
  && echo "    Done." || echo "    Already gone."

# 9. Cloud Router — after NAT
echo "==> Deleting Cloud Router..."
gcloud compute routers delete test-service-router \
  --region="$REGION" --project="$PROJECT" --quiet 2>/dev/null \
  && echo "    Done." || echo "    Already gone."

# 10. Secret — no dependencies
echo "==> Deleting Secret Manager secret..."
gcloud secrets delete "$SECRET" \
  --project="$PROJECT" --quiet 2>/dev/null \
  && echo "    Done." || echo "    Already gone."

echo ""
echo "==> Teardown complete. All resources deleted."
