# LIS Platform — Agent Context

## What this is
A commercial Laboratory Information System. Modular monolith.

## Stack
- Backend: NestJS (Fastify adapter), TypeScript strict
- Frontend: Next.js + React + Tailwind + shadcn/ui
- DB: PostgreSQL 16 (Drizzle ORM + raw SQL), RLS for tenancy
- Tests: Vitest (unit), Playwright (e2e)
- Package manager: pnpm — never npm or yarn

## Commands
- pnpm dev — run everything
- pnpm test — unit tests
- pnpm typecheck — tsc --noEmit
- pnpm db:reset — drop, migrate, seed local DB
- pnpm lint — eslint

## Structure
apps/api (backend) · apps/web (frontend) · packages/domain (shared types+Zod) ·
packages/ui (design system) · packages/sdk (generated API client)

## THE FIVE INVARIANTS (never violate, no exceptions)
1. No clinical value stored as free text — always a structured, coded Observation.
2. Verified clinical data is append-only; corrections create new versions.
3. Critical values never auto-verify and block report finalization until acknowledged.
4. Tenant isolation is structural via PostgreSQL RLS, not application checks.
5. Every clinically significant action writes an audit record.

## Where knowledge lives
- Architecture KB: ../lis-engineering/knowledge-base/
- ADRs: ../lis-engineering/adr/
- Standards: ../lis-engineering/standards/
- Skills: ../lis-engineering/skills/

## Rules of engagement (Rule #0)
- Before writing production code, always produce an Implementation Proposal
  (docs/plans/<id>-<slug>.md) and wait for explicit approval (Status: APPROVED).
- If a load-bearing decision is missing (data model, provider, clinical rule),
  STOP and ask. Do not invent it.
- Follow existing module patterns; mirror the most similar existing module.
- Every schema change is a migration in db/migrations. Never edit a past migration.
