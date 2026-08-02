---
description: Launch apps/web and interactively verify a change with a real
  headless browser, including authenticated routes -- without needing a live
  Keycloak, and working around this sandbox's missing libnss3.so.
argument-hint: (no arguments needed)
---

# Verify apps/web interactively

Scoped to `lis-platform` specifically -- this Skill's session-minting shape
is `apps/web/auth/session.ts`'s own, and its Chromium workaround is this
sandbox's own missing-library gap, not a `lis-engineering` cross-project
concern. First captured 2026-08-01 verifying TASK-036 (app shell, PR #237);
extend it with anything a future verification session actually discovers,
same as any other Skill.

## 1. Launch the dev server

`apps/web`'s pages that read `cookies()` fail at request time (not just
build time) without `SESSION_SECRET` set -- `apps/web/auth/secret.ts`
throws `SESSION_SECRET is not set` otherwise. Use the same dev-only value
already committed in `.env` at the repo root (`grep SESSION_SECRET .env`) --
don't invent a new one, or a locally-minted session cookie (step 2) won't
verify against what the server actually expects.

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill -9   # avoid EADDRINUSE from a stale instance
rm -rf ~/work/lis-platform/apps/web/.next        # stale manifests from a prior build/dev mix cause
                                                  # confusing ENOENT/MODULE_NOT_FOUND errors otherwise
cd ~/work/lis-platform && SESSION_SECRET="dev-only-session-secret-change-in-production" \
  pnpm --filter web dev > /tmp/web-dev.log 2>&1 &
disown
timeout 30 bash -c 'until grep -q "Ready in" /tmp/web-dev.log; do sleep 1; done'
```

**Gotcha:** if a previous `next dev` from an earlier attempt is still
running, a second instance's Turbopack persistent cache writer collides
with the first's (`Persisting failed: Another write batch or compaction is
already active`), producing real but misleading `ENOENT`/`MODULE_NOT_FOUND`
errors that look like a code bug. Always confirm no stray `next-server`
process survives a previous session before starting a new one:
`ps aux | grep -i "next-server\|next dev" | grep -v grep` -- kill any
found, `rm -rf .next`, then restart clean.

**Gotcha:** a `next.config.ts` change (e.g. `transpilePackages`) requires a
full dev-server restart, not just a `.next` cache clear -- the config is
only read at process start.

**Gotcha (2026-08-02, planning TASK-040/#265):** `pnpm --filter web build`
(production build, Turbopack) fails in this sandbox specifically, on
`/_global-error`/`/_not-found`'s own prerender step --
`TypeError: Cannot read properties of null (reading 'useContext')`. Confirmed
this is **not** a real code bug: reproduces identically on a clean `main`
checkout with zero changes (`git stash` + rebuild), survives a full `rm -rf
.next`, and — most importantly — **CI's own `pnpm build` step passes
reliably** (confirmed across four separate real PR runs the same session).
Treat this as a known, sandbox-only Turbopack/prerender quirk, not something
to debug further locally: use `pnpm --filter web dev` (step 1 above) for any
local verification, and trust CI's `pnpm build` as the real proof a change
doesn't break the production build, the same way `apps/api`'s own e2e specs
already can't be fully trusted from a single local run for other reasons
(see AGENTS.md's harness-mismatch rule).

## 2. Reach an authenticated route without live Keycloak

Local dev has no Keycloak/Postgres by default, and the full OIDC login
redirect dance can't be scripted quickly. For UI-only verification (not
testing the login flow itself), mint a valid `lis_session` cookie directly
using the exact same signing shape `apps/web/auth/session.ts`'s
`signSession` uses -- `verifySession` on the server will accept it exactly
as if it came from a real login, since it's signed with the same secret and
shape.

Run this **from inside `apps/web`** (needs to resolve the workspace's own
`jose` dependency):

```bash
cd ~/work/lis-platform/apps/web && node --input-type=module -e '
import { SignJWT } from "jose";
const secret = new TextEncoder().encode("dev-only-session-secret-change-in-production");
const token = await new SignJWT({
  sub: "test-user-1",
  tenantId: "acme-labs",
  roles: ["lab-tech"],
  idToken: "fake-id-token-for-local-verification-only",
})
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("30m")
  .setAudience("lis:session")
  .sign(secret);
console.log(token);
'
```

Set it as a cookie named `lis_session` (domain `localhost`, path `/`,
`httpOnly: true`) in whatever drives the browser (step 3's Playwright
`context.addCookies(...)`, or a `curl -H "Cookie: lis_session=<token>"` for
a quick SSR-only structural check without a browser at all).

If `SESSION_SECRET`, the audience (`lis:session`), or the payload shape
ever change in `apps/web/auth/session.ts`, update this recipe to match --
it will otherwise mint a token `verifySession` silently rejects.

## 3. Real headless Chromium in this sandbox

`chromium-cli` is not available here. Playwright's own cached Chromium
build (`~/.cache/ms-playwright/chromium-*`) is present but fails with
`error while loading shared libraries: libnss3.so: cannot open shared
object file` -- this sandbox has no root (`sudo -n true` fails), so the
usual `npx playwright install --with-deps` fix is unavailable.

**Workaround: `apt-get download` doesn't need root.** Download the missing
`.deb`s, extract them with `dpkg-deb -x` (also root-free), and point the
loader at the extracted libs via `LD_LIBRARY_PATH`:

```bash
mkdir -p /tmp/chromium-libs && cd /tmp/chromium-libs
apt-get download libnss3 libnspr4 libasound2t64
for f in *.deb; do dpkg-deb -x "$f" .; done
rm -f *.deb
export LD_LIBRARY_PATH=/tmp/chromium-libs/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
```

(`libasound2t64` was the second missing library, only surfaced after
`libnss3`/`libnspr4` were already fixed -- if a future Chromium version
needs a different package, the same `apt-get download` + `dpkg-deb -x`
pattern applies; just add the new package name.)

`playwright` itself isn't a direct dependency of any workspace package here
except transitively (`packages/ui`'s `axe-playwright` devDependency) --
resolve it via the pnpm store directly rather than adding a new dependency
just for a verification script:

```bash
find ~/work/lis-platform/node_modules/.pnpm -maxdepth 1 -iname "playwright@*" -type d
# e.g. .../node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs
```

Also pin `executablePath` explicitly to the cached build -- this repo's
resolved `playwright` version can expect a different internal browser
revision (`chromium_headless_shell-XXXX`) than what's actually cached
(`chromium-XXXX`), producing a spurious "Please run `npx playwright
install`" error even though a perfectly good Chromium build already exists:

```js
import { chromium } from '/home/mat/work/lis-platform/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs';
const browser = await chromium.launch({
  args: ['--no-sandbox'],
  executablePath: '/home/mat/.cache/ms-playwright/chromium-1148/chrome-linux/chrome', // match the real cached build dir
});
```

Env vars from steps 1 and 2 (`LD_LIBRARY_PATH` set, dev server running with
`SESSION_SECRET`) need to be present in whatever shell actually runs the
Playwright script -- run it in the same shell session those were exported
in, not a fresh one.

## Drive it

Standard `nav` → `addCookies` (with the minted token from step 2) →
`waitForSelector` → `screenshot` → check `console` for errors loop, same
shape as the generic `run` Skill's `playwright.md` example. `dbus`-related
stderr lines (`org.freedesktop.UPower...ServiceUnknown`) on launch are
harmless sandbox noise, not a real failure -- ignore them, don't debug
them.

**Look at the screenshot.** A blank frame or an unstyled page (classes
present in the DOM but no visible styling) is a real failure signal even
if the script reports no thrown errors.
