# LIS Platform

A commercial, multi-tenant Laboratory Information System (LIS) — a modular monolith covering
patient/order/specimen management, structured clinical results, anatomic pathology (case →
gross/micro → synoptic reporting → sign-out → report → invoice), chemistry/haematology/
microbiology, critical-value escalation, RBAC, and HL7 v2 / FHIR R4 interoperability.

The core design bet: **clinical results are structured data, not free text.** Every result is a
coded `Observation`, not a paragraph — the same principle a shipped LIS needs for trending,
decision support, and interoperability, applied from the schema up rather than bolted on later.

**Project status:** a live-proven, single-discipline (anatomic pathology) pilot with strong
architectural bones and broader ambition than has yet been proven out in production. See
[`docs/world-class-final-assessment-2026-09.md`](docs/world-class-final-assessment-2026-09.md) for
a current, evidence-based maturity assessment — including what's genuinely strong, what isn't yet,
and why. This is a deliberate choice: the project tracks its own honest state rather than only its
aspirational one.

## Why this exists

Most legacy LIS software treats pathology and lab content as scanned documents or free-text
narrative — readable by a human, opaque to everything else (analytics, decision support,
interoperable exchange). This project's structural bet is that a lab platform built around coded,
structured `Observation` data from day one — not retrofitted onto a document-management model —
can do meaningfully more: real trending, real standards-based interoperability, and a synoptic
reporting engine sourced from actual ICCR/CAP content rather than per-organ hardcoded forms.

## Stack

- **Backend:** NestJS (Fastify adapter), TypeScript strict
- **Frontend:** Next.js (App Router) + React + Tailwind + shadcn/ui
- **Database:** PostgreSQL 16, Drizzle ORM, Row-Level Security for tenant isolation
- **Auth:** Keycloak (OIDC)
- **Tests:** Vitest (unit), Playwright (e2e)
- **Package manager:** pnpm (required — this is a pnpm workspace monorepo)

## Repository layout

```
apps/api       NestJS backend — the REST API, capability-based RBAC, RLS tenant binding
apps/web       Next.js frontend
apps/gateway   Analyzer/instrument ingestion edge service
apps/interop   HL7 v2 (MLLP) inbound server
packages/domain  Zod schemas — the single source of truth for validation, OpenAPI, and the SDK
packages/db      Drizzle schema and query modules (audit, accession, flagging, etc.)
packages/sdk     Generated TypeScript API client (from packages/domain's OpenAPI output)
packages/ui      Shared design system (shadcn-based)
db/migrations    Raw SQL migrations, including DB-level integrity triggers
docs/            Architecture assessments, pilot guide, scope docs, implementation plans
```

## Five invariants

These hold everywhere in the codebase, without exception:

1. No clinical value is ever stored as free text — always a structured, coded `Observation`.
2. Verified clinical data is append-only; corrections create new versions, never in-place edits.
3. Critical values never auto-verify, and block report finalization until acknowledged.
4. Tenant isolation is structural, enforced by PostgreSQL Row-Level Security — not an application-
   layer convention.
5. Every clinically significant action writes a hash-chained audit record.

## Getting started (local development)

Prerequisites: Node.js ≥ 22, pnpm, Docker.

```bash
pnpm install
docker compose up -d        # Postgres, Keycloak, Valkey, MinIO
cp .env.example .env        # dev-only defaults; see comments inline for what each var does
pnpm db:reset                # create/migrate/seed the local database
pnpm dev                     # runs apps/api + apps/web (and other apps) in parallel
```

Other useful commands:

```bash
pnpm test         # unit tests (Vitest)
pnpm typecheck     # tsc --noEmit across the workspace
pnpm lint          # eslint
```

## Running a pilot acceptance test

See [`docs/pilot/PILOT-USER-GUIDE.md`](docs/pilot/PILOT-USER-GUIDE.md) — a step-by-step guide for
testing the system end-to-end (org setup → patient registration → orders → AP/pathology case
workflow → synoptic reporting → sign-out → billing → RBAC) before inviting a design partner.

## Where to go deeper

- [`AGENTS.md`](AGENTS.md) — architecture/stack context and working conventions for anyone (human
  or AI-assisted) contributing to this repo.
- [`docs/world-class-final-assessment-2026-09.md`](docs/world-class-final-assessment-2026-09.md) —
  the current honest state-of-the-project assessment: what's proven, what's built-but-unproven, and
  the concrete gaps remaining before a genuine production launch.
- [`docs/world-class-roadmap-2026-09.md`](docs/world-class-roadmap-2026-09.md) — the sequenced plan
  toward closing those gaps.
- [`CHANGELOG.md`](CHANGELOG.md) — release history.
- Architecture Decision Records live in a sibling repository (`lis-engineering/adr`), not in this
  one — each real architectural choice in this codebase is backed by a written ADR naming the
  alternatives considered and why they were rejected.

## License

Proprietary. All rights reserved.
