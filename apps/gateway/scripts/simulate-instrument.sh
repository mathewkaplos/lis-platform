#!/usr/bin/env bash
# Analyzer-integration simulator (world-class-roadmap-2026-09 Decision 1,
# option (a) as approved by Mathew: "JSON simulator via the real gateway").
#
# What this proves that the existing gateway-ingest.e2e-spec.ts does NOT:
# that spec posts straight to apps/api's internal endpoint
# (POST /internal/gateway/ingest), skipping the real edge hop entirely.
# This script drives the REAL apps/gateway edge service's public
# POST /ingest (port 4100 by default) -- the actual local durable queue
# (LocalQueueService) and the actual ForwarderService polling loop that
# delivers to apps/api -- the same path this session's one earlier manual
# proof exercised once. This script repeats that proof across three varied
# analytes plus the two negative paths (unmatched specimen, duplicate
# replay), all through the real edge pipeline, not just the internal
# endpoint.
#
# Explicitly NOT claimed by this script: hardware-proven analyzer
# integration. No real or simulated analyzer protocol (HL7, ASTM) is
# involved -- apps/gateway's own POST /ingest is a JSON-only ingestion
# port by design (see apps/gateway/src/ingest/ingest.controller.ts's own
# comment: "the common ingestion port every instrument driver calls").
# This is "analyzer-integration pipeline proven repeatedly in local dev,"
# nothing more.
#
# Requires: docker (postgres running as lis-platform-postgres-1), apps/api
# on :4000 and apps/gateway on :4100 both already running (pnpm dev),
# psql and curl on PATH. Dev-only -- never point APP_DATABASE_URL at
# staging/production.
set -euo pipefail

TENANT_A="00000000-0000-0000-0000-000000000001"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:4100}"
PG_CONTAINER="${PG_CONTAINER:-lis-platform-postgres-1}"
RUN_TAG="SIM-$(date +%s)"

psql() {
  # -t/-A alone don't suppress the "INSERT 0 1"-style command tag that
  # follows a `returning` row when invoked via -c in this psql version --
  # `head -1` takes just the returned value itself.
  docker exec -i "$PG_CONTAINER" psql -U postgres -d lis -v ON_ERROR_STOP=1 -tA "$@" | head -1
}

echo "== 1. Seeding fixtures (tag=$RUN_TAG) =="

# One patient + order shared across the 3 analytes, mirroring
# gateway-ingest.e2e-spec.ts's createCorrelatableFixture() pattern.
PATIENT_ID=$(psql -c "
  insert into patient (tenant_id, mrn, first_name, last_name, sex)
  values ('$TENANT_A', '$RUN_TAG-MRN', 'Simulated', 'Instrument', 'U')
  returning id;")
ORDER_ID=$(psql -c "
  insert into \"order\" (tenant_id, patient_id)
  values ('$TENANT_A', '$PATIENT_ID')
  returning id;")

declare -a CODES=(GLU NA K)
declare -a VALUES=(5.4 140 4.2)
declare -A ACCESSION
declare -A INSTRUMENT
declare -A CHANNEL

for i in "${!CODES[@]}"; do
  code="${CODES[$i]}"
  instrument_id="SIM-ANALYZER-$RUN_TAG-$i"
  channel_code="SIM-CH-$RUN_TAG-$code"

  test_def_id=$(psql -c "select id from test_definition where tenant_id='$TENANT_A' and code='$code';")
  analyte_id=$(psql -c "select a.id from analyte a join test_analyte ta on ta.analyte_id=a.id where ta.test_definition_id='$test_def_id';")
  unit_id=$(psql -c "select default_unit_id from analyte where id='$analyte_id';")

  ordered_test_id=$(psql -c "
    insert into ordered_test (tenant_id, order_id, test_definition_id, status)
    values ('$TENANT_A', '$ORDER_ID', '$test_def_id', 'received')
    returning id;")
  accession="SIM-ACC-$RUN_TAG-$code"
  specimen_id=$(psql -c "
    insert into specimen (tenant_id, accession_number, specimen_type, status)
    values ('$TENANT_A', '$accession', 'blood_edta', 'received')
    returning id;")
  psql -c "
    insert into specimen_fulfillment (tenant_id, specimen_id, ordered_test_id)
    values ('$TENANT_A', '$specimen_id', '$ordered_test_id');" >/dev/null

  psql -c "
    insert into instrument_analyte_mapping
      (tenant_id, instrument_id, channel_code, analyte_id, unit_id, conversion_factor, status)
    values
      ('$TENANT_A', '$instrument_id', '$channel_code', '$analyte_id', '$unit_id', 1, 'published');" >/dev/null

  ACCESSION[$code]="$accession"
  INSTRUMENT[$code]="$instrument_id"
  CHANNEL[$code]="$channel_code"
  echo "  seeded $code: instrument=$instrument_id channel=$channel_code accession=$accession"
done

echo "== 2. Posting realistic raw results to the real gateway edge ($GATEWAY_URL/ingest) =="

post_result() {
  local instrument="$1" specimen="$2" channel="$3" value="$4" run="$5"
  curl -s -o /dev/null -w "  POST %{http_code} instrument=$instrument channel=$channel value=$value\n" \
    -X POST "$GATEWAY_URL/ingest" \
    -H 'Content-Type: application/json' \
    -d "{\"instrumentId\":\"$instrument\",\"specimenId\":\"$specimen\",\"analyte\":\"$channel\",\"runId\":\"$run\",\"value\":$value,\"unit\":\"n/a\",\"flag\":\"N\",\"rawPayload\":\"SIM|$instrument|$channel|$value\"}"
}

for i in "${!CODES[@]}"; do
  code="${CODES[$i]}"
  post_result "${INSTRUMENT[$code]}" "${ACCESSION[$code]}" "${CHANNEL[$code]}" "${VALUES[$i]}" "$RUN_TAG-$code-1"
done

echo "  -- negative path: unmatched specimen (KB-29 'park, never drop') --"
post_result "${INSTRUMENT[GLU]}" "SIM-DOES-NOT-EXIST-$RUN_TAG" "${CHANNEL[GLU]}" 9.9 "$RUN_TAG-unmatched"

echo "  -- negative path: duplicate replay (same runId, should not double-write) --"
post_result "${INSTRUMENT[NA]}" "${ACCESSION[NA]}" "${CHANNEL[NA]}" 140 "$RUN_TAG-NA-1"

echo "== 3. Waiting for ForwarderService's poll interval (GATEWAY_FORWARD_INTERVAL_MS, default 2000ms) =="
sleep 5

echo "== 4. Verifying via direct DB query =="
for code in "${CODES[@]}"; do
  row=$(psql -c "
    select o.status, o.value_num, o.source, o.source_idempotency_key
    from observation o
    join ordered_test ot on o.ordered_test_id = ot.id
    join specimen_fulfillment sf on sf.ordered_test_id = ot.id
    join specimen s on sf.specimen_id = s.id
    where s.accession_number = '${ACCESSION[$code]}';")
  echo "  $code -> $row"
done

dup_count=$(psql -c "
  select count(*) from observation
  where source_idempotency_key like '%${INSTRUMENT[NA]}%${ACCESSION[NA]}%${CHANNEL[NA]}%';")
echo "  duplicate-replay: $dup_count observation(s) for the replayed key (expect 1, not 2)"

echo "== Done. This proves the real edge->queue->forward->correlate->write pipeline"
echo "   repeatedly, with varied analytes and both negative paths, in local dev."
echo "   Still local-dev-only, still manually triggered, still no real analyzer"
echo "   hardware/protocol involved -- Level 3 (Integrated), not Level 4/5."
