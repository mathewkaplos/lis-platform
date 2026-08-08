#!/usr/bin/env bash
###############################################################################
# import-to-github.sh
#
# Imports every Epic, Feature, and Task in github/issues/ as a native GitHub
# Issue, creates the required labels and milestones, links dependencies as
# real issue references, and adds every issue to a GitHub Project with its
# custom fields populated.
#
# REQUIREMENTS
#   - GitHub CLI (`gh`) installed and authenticated: gh auth login
#   - `jq` installed (for reading manifest.json)
#   - Run from the ROOT of the repository that will own these issues
#     (the script expects github/issues/manifest.json relative to CWD)
#
# USAGE
#   ./github/import-to-github.sh <owner>/<repo> [--project "LIS Roadmap"] [--dry-run]
#
# EXAMPLE
#   ./github/import-to-github.sh yourorg/lis-platform --project "LIS Roadmap"
#
# WHAT IT DOES, IN ORDER
#   1. Verifies gh/jq are present and gh is authenticated
#   2. Creates all labels used across the backlog (idempotent)
#   3. Creates GitHub Milestones M0..M10 (idempotent)
#   4. Creates a GitHub Project (v2) if it doesn't already exist, and the
#      custom fields: Type, Backlog ID, Priority, Effort, Area, Status
#   5. Creates issues in dependency order: Epics -> Features -> Tasks, so that
#      a dependency reference can always be resolved to a real issue number
#   6. Rewrites each issue body's `<!-- gh-issue-ref:ID -->` markers into real
#      "Depends on #123" links once the referenced issue exists
#   7. Adds every created issue to the Project and sets its custom fields
#   8. Writes github/issues/import-map.json mapping backlog ID -> issue number,
#      so the script is safely re-runnable (it skips IDs already imported)
#
# SAFETY
#   - Idempotent: re-running skips any backlog ID already present in
#     github/issues/import-map.json
#   - --dry-run prints every gh command it WOULD run without executing them
###############################################################################

set -euo pipefail

REPO=""
PROJECT_NAME="LIS Roadmap"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT_NAME="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) REPO="$1"; shift ;;
  esac
done

if [[ -z "$REPO" ]]; then
  echo "Usage: $0 <owner>/<repo> [--project \"Project Name\"] [--dry-run]"
  exit 1
fi

ISSUES_DIR="github/issues"
MANIFEST="$ISSUES_DIR/manifest.json"
MAP_FILE="$ISSUES_DIR/import-map.json"

# close Skill's Engineering Flow Retrospective (session 2026-08-08, Finding
# A): populate_fields (Step 6) used to re-fetch gh project field-list/
# item-list for every item in the whole manifest on every run, not just
# items actually created this run -- idempotent for issue *creation*, but
# not for field population, so a 3-issue kickoff burned GraphQL calls for
# the entire ~130-item backlog and exhausted the shared 5,000/hr quota,
# blocking gh pr create/checks/merge for the rest of that session. Track
# which IDs create_one_issue actually creates *this invocation* here, and
# have populate_fields only process those.
NEW_IDS_FILE=$(mktemp)
trap 'rm -f "$NEW_IDS_FILE"' EXIT

for bin in gh jq; do
  command -v "$bin" >/dev/null 2>&1 || { echo "ERROR: '$bin' is required but not installed."; exit 1; }
done
[[ -f "$MANIFEST" ]] || { echo "ERROR: $MANIFEST not found. Run this script from the repo root."; exit 1; }

gh auth status >/dev/null 2>&1 || { echo "ERROR: gh is not authenticated. Run: gh auth login"; exit 1; }

[[ -f "$MAP_FILE" ]] || echo '{}' > "$MAP_FILE"

# Self-heal: an older/buggy run may have written placeholder "0" values (a bug fixed in
# this version — dry-run should never have persisted anything). Strip any such entries
# so those IDs are correctly treated as not-yet-imported rather than skipped forever.
HEALED_TMP=$(mktemp)
jq 'with_entries(select(.value != 0))' "$MAP_FILE" > "$HEALED_TMP" && mv "$HEALED_TMP" "$MAP_FILE"

