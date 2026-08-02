import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ['test/**/*.e2e-spec.ts'],
    environment: 'node',
    // Every e2e spec shares one live Postgres/Keycloak instance and the
    // same handful of tenants (test-user.../TENANT_A, test-user-2/TENANT_B).
    // audit_event is an append-only hash chain per tenant, and several specs
    // assert exact before/after count deltas — both are only valid if
    // audited writes across every spec file happen in one real order, never
    // interleaved. Vitest's default is to run spec files concurrently across
    // workers; found this session (TASK-039/patient.e2e-spec.ts) when adding
    // a second file that writes to TENANT_A's audit trail broke both its own
    // delta assertion AND capability-check.e2e-spec.ts's hash-chain
    // validation, nondeterministically, purely from file-level parallelism —
    // not a bug in either file's own logic.
    fileParallelism: false,
  },
});
