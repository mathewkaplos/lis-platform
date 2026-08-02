# Implementation Proposal: Commit unmanagedAttributePolicy into lis-realm.json
Status: APPROVED (revised during implementation, see §11)
ADR: none (config-drift fix, not a new architectural decision)    Date: 2026-08-02    Backlog ID: #256

## 1. Goal
Close the gap in #256: `unmanagedAttributePolicy: "ENABLED"` is required on the
realm's User Profile config for the custom `tenant_id` attribute to survive
any live write — discovered during session 10's FEAT-009 staging
verification (`authentication` Skill, lis-engineering, entries #7-#10).
Without it, Keycloak's declarative User Profile silently drops `tenant_id` on
write; the realm's built-in `test-user*` accounts only work because they were
loaded via bulk import, which bypasses that validation.

This setting currently exists **only as a live, manually-applied change** on
staging's running Keycloak — confirmed by grep: zero matches for
`unmanagedAttributePolicy` in `infra/keycloak/lis-realm.json` as of this
session. `deploy-staging.yml` now force-recreates the Keycloak container on
every deploy (PR #253, this session, fixing a separate stale-import bug).
Every force-recreate re-imports `lis-realm.json` from scratch, which will
silently wipe this live-only setting and reintroduce the exact `tenant_id`
bug this session spent real effort diagnosing — with no CI signal, matching
this project's own repeated pattern of gaps invisible to every green check.

## 2. Affected files
- `infra/keycloak/lis-realm.json` — add the User Profile component config
  (see §5 on exact mechanism) so `unmanagedAttributePolicy: "ENABLED"`
  survives every future realm re-import.

## 3. Architecture consulted
- `authentication` Skill (lis-engineering), entries #7-#10 — full diagnostic
  trail for how this gap was originally found and fixed live.
- ADR-0009 (single Keycloak realm with `tenant_id` attribute, not
  realm-per-tenant) — this proposal keeps that decision working under
  redeploys; it does not revisit it.
- Constitution Law #4 (tenant isolation is structural) — `tenant_id` silently
  dropping on write is exactly the kind of gap that would eventually produce a
  cross-tenant leak if RLS session binding ever reads a null/stale value;
  this fix is in that law's blast radius even though it's a config change,
  not a schema change.

## 4. Skills loaded
`authentication` (lis-engineering/skills/engineering/authentication/SKILL.md).

## 5. Assumptions & autonomous decisions — mechanism for extracting the exact JSON
Keycloak realm exports encode User Profile config as a `components` block
(provider type `org.keycloak.userprofile.UserProfileProvider`) containing a
stringified JSON config (Context7 `/keycloak/keycloak` docs confirm the
*inner* JSON shape: `{"unmanagedAttributePolicy": "ENABLED", "attributes": [...]}`,
but not the exact outer `components` wrapper key names for this Keycloak
version).

Given this session's own repeated lesson — verify against the real running
system, don't hand-author security-relevant config from documentation alone
(see AGENTS.md's Host-header/redirect_uri findings, same pattern) —
the recommended mechanism is:
1. Export the **live** staging realm directly
   (`docker compose exec keycloak /opt/keycloak/bin/kc.sh export
   --realm lis --file /tmp/lis-export.json`, or equivalent admin-CLI export),
   since it already has `unmanagedAttributePolicy: "ENABLED"` applied live.
2. Diff that live export against the committed `lis-realm.json` to find the
   exact `components`/User Profile block Keycloak itself generated.
3. Merge only that block into `lis-realm.json` — not hand-typed JSON — so the
   committed file is byte-proven to match what Keycloak already runs, not a
   docs-derived guess.

## 6. Risks
- **Getting the `components` JSON shape wrong produces a silent no-op, not an
  error** — `--import-realm` does not fail loudly on an unrecognized/
  malformed component block; it would just leave the policy at its default
  (`DISABLED`) again, reproducing the exact bug this fix exists to prevent,
  with no CI signal. This is why §5 mandates extracting the real live config
  rather than hand-authoring it.
- **Realm-file diffing risk:** the live export will also include
  environment-specific noise (secrets, generated IDs, timestamps) not present
  in the committed file — needs a careful, scoped diff, not a wholesale
  overwrite of `lis-realm.json`.
- Small blast radius otherwise: this is additive to one realm's User Profile
  config, does not touch clients/roles/users already in the file.

## 7. Acceptance criteria
- `infra/keycloak/lis-realm.json` contains a `components` block whose User
  Profile config includes `"unmanagedAttributePolicy": "ENABLED"`.
- After a full Keycloak force-recreate + `--import-realm` on staging (i.e.
  simulating the next normal deploy), a live write with a custom `tenant_id`
  attribute still succeeds — re-run the relevant step of
  `scripts/feat009-staging-verify.md` that exercises this.
- No regression to existing realm behavior (roles, clients, existing test
  users) — same verify runbook covers this.

## 8. Testing plan
- Locally: `docker compose down -v && up -d` (fresh Keycloak, no staging risk)
  to prove the new `lis-realm.json` still imports cleanly end to end before
  touching staging.
- Staging: dispatch a deploy (which now always force-recreates Keycloak),
  then re-run `scripts/feat009-staging-verify.md`'s token-acquisition step to
  confirm `tenant_id` survives.

## 9. Rollback plan
- Purely additive JSON block; revert the PR to return to today's (broken on
  next recreate) state. No data migration, no destructive step.

## 10. Questions requiring human approval — ANSWERED 2026-08-02
1. **Mechanism for extracting the exact `components` JSON** — originally
   APPROVED as live-export-and-diff (§5); superseded, see §11.
2. **Timing of the staging-side verification** — APPROVED: dispatch a real
   staging deploy now to force the Keycloak recreate and prove the fix.

## 11. Revision during implementation (2026-08-02) — mechanism changed
§5's live-export-and-diff mechanism turned out to be **not executable**:
confirmed via `scripts/feat009-staging-verify.md:10-11` that there is no
SSH/personal key for the staging droplet at all ("Copy-paste each block
below into the staging droplet console") — export requires either
`docker exec`/`kc.sh export` on the droplet (console-only, human-operated)
or the Admin REST API's export path, which lives on Keycloak's internal
`127.0.0.1:8080` listener, not reachable over the tailnet (confirmed: the
public `:8443` tailnet listener serves the OIDC/app endpoints fine, but not
the admin API used for export).

**Revised mechanism, approved by human 2026-08-02:** instead of hand-editing
`lis-realm.json`'s realm-export JSON to add a `components`/User-Profile
block (which would require guessing this Keycloak version's exact wrapper
schema — the very risk §6 flagged), automate the already-proven-working
runbook sequence (`scripts/feat009-staging-verify.md` Step 1: GET the live
User Profile config, merge in `unmanagedAttributePolicy: "ENABLED"`, PUT it
back) as a step in `deploy-staging.yml`, run once against Keycloak
immediately after it starts on every deploy, before `api`/`web` come up.
This is idempotent (a repeat PUT of the same value is a no-op), reuses
exactly the code this session already validated works against the real
running system, and needs zero realm-JSON schema knowledge.

Net effect is identical to the original goal: the policy is set on every
deploy, not lost on the next Keycloak force-recreate — just enforced via a
deploy-time API call instead of a static import-time JSON block.
`infra/keycloak/lis-realm.json` itself is not changed by this revision.
