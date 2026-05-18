#!/usr/bin/env bash
set -euo pipefail

# ── Load .env if present ──────────────────────────────────────────────────────
ENV_SOURCE="environment"
if [[ -f .env ]]; then
  set -a; source .env; set +a
  ENV_SOURCE=".env"
fi

# ── Required ──────────────────────────────────────────────────────────────────
PROJECT=${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT}
REGION=${GOOGLE_CLOUD_LOCATION:-us-central1}
ZONE="${REGION}-a"

# ── Names (all grouped here) ──────────────────────────────────────────────────
SERVICE=test-service
REPO=test-service
VM_NAME=test-service-db
DISK_NAME=test-service-data
CONNECTOR=test-service-vpc
SECRET=test-service-config
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${SERVICE}"

json_get() { echo "$1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('$2',''))"; }
json_set() {
  # json_set <json> <key> <value> — returns updated JSON string
  echo "$1" | python3 -c "
import sys, json
d = json.load(sys.stdin)
d['$2'] = '$3'
print(json.dumps(d))
"
}

# ── Connector env vars (optional) ────────────────────────────────────────────
CONFLUENCE_BASE_URL=${CONFLUENCE_BASE_URL:-}
CONFLUENCE_EMAIL=${CONFLUENCE_EMAIL:-}
CONFLUENCE_API_TOKEN=${CONFLUENCE_API_TOKEN:-}
JIRA_BASE_URL=${JIRA_BASE_URL:-}
JIRA_EMAIL=${JIRA_EMAIL:-}
JIRA_API_TOKEN=${JIRA_API_TOKEN:-}
JIRA_PROJECT_KEY=${JIRA_PROJECT_KEY:-}
SHAREPOINT_TENANT_ID=${SHAREPOINT_TENANT_ID:-}
SHAREPOINT_CLIENT_ID=${SHAREPOINT_CLIENT_ID:-}
SHAREPOINT_CLIENT_SECRET=${SHAREPOINT_CLIENT_SECRET:-}
SHAREPOINT_SITE_ID=${SHAREPOINT_SITE_ID:-}

# ── Pre-flight summary ────────────────────────────────────────────────────────
echo ""
echo "==> Deployment config"
echo "    GCP project : $PROJECT"
echo "    Region      : $REGION"
echo "    Cloud Run   : $SERVICE"
echo ""
echo "    Connector credentials (sourced from ${ENV_SOURCE}) to be stored in Secret Manager + deployed to Cloud Run:"
if [[ -n "$CONFLUENCE_BASE_URL" ]]; then
  echo "    Confluence  : $CONFLUENCE_BASE_URL (${CONFLUENCE_EMAIL}) token=[set]"
else
  echo "    Confluence  : [not set, skipping]"
fi
if [[ -n "$JIRA_BASE_URL" ]]; then
  echo "    Jira        : $JIRA_BASE_URL (${JIRA_EMAIL}) project=${JIRA_PROJECT_KEY} token=[set]"
else
  echo "    Jira        : [not set, skipping]"
fi
if [[ -n "$SHAREPOINT_TENANT_ID" ]]; then
  echo "    SharePoint  : tenant=${SHAREPOINT_TENANT_ID} site=${SHAREPOINT_SITE_ID} secret=[set]"
else
  echo "    SharePoint  : [not set, skipping]"