run() {
  if $DRY_RUN; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

echo "=== Importing backlog into $REPO (project: \"$PROJECT_NAME\") ==="
$DRY_RUN && echo "*** DRY RUN MODE — no changes will be made ***"

###############################################################################
# 1. Labels
###############################################################################
echo ""
echo "--- Step 1/6: Creating labels ---"

declare -A LABEL_COLORS=(
  ["type:epic"]="5319E7"       ["type:feature"]="0E8A16"     ["type:task"]="1D76DB"
  ["priority:critical"]="B60205" ["priority:high"]="D93F0B"  ["priority:medium"]="FBCA04" ["priority:low"]="C2E0C6"
  ["area:backend"]="006B75"    ["area:frontend"]="BFD4F2"    ["area:db"]="5D4037"
  ["area:infra"]="C5DEF5"      ["area:ai"]="7B42BC"           ["area:design"]="F9D0C4"
  ["area:fullstack"]="1D76DB"
  ["roadmap"]="0052CC"         ["invariant-risk"]="B60205"    ["needs-clinical-review"]="D4C5F9"
  ["blocked"]="000000"
)
# milestone:m0 .. milestone:m10
for i in $(seq 0 10); do LABEL_COLORS["milestone:m$i"]="EDEDED"; done
# size:s / size:m / size:l
LABEL_COLORS["size:s"]="C2E0C6"; LABEL_COLORS["size:m"]="FEF2C0"; LABEL_COLORS["size:l"]="F9C2C2"

for label in "${!LABEL_COLORS[@]}"; do
  color="${LABEL_COLORS[$label]}"
  run gh label create "$label" --repo "$REPO" --color "$color" --force
done
echo "Labels created/updated: ${#LABEL_COLORS[@]}"

###############################################################################
# 2. Milestones M0..M10
###############################################################################
echo ""
echo "--- Step 2/6: Creating milestones M0-M10 ---"

declare -A MILESTONE_DESC=(
  ["M0"]="Foundation & Walking Skeleton"
  ["M1"]="Domain Core & Database Spine"
  ["M2"]="Identity, Tenancy, AuthZ + Design System"
  ["M3"]="Pre-Analytical Workflow"
  ["M4"]="Chemistry Result Loop (thesis milestone)"
  ["M5"]="Make It Dependable (QC, criticals, Haematology)"
  ["M6"]="Automate (analyzer + workflow engine)"
  ["M7"]="Configure & Report (template engine, reporting)"
  ["M8"]="Connect (HL7, FHIR, portals)"
  ["M9"]="Governed AI"
  ["M10"]="Commercial Readiness"
)

EXISTING_MILESTONES=$(gh api "repos/$REPO/milestones?state=all" --jq '.[].title' 2>/dev/null || echo "")

for ms in M0 M1 M2 M3 M4 M5 M6 M7 M8 M9 M10; do
  title="$ms — ${MILESTONE_DESC[$ms]}"
  if echo "$EXISTING_MILESTONES" | grep -qF "$title"; then
    echo "  milestone '$title' already exists, skipping"
  elif $DRY_RUN; then
    echo "  [dry-run] gh api repos/$REPO/milestones -f title=\"$title\" -f description=\"${MILESTONE_DESC[$ms]}\""
  else
    gh api "repos/$REPO/milestones" -f title="$title" -f description="${MILESTONE_DESC[$ms]}" >/dev/null
    echo "  created milestone: $title"
  fi
done

###############################################################################
# 3. GitHub Project (v2) + custom fields
###############################################################################
echo ""
echo "--- Step 3/6: Creating/locating GitHub Project \"$PROJECT_NAME\" ---"

OWNER="${REPO%%/*}"

# gh project commands require the separate 'project' OAuth scope, which
# `gh auth login` does NOT request by default. Check explicitly and fail
# LOUDLY with the exact fix, rather than letting `set -e` exit silently
# on a permissions error swallowed by a redirected stderr.
PROJECT_LIST_OUTPUT=""
PROJECT_LIST_ERR=""
set +e
PROJECT_LIST_OUTPUT=$(gh project list --owner "$OWNER" --format json 2>/tmp/gh_project_err.$$)
PROJECT_LIST_STATUS=$?
PROJECT_LIST_ERR=$(cat /tmp/gh_project_err.$$ 2>/dev/null); rm -f /tmp/gh_project_err.$$
set -e

if [[ $PROJECT_LIST_STATUS -ne 0 ]]; then
  echo ""
  echo "ERROR: 'gh project list' failed (exit $PROJECT_LIST_STATUS)."
  echo "--- gh said: ---"
  echo "$PROJECT_LIST_ERR"
  echo "----------------"
  if echo "$PROJECT_LIST_ERR" | grep -qi "scope"; then
    echo ""
    echo "This is almost always a missing OAuth scope. GitHub Projects (v2) needs the"
    echo "'project' scope, which 'gh auth login' does not request by default. Fix with:"
    echo ""
    echo "    gh auth refresh -h github.com -s project"
    echo ""
    echo "Then re-run this script (it is safe to re-run; already-created labels and"
    echo "milestones will simply be skipped or updated in place)."
  fi
  exit 1
fi

PROJECT_NUMBER=$(echo "$PROJECT_LIST_OUTPUT" | jq -r --arg name "$PROJECT_NAME" '.projects[] | select(.title==$name) | .number' | head -1)

if [[ -z "$PROJECT_NUMBER" ]]; then
  echo "  Project not found, creating it..."
  if ! $DRY_RUN; then
    PROJECT_NUMBER=$(gh project create --owner "$OWNER" --title "$PROJECT_NAME" --format json | jq -r '.number')
    echo "  created project #$PROJECT_NUMBER"
  else
    PROJECT_NUMBER="<new>"
    echo "  [dry-run] gh project create --owner $OWNER --title \"$PROJECT_NAME\""
  fi
else
  echo "  found existing project #$PROJECT_NUMBER"
fi

# Custom fields: Type (single select), Backlog ID (text), Priority (single select),
# Effort (text), Area (single select), Milestone (text), Status (single select)
if ! $DRY_RUN; then
  gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" --name "Type" \
    --data-type SINGLE_SELECT --single-select-options "Epic,Feature,Task" >/dev/null 2>&1 || true
  gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" --name "Backlog ID" \
    --data-type TEXT >/dev/null 2>&1 || true
  gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" --name "Priority" \
    --data-type SINGLE_SELECT --single-select-options "Critical,High,Medium,Low" >/dev/null 2>&1 || true
  gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" --name "Effort" \
    --data-type TEXT >/dev/null 2>&1 || true
  gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" --name "Area" \
    --data-type SINGLE_SELECT --single-select-options "backend,frontend,db,infra,ai,design,fullstack" >/dev/null 2>&1 || true
  gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" --name "Status" \
    --data-type SINGLE_SELECT --single-select-options "Not Started,Ready,In Progress,In Review,Done,Blocked" >/dev/null 2>&1 || true
fi
echo "  custom fields ensured: Type, Backlog ID, Priority, Effort, Area, Status"

###############################################################################
# 4. Create issues in dependency order: Epics -> Features -> Tasks
###############################################################################
echo ""
echo "--- Step 4/6: Creating issues (Epics -> Features -> Tasks) ---"

# Extract the body of an issue file (everything after the closing '---' of frontmatter)
extract_body() {
  awk 'BEGIN{n=0} /^---$/{n++; next} n>=2{print}' "$1"
}

# Resolve a backlog ID (e.g. FEAT-014) to a real GitHub issue number via the map file.
# Treats a mapped value of "0" or missing/null as NOT imported — this makes the script
# self-healing if a map file was ever corrupted (e.g. by a bug that wrote placeholder 0s).
resolve_number() {
  local val
  val=$(jq -r --arg id "$1" '.[$id] // empty' "$MAP_FILE")
  if [[ -z "$val" || "$val" == "0" ]]; then
    echo ""
  else
    echo "$val"
  fi
}

record_mapping() {
  local id="$1" number="$2"
  # Never persist a placeholder/invalid number, and NEVER write anything during a dry
  # run — dry-run must have zero effect on disk state.
  if $DRY_RUN || [[ -z "$number" || "$number" == "0" ]]; then
    return
  fi
  tmp=$(mktemp)
  jq --arg id "$id" --arg num "$number" '.[$id] = ($num | tonumber)' "$MAP_FILE" > "$tmp" && mv "$tmp" "$MAP_FILE"
}

create_one_issue() {
  local id="$1" title="$2" file="$3" milestone="$4"
  shift 4
  local labels=("$@")

  existing=$(resolve_number "$id")
  if [[ -n "$existing" ]]; then
    echo "  [$id] already imported as issue #$existing, skipping"
    return
  fi

  local label_args=()
  for l in "${labels[@]}"; do label_args+=(--label "$l"); done

  local body
  body="$(extract_body "$file")"

  echo "  [$id] creating issue: $title"
  if $DRY_RUN; then
    echo "    [dry-run] gh issue create --repo $REPO --title \"$id: $title\" --milestone \"$milestone\" ${label_args[*]}"
    # Intentionally NOT calling record_mapping here — dry-run must never touch the map file.
  else
    url=$(gh issue create --repo "$REPO" --title "$id: $title" --body "$body" \
          --milestone "$milestone" "${label_args[@]}")
    number=$(basename "$url")
    record_mapping "$id" "$number"
    echo "$id" >> "$NEW_IDS_FILE"

    # Add to project
    gh project item-add "$PROJECT_NUMBER" --owner "$OWNER" --url "$url" >/dev/null 2>&1 || true
  fi
}

# --- Epics ---
jq -c '.epics[]' "$MANIFEST" | while read -r row; do
  id=$(jq -r '.id' <<<"$row"); title=$(jq -r '.title' <<<"$row"); file=$(jq -r '.file' <<<"$row")
  ms=$(jq -r '.milestone' <<<"$row"); pr=$(jq -r '.priority' <<<"$row")
  ms_title="$ms — ${MILESTONE_DESC[$ms]:-}"
  create_one_issue "$id" "$title" "$file" "$ms_title" "type:epic" "priority:${pr,,}" "roadmap"
done

# --- Features ---
jq -c '.features[]' "$MANIFEST" | while read -r row; do
  id=$(jq -r '.id' <<<"$row"); title=$(jq -r '.title' <<<"$row"); file=$(jq -r '.file' <<<"$row")
  ms=$(jq -r '.milestone' <<<"$row"); pr=$(jq -r '.priority' <<<"$row"); area=$(jq -r '.area' <<<"$row")
  ms_title="$ms — ${MILESTONE_DESC[$ms]:-}"
  create_one_issue "$id" "$title" "$file" "$ms_title" "type:feature" "priority:${pr,,}" "area:${area,,}" "milestone:${ms,,}"
done

# --- Tasks ---
jq -c '.tasks[]' "$MANIFEST" | while read -r row; do
  id=$(jq -r '.id' <<<"$row"); title=$(jq -r '.title' <<<"$row"); file=$(jq -r '.file' <<<"$row")
  ms=$(jq -r '.milestone' <<<"$row"); pr=$(jq -r '.priority' <<<"$row"); area=$(jq -r '.area' <<<"$row")
  size=$(jq -r '.size' <<<"$row")
  size_letter=$(echo "$size" | cut -c1 | tr '[:upper:]' '[:lower:]')
  ms_title="$ms — ${MILESTONE_DESC[$ms]:-}"
  create_one_issue "$id" "$title" "$file" "$ms_title" "type:task" "priority:${pr,,}" "area:${area,,}" "milestone:${ms,,}" "size:${size_letter}"
done

###############################################################################
# 5. Rewrite dependency markers into real issue links (issue body edit)
###############################################################################
echo ""
echo "--- Step 5/6: Linking dependencies between issues ---"

link_dependencies() {
  local kind="$1"   # epics | features | tasks
  jq -c ".$kind[]" "$MANIFEST" | while read -r row; do
    id=$(jq -r '.id' <<<"$row")
    deps=$(jq -r '.deps[]?' <<<"$row")
    [[ -z "$deps" ]] && continue

    self_number=$(resolve_number "$id")
    [[ -z "$self_number" ]] && continue

    if $DRY_RUN; then
      echo "  [$id -> #$self_number] would link deps: $deps"
      continue
    fi

    current_body=$(gh issue view "$self_number" --repo "$REPO" --json body -q '.body')
    new_body="$current_body"
    for dep in $deps; do
      dep_number=$(resolve_number "$dep")
      if [[ -n "$dep_number" ]]; then
        new_body=$(echo "$new_body" | sed "s|<!-- gh-issue-ref:${dep} -->|(#${dep_number})|g")
      fi
    done
    if [[ "$new_body" != "$current_body" ]]; then
      gh issue edit "$self_number" --repo "$REPO" --body "$new_body" >/dev/null
      echo "  [$id -> #$self_number] dependency links resolved"
    fi
  done
}

link_dependencies "epics"
link_dependencies "features"
link_dependencies "tasks"

###############################################################################
# 6. Populate Project custom fields for every imported item
###############################################################################
echo ""
echo "--- Step 6/6: Populating Project custom fields ---"

if ! $DRY_RUN; then
  FIELD_TYPE_ID=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json | jq -r '.fields[] | select(.name=="Type") | .id')
  FIELD_ID_ID=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json | jq -r '.fields[] | select(.name=="Backlog ID") | .id')
  FIELD_PRIORITY_ID=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json | jq -r '.fields[] | select(.name=="Priority") | .id')
  FIELD_EFFORT_ID=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json | jq -r '.fields[] | select(.name=="Effort") | .id')
  FIELD_AREA_ID=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json | jq -r '.fields[] | select(.name=="Area") | .id')
  FIELD_STATUS_ID=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json | jq -r '.fields[] | select(.name=="Status") | .id')
