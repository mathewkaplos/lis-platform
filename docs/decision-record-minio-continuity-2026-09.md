# Decision Record: MinIO continuity — what a future storage-platform decision should weigh

**Date:** 2026-09-25. **Status:** informational — no decision is made in this document, and none
should be inferred from it. Companion to `lis-engineering/adr/adr-0056-...md`, which records the
immediate continuity fix (a GHCR-hosted mirror of the exact last-known-good MinIO image). This
document exists so that a future, real storage-platform decision starts from an honest accounting
of the situation rather than rediscovering it from scratch.

**Do not read this as a recommendation to migrate now.** Per explicit instruction, no replacement
evaluation or migration work has been started. This is a decision-*preparation* record, not a
decision.

---

## 1. Current MinIO state

- The application (`apps/api`'s `object-storage.client.ts`, via the real `@aws-sdk/client-s3`,
  per ADR-0054) talks to a self-hosted MinIO instance for image attachments and whole-slide-image
  (WSI) tiles.
- MinIO's open-source **Server**, **Client (`mc`)**, and **KES** projects are archived and no
  longer maintained by MinIO Inc., confirmed directly (`dl.min.io` returns `410 Gone` with an
  explicit archival notice as of 2026-09-25). No further security patches, advisories, or bug fixes
  will ever be published for the version currently running.
- The exact image currently running in production (and mirrored to this repo's own GHCR namespace
  per ADR-0056) is frozen at digest `sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e`.
  It will keep running — this is not an active-incident situation — but it cannot be updated from
  its original upstream source, ever.

## 2. Why the current GHCR mirror approach is temporary

- It preserves exactly one frozen artifact. If a real vulnerability is ever disclosed against this
  specific MinIO version (impossible to know in advance, since MinIO no longer issues advisories
  for it at all), there is no vendor patch path — only a full replacement.
- It does not address the underlying question of whether self-hosting an unmaintained object-store
  binary is still the right architecture for this product's actual maturity/scale trajectory.
- It was chosen under real time pressure (a broken CI pipeline) using the narrowest possible fix —
  appropriate for that moment, not necessarily for the next 12+ months.

## 3. Replacement candidates that should eventually be evaluated

Listed for future reference, not pre-selected or ranked:

- **Garage** (S3-compatible, actively maintained, designed for small self-hosted clusters — a
  reasonable like-for-like replacement if self-hosting remains the preference).
- **SeaweedFS** (S3-compatible, actively maintained, broader feature set than needed here but a
  real option).
- **A real cloud S3-compatible provider** (AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces
  — notably, DO Spaces is on the same cloud this project's droplet already runs on, which may be a
  relevant practical consideration when this is actually evaluated).
- **MinIO's own commercial/AIStor offering**, if MinIO Inc. still permits self-hosting under it —
  worth checking directly rather than assuming, since this ADR's own research did not investigate
  MinIO's current commercial terms in depth (out of scope for a same-day continuity fix).

## 4. Operational/security implications to weigh

- **Patch cadence**: whichever option is chosen, prefer one with an active, ongoing security-patch
  story — this is the exact gap the current situation exposed.
- **Operational burden**: self-hosting (Garage/SeaweedFS) keeps the current zero-external-account
  operating model but means this small team owns patching/upgrades going forward. A managed
  provider removes that burden at a real, ongoing cost.
- **Network/access model**: the current architecture (loopback-only MinIO, reached only via
  presigned URLs proxied through `apps/web`'s own authenticated-redirect chain, per ADR-0055) would
  need re-establishing under any replacement — this is real migration work, not a config toggle,
  regardless of which option is chosen.

## 5. Data migration implications

- Object count/volume at the time of this record is small (this is a pre-launch environment with
  no onboarded tenants or real patient data yet, confirmed directly during this session's own
  restore-drill verification work) — a real migration today would be cheap. This will not remain
  true indefinitely; the cost of migrating grows with real usage, which is itself an argument for
  making this decision deliberately sooner rather than later, once a real design-partner pilot is
  imminent (see the execution plan's own pilot-readiness gates).
- Any real migration must preserve object keys/bucket structure exactly, or update every stored
  reference (`image_attachment`/WSI-related rows) atomically — a real, non-trivial data-migration
  task in its own right whenever it happens.

## 6. Whether managed S3-compatible storage should be considered

Genuinely open — not pre-decided here. Arguments exist both ways (see §4's operational-burden
point). This is precisely the kind of question this record recommends deciding deliberately, with
real requirements (§7) in hand, rather than by default momentum from "MinIO is what we already
have."

## 7. What evidence/requirements should drive the eventual decision

- Real expected object volume/growth rate once a pilot is underway (currently unknown — no real
  tenant has onboarded yet).
- Real budget appetite for a managed service vs. continued self-hosting's operational cost (this
  team's own time).
- Whether the droplet's own known tight memory/resource budget (documented elsewhere in this
  project — issue #564, the world-class execution plan's own reliability workstream) makes adding
  another self-hosted service (Garage/SeaweedFS) a real constraint vs. offloading to a managed
  provider.
- Whether a design partner's own data-residency/compliance requirements (once one exists) rule out
  particular providers.

None of this is being gathered or acted on now — this section exists so that when it's time, the
right questions are already written down.