fi
echo ""
read -r -p "Proceed? (y/N) " CONFIRM
[[ "$CONFIRM" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
echo ""

# ── Detect or create VPC network ─────────────────────────────────────────────
NETWORK=$(gcloud compute networks list --project="$PROJECT" --format="value(name)" --limit=1)
if [[ -z "$NETWORK" ]]; then
  echo "No VPC network found, creating default..."
  gcloud compute networks create default \
    --project="$PROJECT" \
    --subnet-mode=custom \
    --quiet
  gcloud compute networks subnets create "default-${REGION}" \
    --project="$PROJECT" \
    --network=default \
    --region="$REGION" \
    --range=10.128.0.0/20 \
    --quiet
  NETWORK=default
fi
echo "Using network: $NETWORK"

# ── Cloud Router + NAT (outbound internet for VM) ─────────────────────────────
echo "==> Cloud NAT"
gcloud compute routers describe test-service-router \
  --region="$REGION" --project="$PROJECT" &>/dev/null \
  || gcloud compute routers create test-service-router \
       --region="$REGION" --project="$PROJECT" \
       --network="$NETWORK" --quiet

gcloud compute routers nats describe test-service-nat \
  --router=test-service-router \
  --region="$REGION" --project="$PROJECT" &>/dev/null \
  || gcloud compute routers nats create test-service-nat \
       --router=test-service-router \
       --region="$REGION" --project="$PROJECT" \
       --nat-all-subnet-ip-ranges \
       --auto-allocate-nat-external-ips --quiet
echo "    Ready."

# ── Step 1: Provision Qdrant VM (skipped if already exists) ───────────────────
echo "==> Qdrant VM"
if ! gcloud compute instances describe "$VM_NAME" --zone="$ZONE" --project="$PROJECT" &>/dev/null; then
  echo "    Creating data disk..."
  gcloud compute disks describe "$DISK_NAME" --zone="$ZONE" --project="$PROJECT" &>/dev/null \
    || gcloud compute disks create "$DISK_NAME" \
         --zone="$ZONE" --project="$PROJECT" --size=20GB --type=pd-standard

  echo "    Creating VM..."
  gcloud compute instances create "$VM_NAME" \
    --zone="$ZONE" --project="$PROJECT" \
    --machine-type=e2-small \
    --image-family=debian-12 --image-project=debian-cloud \
    --disk="name=${DISK_NAME},device-name=qdrant-data,auto-delete=no" \
    --network="$NETWORK" \
    --subnet="default-${REGION}" \
    --tags=qdrant-server \
    --no-address \
    --metadata-from-file=startup-script=<(cat <<'STARTUP'
#!/bin/bash
set -e
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
fi
DISK=/dev/disk/by-id/google-qdrant-data
if ! mountpoint -q /qdrant/storage; then
  mkdir -p /qdrant/storage
  blkid "$DISK" &>/dev/null || mkfs.ext4 -F "$DISK"
  mount "$DISK" /qdrant/storage
  echo "$DISK /qdrant/storage ext4 defaults,nofail 0 2" >> /etc/fstab
fi
QDRANT_API_KEY=$(curl -sf -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/attributes/qdrant-api-key" || echo "")
docker rm -f qdrant 2>/dev/null || true
docker run -d --name qdrant --restart unless-stopped \
  -p 6333:6333 -v /qdrant/storage:/qdrant/storage \
  ${QDRANT_API_KEY:+-e QDRANT__SERVICE__API_KEY="$QDRANT_API_KEY"} \
  qdrant/qdrant:latest
STARTUP
)

  echo "    Creating firewall rule..."
  gcloud compute firewall-rules describe allow-qdrant-internal --project="$PROJECT" &>/dev/null \
    || gcloud compute firewall-rules create allow-qdrant-internal \
         --project="$PROJECT" --direction=INGRESS --action=ALLOW \
         --rules=tcp:6333 --source-ranges=10.0.0.0/8 \
         --target-tags=qdrant-server
else
  echo "    Already exists, skipping."
fi

INTERNAL_IP=$(gcloud compute instances describe "$VM_NAME" \
  --zone="$ZONE" --project="$PROJECT" \
  --format="value(networkInterfaces[0].networkIP)")
echo "    Internal IP: $INTERNAL_IP"

# ── Step 2: Config secret (skipped if already exists) ─────────────────────────
echo "==> Secret Manager"
if ! gcloud secrets describe "$SECRET" --project="$PROJECT" &>/dev/null; then
  echo "    Generating and storing config..."
  QDRANT_API_KEY=$(openssl rand -hex 32)

  # Update VM metadata with Qdrant key so it uses it on next start
  gcloud compute instances add-metadata "$VM_NAME" --zone="$ZONE" --project="$PROJECT" \
    --metadata="qdrant-api-key=${QDRANT_API_KEY}"

  SECRET_JSON=$(printf '{"QDRANT_API_KEY":"%s","QDRANT_URL":"%s"}' \
    "$QDRANT_API_KEY" "http://${INTERNAL_IP}:6333")
  [[ -n "$CONFLUENCE_BASE_URL"    ]] && SECRET_JSON=$(json_set "$SECRET_JSON" CONFLUENCE_BASE_URL    "$CONFLUENCE_BASE_URL")
  [[ -n "$CONFLUENCE_EMAIL"       ]] && SECRET_JSON=$(json_set "$SECRET_JSON" CONFLUENCE_EMAIL       "$CONFLUENCE_EMAIL")
  [[ -n "$CONFLUENCE_API_TOKEN"   ]] && SECRET_JSON=$(json_set "$SECRET_JSON" CONFLUENCE_API_TOKEN   "$CONFLUENCE_API_TOKEN")
  [[ -n "$JIRA_BASE_URL"          ]] && SECRET_JSON=$(json_set "$SECRET_JSON" JIRA_BASE_URL          "$JIRA_BASE_URL")
  [[ -n "$JIRA_EMAIL"             ]] && SECRET_JSON=$(json_set "$SECRET_JSON" JIRA_EMAIL             "$JIRA_EMAIL")
  [[ -n "$JIRA_API_TOKEN"         ]] && SECRET_JSON=$(json_set "$SECRET_JSON" JIRA_API_TOKEN         "$JIRA_API_TOKEN")
  [[ -n "$JIRA_PROJECT_KEY"       ]] && SECRET_JSON=$(json_set "$SECRET_JSON" JIRA_PROJECT_KEY       "$JIRA_PROJECT_KEY")
  [[ -n "$SHAREPOINT_TENANT_ID"   ]] && SECRET_JSON=$(json_set "$SECRET_JSON" SHAREPOINT_TENANT_ID   "$SHAREPOINT_TENANT_ID")
  [[ -n "$SHAREPOINT_CLIENT_ID"   ]] && SECRET_JSON=$(json_set "$SECRET_JSON" SHAREPOINT_CLIENT_ID   "$SHAREPOINT_CLIENT_ID")
  [[ -n "$SHAREPOINT_CLIENT_SECRET" ]] && SECRET_JSON=$(json_set "$SECRET_JSON" SHAREPOINT_CLIENT_SECRET "$SHAREPOINT_CLIENT_SECRET")
  [[ -n "$SHAREPOINT_SITE_ID"     ]] && SECRET_JSON=$(json_set "$SECRET_JSON" SHAREPOINT_SITE_ID     "$SHAREPOINT_SITE_ID")

  echo "$SECRET_JSON" | gcloud secrets create "$SECRET" --project="$PROJECT" --data-file=-

  echo "    Secret created. Run add-workspace.js to register teams."
else
  echo "    Already exists, updating connector credentials..."
  CONFIG=$(gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT")
  QDRANT_API_KEY=$(json_get "$CONFIG" QDRANT_API_KEY)

  [[ -n "$CONFLUENCE_BASE_URL"    ]] && CONFIG=$(json_set "$CONFIG" CONFLUENCE_BASE_URL    "$CONFLUENCE_BASE_URL")
  [[ -n "$CONFLUENCE_EMAIL"       ]] && CONFIG=$(json_set "$CONFIG" CONFLUENCE_EMAIL       "$CONFLUENCE_EMAIL")
  [[ -n "$CONFLUENCE_API_TOKEN"   ]] && CONFIG=$(json_set "$CONFIG" CONFLUENCE_API_TOKEN   "$CONFLUENCE_API_TOKEN")
  [[ -n "$JIRA_BASE_URL"          ]] && CONFIG=$(json_set "$CONFIG" JIRA_BASE_URL          "$JIRA_BASE_URL")
  [[ -n "$JIRA_EMAIL"             ]] && CONFIG=$(json_set "$CONFIG" JIRA_EMAIL             "$JIRA_EMAIL")
  [[ -n "$JIRA_API_TOKEN"         ]] && CONFIG=$(json_set "$CONFIG" JIRA_API_TOKEN         "$JIRA_API_TOKEN")
  [[ -n "$JIRA_PROJECT_KEY"       ]] && CONFIG=$(json_set "$CONFIG" JIRA_PROJECT_KEY       "$JIRA_PROJECT_KEY")
  [[ -n "$SHAREPOINT_TENANT_ID"   ]] && CONFIG=$(json_set "$CONFIG" SHAREPOINT_TENANT_ID   "$SHAREPOINT_TENANT_ID")
  [[ -n "$SHAREPOINT_CLIENT_ID"   ]] && CONFIG=$(json_set "$CONFIG" SHAREPOINT_CLIENT_ID   "$SHAREPOINT_CLIENT_ID")
  [[ -n "$SHAREPOINT_CLIENT_SECRET" ]] && CONFIG=$(json_set "$CONFIG" SHAREPOINT_CLIENT_SECRET "$SHAREPOINT_CLIENT_SECRET")
  [[ -n "$SHAREPOINT_SITE_ID"     ]] && CONFIG=$(json_set "$CONFIG" SHAREPOINT_SITE_ID     "$SHAREPOINT_SITE_ID")

  echo "$CONFIG" | gcloud secrets versions add "$SECRET" --project="$PROJECT" --data-file=-
  echo "    Done."
fi

# ── Step 3: VPC connector (skipped if already exists) ─────────────────────────
echo "==> VPC connector"
gcloud compute networks vpc-access connectors describe "$CONNECTOR" \
  --region="$REGION" --project="$PROJECT" &>/dev/null \
  || gcloud compute networks vpc-access connectors create "$CONNECTOR" \
       --region="$REGION" --project="$PROJECT" \
       --network="$NETWORK" --range=10.8.0.0/28 \
       --min-instances=2 --max-instances=10
echo "    Ready."

# ── Step 4: IAM — Cloud Run SA needs Vertex AI access ────────────────────────
echo "==> IAM"
CR_SA="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"-compute@developer.gserviceaccount.com
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${CR_SA}" \
  --role="roles/aiplatform.user" \
  --condition=None \
  --quiet 2>&1 | grep -E "Updated|already" || true
echo "    aiplatform.user granted to $CR_SA"

# ── Step 5: Artifact Registry (skipped if already exists) ─────────────────────
echo "==> Artifact Registry"
gcloud artifacts repositories describe "$REPO" \
  --location="$REGION" --project="$PROJECT" &>/dev/null \
  || gcloud artifacts repositories create "$REPO" \
       --repository-format=docker --location="$REGION" --project="$PROJECT"

# ── Step 6: Build + push ──────────────────────────────────────────────────────
echo "==> Docker build + push"
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
docker build --platform linux/amd64 -t "${IMAGE}:latest" .
docker push "${IMAGE}:latest"

# ── Step 7: Deploy to Cloud Run ───────────────────────────────────────────────
echo "==> Cloud Run deploy"
CONFIG=$(gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT")
QDRANT_URL=$(json_get "$CONFIG" QDRANT_URL)
QDRANT_API_KEY=$(json_get "$CONFIG" QDRANT_API_KEY)

# WORKSPACES_JSON is a JSON array stored as a string in the secret's "workspaces" key.
# We use the ^|^ gcloud delimiter so commas inside the JSON value are not treated as
# env-var separators.
WORKSPACES_JSON=$(json_get "$CONFIG" workspaces)

# Build all env vars using | as delimiter so WORKSPACES_JSON (which contains commas)
# is passed safely in a single --set-env-vars call.
ENV_VARS="GOOGLE_CLOUD_PROJECT=${PROJECT}|GOOGLE_CLOUD_LOCATION=${REGION}|QDRANT_URL=${QDRANT_URL}|QDRANT_API_KEY=${QDRANT_API_KEY}"

_cf_url=$(json_get "$CONFIG" CONFLUENCE_BASE_URL);  [[ -n "$_cf_url"  ]] && ENV_VARS="${ENV_VARS}|CONFLUENCE_BASE_URL=${_cf_url}"
_cf_em=$(json_get "$CONFIG" CONFLUENCE_EMAIL);      [[ -n "$_cf_em"   ]] && ENV_VARS="${ENV_VARS}|CONFLUENCE_EMAIL=${_cf_em}"
_cf_tok=$(json_get "$CONFIG" CONFLUENCE_API_TOKEN); [[ -n "$_cf_tok"  ]] && ENV_VARS="${ENV_VARS}|CONFLUENCE_API_TOKEN=${_cf_tok}"
_ji_url=$(json_get "$CONFIG" JIRA_BASE_URL);        [[ -n "$_ji_url"  ]] && ENV_VARS="${ENV_VARS}|JIRA_BASE_URL=${_ji_url}"
_ji_em=$(json_get "$CONFIG" JIRA_EMAIL);            [[ -n "$_ji_em"   ]] && ENV_VARS="${ENV_VARS}|JIRA_EMAIL=${_ji_em}"
_ji_tok=$(json_get "$CONFIG" JIRA_API_TOKEN);       [[ -n "$_ji_tok"  ]] && ENV_VARS="${ENV_VARS}|JIRA_API_TOKEN=${_ji_tok}"
_ji_pk=$(json_get "$CONFIG" JIRA_PROJECT_KEY);      [[ -n "$_ji_pk"   ]] && ENV_VARS="${ENV_VARS}|JIRA_PROJECT_KEY=${_ji_pk}"
_sp_tid=$(json_get "$CONFIG" SHAREPOINT_TENANT_ID); [[ -n "$_sp_tid"  ]] && ENV_VARS="${ENV_VARS}|SHAREPOINT_TENANT_ID=${_sp_tid}"
_sp_cid=$(json_get "$CONFIG" SHAREPOINT_CLIENT_ID); [[ -n "$_sp_cid"  ]] && ENV_VARS="${ENV_VARS}|SHAREPOINT_CLIENT_ID=${_sp_cid}"
_sp_cs=$(json_get "$CONFIG" SHAREPOINT_CLIENT_SECRET); [[ -n "$_sp_cs" ]] && ENV_VARS="${ENV_VARS}|SHAREPOINT_CLIENT_SECRET=${_sp_cs}"
_sp_si=$(json_get "$CONFIG" SHAREPOINT_SITE_ID);    [[ -n "$_sp_si"   ]] && ENV_VARS="${ENV_VARS}|SHAREPOINT_SITE_ID=${_sp_si}"
[[ -n "$WORKSPACES_JSON" ]] && ENV_VARS="${ENV_VARS}|WORKSPACES_JSON=${WORKSPACES_JSON}"

gcloud run deploy "$SERVICE" \
  --image="${IMAGE}:latest" \
  --region="$REGION" --project="$PROJECT" \
  --platform=managed \
  --allow-unauthenticated \
  --min-instances=0 --max-instances=2 \
  --memory=1Gi --cpu=1 --port=3000 \
  --set-env-vars="^|^${ENV_VARS}" \
  --vpc-connector="$CONNECTOR" \
  --vpc-egress=private-ranges-only \
  --quiet

echo ""
echo "==> Done."
gcloud run services describe "$SERVICE" --region="$REGION" --project="$PROJECT" \
  --format="value(status.url)"