fi

populate_fields() {
  local kind="$1" type_value="$2"
  jq -c ".$kind[]" "$MANIFEST" | while read -r row; do
    id=$(jq -r '.id' <<<"$row"); pr=$(jq -r '.priority' <<<"$row")
    area=$(jq -r '.area // "n/a"' <<<"$row"); effort=$(jq -r '.effort // .size // "n/a"' <<<"$row")
    number=$(resolve_number "$id")
    [[ -z "$number" ]] && continue
    # Only items actually created THIS run -- an item already imported (and
    # therefore already field-populated) in a prior run is skipped here, not
    # re-fetched/re-edited. See this file's own NEW_IDS_FILE comment above.
    # Dry-run note: NEW_IDS_FILE is only ever populated on a real run (dry-run
    # never resolves a real issue number to preview field-population against
    # anyway, per create_one_issue's own dry-run branch), so dry-run mode
    # prints no "would set project fields" lines -- an accepted, honest gap
    # in dry-run's own preview fidelity, not a functional regression on a
    # real run.
    grep -qxF "$id" "$NEW_IDS_FILE" || continue
    if $DRY_RUN; then
      echo "  [$id] would set project fields: Type=$type_value Priority=$pr Area=$area Effort=$effort"
      continue
    fi
    item_id=$(gh project item-list "$PROJECT_NUMBER" --owner "$OWNER" --format json \
              | jq -r --arg n "$number" '.items[] | select(.content.number==($n|tonumber)) | .id')
    [[ -z "$item_id" ]] && continue

    gh project item-edit --project-id "$PROJECT_NUMBER" --id "$item_id" --field-id "$FIELD_ID_ID" --text "$id" >/dev/null 2>&1 || true
    gh project item-edit --project-id "$PROJECT_NUMBER" --id "$item_id" --field-id "$FIELD_EFFORT_ID" --text "$effort" >/dev/null 2>&1 || true
    # single-select fields require the option id; look it up by name each time (cheap for 121 items)
    type_opt=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json | jq -r --arg f "Type" --arg v "$type_value" '.fields[] | select(.name==$f) | .options[]? | select(.name==$v) | .id')
    [[ -n "$type_opt" ]] && gh project item-edit --project-id "$PROJECT_NUMBER" --id "$item_id" --field-id "$FIELD_TYPE_ID" --single-select-option-id "$type_opt" >/dev/null 2>&1 || true
    pr_opt=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json | jq -r --arg f "Priority" --arg v "$pr" '.fields[] | select(.name==$f) | .options[]? | select(.name==$v) | .id')
    [[ -n "$pr_opt" ]] && gh project item-edit --project-id "$PROJECT_NUMBER" --id "$item_id" --field-id "$FIELD_PRIORITY_ID" --single-select-option-id "$pr_opt" >/dev/null 2>&1 || true

    echo "  [$id] project fields populated"
  done
}

populate_fields "epics" "Epic"
populate_fields "features" "Feature"
populate_fields "tasks" "Task"

echo ""
echo "=== Import complete ==="
echo "Mapping of backlog ID -> issue number written to: $MAP_FILE"
echo "Re-run this script any time; already-imported IDs are skipped automatically."
