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

**Check this session actually has a local stack before starting (added
2026-08-07, TASK-059/060 session):** this Skill's own description says
"without needing a live Keycloak" -- that means without the full OIDC
redirect dance, not without Keycloak reachable at all. Step 2's own
password-grant recipe still needs a real Keycloak listening on `:8080` to
mint the token pair it signs into the session cookie, which in turn needs a
working `docker compose up` locally. Run `which docker && docker ps` first;
if that fails (a sandbox where `docker` isn't a usable command at all, not
just missing one image -- `engineering/testing` Skill entry #11 has the
exact symptom), this entire Skill is blocked, not just its Chromium step --
stop here and rely on CI's own real e2e run instead, stated explicitly in
the PR rather than attempting local verification.

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

**Gotcha (2026-08-04, TASK-042/043/044 verification): the same discipline
applies to `apps/api`'s own dev/compiled server, and a `kill` command's own
exit code is not proof the port is actually free.** A stray `node dist/main`
or `nest start --watch` process left listening on `:4000` from an earlier
verification pass survived at least two `kill $(lsof -ti:PORT)`-style
cleanup attempts this session, and being reachable on the same port as a
"fresh" server it silently corrupted shared local Postgres state in a way
that produced a confusing, misleading downstream symptom (an apparently
nondeterministic test failure, chased down the wrong path for a while
before the real cause was found — see `testing` Skill entry #8). Before
trusting a server is actually stopped, positively verify zero listeners
remain, don't just trust the kill command ran:

```bash
kill $(lsof -ti:4000 -sTCP:LISTEN) $(lsof -ti:3000 -sTCP:LISTEN) 2>/dev/null
sleep 1
ps aux | grep -iE "next-server|next dev|node.*(dist/main|nest|main\.js|next)" | grep -v grep
lsof -i -P -n 2>/dev/null | grep LISTEN | grep -E ":4000|:3000"
# both commands above should print nothing -- if either does, kill -9 the
# listed PID(s) directly (a piped `lsof -ti | xargs kill` can silently fail
# to signal a process in this sandbox) and re-check before proceeding.
```

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

## 1b. Launch a real `apps/api` server

Most real `apps/web` screens call `apps/api` server-side (order/patient
pages, the worklist, the results grid, the report viewer -- everything
except a bare static placeholder). Step 1 alone only gets `apps/web`
running; without a live `apps/api` too, every such page fails with its own
"Something went wrong loading..." error, not an obviously API-shaped one.

```bash
cd ~/work/lis-platform && set -a && source .env && set +a && pnpm --filter api build
node apps/api/dist/main.js > /tmp/api-dev.log 2>&1 &
disown
sleep 3 && tail -5 /tmp/api-dev.log   # look for "Nest application successfully started"
                                       # and your route's own "Mapped {...}" log line
```

**Gotcha (2026-08-07, TASK-062 verification): `nest build` can report
success while writing zero files to `dist/`, if a stale
`apps/api/tsconfig.build.tsbuildinfo` survives from an earlier build --
`tsc`'s own incremental cache doesn't notice `deleteOutDir` removed the
output directory it believes is still up to date.** This is the exact
same root cause `engineering/testing` Skill entry #10 already documents
(discovered in a prior session, hit again fresh here) -- don't rediscover
it from scratch: `rm apps/api/tsconfig.build.tsbuildinfo` and rebuild if
`node apps/api/dist/main.js` fails with `Cannot find module '.../dist/main.js'`
right after a build that itself reported no errors.

## 2. Reach an authenticated route without live Keycloak

Local dev has no Keycloak/Postgres by default, and the full OIDC login
redirect dance can't be scripted quickly. For UI-only verification (not
testing the login flow itself), mint a valid `lis_session` cookie directly
using the exact same signing shape `apps/web/auth/session.ts`'s
`signSession` uses -- `verifySession` on the server will accept it exactly
as if it came from a real login, since it's signed with the same secret and
shape.

**Gotcha (2026-08-05, TASK-047 verification): the recipe below must carry
real Keycloak-issued `accessToken`/`refreshToken`/`accessTokenExpiresAt`,
not placeholders.** Since ADR-0014, `SessionPayload`
(`apps/web/auth/session.ts`) requires non-empty `accessToken`/
`refreshToken` and a numeric `accessTokenExpiresAt` in addition to
`sub`/`tenantId`/`roles`/`idToken` -- `verifySession()` explicitly returns
`undefined` (silent auth failure, no error surfaced) if any are missing.
A cookie minted with only `sub`/`tenantId`/`roles`/`idToken` (this
recipe's own previous version) authenticates for a purely static page but
fails the moment the page calls `apps/api` via `getValidAccessToken()` --
which is most real screens in this app. Get a real token pair from
Keycloak first (same password-grant `get-keycloak-token.ts` uses), then
sign the session around it:

Run this **from inside `apps/web`** (needs to resolve the workspace's own
`jose` dependency; requires local Keycloak up on `:8080`, same as any e2e
run):

```bash
cd ~/work/lis-platform/apps/web && node --input-type=module -e '
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";

const tokenRes = await fetch("http://localhost:8080/realms/lis/protocol/openid-connect/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "password",
    client_id: "lis-web",
    username: "test-user",       // technologist, TENANT_A -- see order.e2e-spec.ts
    password: "test-password",
  }),
});
const tokenBody = await tokenRes.json();

const secret = new TextEncoder().encode("dev-only-session-secret-change-in-production");
const session = await new SignJWT({
  sub: randomUUID(),            // must be UUID-shaped -- see gotcha below, do not use a bare username
  tenantId: "00000000-0000-0000-0000-000000000001",
  roles: ["technologist"],
  idToken: tokenBody.id_token ?? "fake-id-token-for-local-verification-only",
  accessToken: tokenBody.access_token,
  refreshToken: tokenBody.refresh_token,
  accessTokenExpiresAt: Date.now() + tokenBody.expires_in * 1000,
})
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("30m")
  .setAudience("lis:session")
  .sign(secret);
console.log(session);
'
```

Set it as a cookie named `lis_session` (domain `localhost`, path `/`,
`httpOnly: true`) in whatever drives the browser (step 3's Playwright
`context.addCookies(...)`, or a `curl -H "Cookie: lis_session=<token>"` for
a quick SSR-only structural check without a browser at all).

**Gotcha, now root-caused (2026-08-05, TASK-046/048 verification): any password-grant
login for the same user -- including one made only to seed test fixtures via the API,
not to open a second browser session -- rotates the refresh token an already-minted
session cookie relies on, and `apps/api` then rejects that cookie's `accessToken` with a
real `401` the moment `getValidAccessToken()` tries to refresh it.** This surfaces with
no thrown error: a page that should load instead shows its own ordinary "not found"/empty
state, indistinguishable from a real 404 without checking `apps/api`'s own request log.
Confirmed directly this session, not just inferred: `apps/api`'s structured request log
showed real `401` responses immediately after a cookie mint that was followed by further
password-grant calls, and zero `401`s once the seeding order below was followed instead.

**Follow this exact order, every time a verification run also needs seeded test data:**
1. Seed all test data first (patients, orders, etc.), using its own password-grant call(s).
2. Mint the session cookie last, immediately before opening the browser -- the exact
   recipe above.
3. Make no further Keycloak calls (no more seeding, no second mint) until that browser
   run is completely done.

If `SESSION_SECRET`, the audience (`lis:session`), or `SessionPayload`'s
own fields ever change again in `apps/web/auth/session.ts`, diff this
recipe against the real interface before trusting it -- a stale recipe
fails silently (a rejected cookie looks identical to "not logged in" or,
worse, to the target page's own unrelated not-found state), not with an
error pointing back here.

**Gotcha (2026-08-09, FEAT-022 Part 2 verification): a bare username string
as `sub` (this recipe's own earlier version, `sub: "test-user"`) breaks any
feature that ever sends `session.sub` on as a payload value expecting a real
uuid -- a real Keycloak-issued access token's own `sub` claim is always a
uuid, so a readable placeholder here is a test-harness-only divergence from
production shape that nothing catches until a feature actually depends on
it.** First surfaced verifying FEAT-022 Part 2's "Assign to me" action
(`POST /v1/worklist/bulk-assign` with `assignedUserId: session.sub`) --
the request failed a real, correct `z.uuid()` validation with a 400,
which looked like an app bug until traced back to this recipe's own
placeholder value. Fixed above: use `randomUUID()` (or any real uuid) for
`sub`, never a bare username -- the exact value doesn't matter (nothing
validates it against a real Keycloak user, same as the whole point of a
locally-signed session cookie), only its shape does.

**Gotcha (2026-08-09, FEAT-022 Part 2 verification): a session cookie
minted early in a verification run can expire before a later step in the
*same* run actually uses it, producing a misleading generic error that
looks like a real app bug, not an expired-token problem.** A run that mints
two cookies up front (e.g. one technologist, one verifier, to compare
role-gated UI) and then spends real wall-clock time driving the first
session through several interactions before ever loading a page with the
second cookie can hit the access token's own real Keycloac-issued expiry
(often ~5 minutes) by the time the second cookie is finally used --
`getValidAccessToken()`'s refresh path depends on request-scoped `cookies()`
write access a plain background script doesn't have, so it cannot self-heal
here the way a real browser session would. Surfaced as a generic "Something
went wrong loading..." page error with a `500` in the browser console --
indistinguishable from a real server bug without checking `apps/api`'s own
request log (which showed a clean, unrelated success for the *same* route
hit moments later with a **freshly re-minted** cookie for the same user).
**Mint each cookie immediately before the browser run that actually uses
it, not all cookies up front for a multi-session verification pass** -- if
a run must compare multiple sessions/roles, mint and use them one at a
time, sequentially, not batched.

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
install`" error even though a perfectly good Chromium build already exists.

**Gotcha (2026-08-05, TASK-047 verification): don't hardcode the revision
number or the internal directory name -- both drift as `playwright`'s
pinned version moves, and both had already changed since this Skill was
first captured.** A previous version of this doc hardcoded
`chromium-1148/chrome-linux/chrome`; the real cached build this session
was `chromium-1234/chrome-linux64/chrome` -- a newer revision *and* a
different directory suffix (`chrome-linux64`, not `chrome-linux`).
Following the stale hardcoded path failed with "executable doesn't exist"
even though a perfectly good cached build was present one `find` away.
Resolve it dynamically instead:

```bash
CHROME_DIR=$(find ~/.cache/ms-playwright -maxdepth 1 -iname "chromium-*" -type d | sort -V | tail -1)
export CHROME_BIN=$(find "$CHROME_DIR" -maxdepth 2 -iname "chrome" -type f | head -1)
echo "$CHROME_BIN"
```

```js
import { chromium } from '/home/mat/work/lis-platform/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs';
const browser = await chromium.launch({
  args: ['--no-sandbox'],
  executablePath: process.env.CHROME_BIN, // resolved via the `find` above, not hardcoded
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

**Gotcha (2026-08-09, TASK-390 verification): seeding a "held"/transient
outcome via direct API calls, then just loading the page, will never show
it -- check whether the state you're verifying is persisted or client-only
before choosing a seeding strategy.** TASK-390's own held-caption fix lives
entirely in `results-grid.tsx`'s own `useState` (`heldMessage`/`heldReason`),
set only inside `handleKeyDown`'s `finalizeResult()` callback -- a fresh
Server Component render of the same order reads the row's real persisted
`observationStatus` from the DB, which has no memory of *why* a panel is
held. A first verification attempt pre-seeded the QC violation *and* called
`finalize()` directly via HTTP, then navigated fresh -- the caption never
appeared (`caption: null`), not because the fix was broken, but because
nothing ever exercised the client-side code path that sets it. Fixed by
seeding only the *precondition* via API (fixtures, a fresh not-yet-finalized
order) and driving the actual triggering interaction
(`input.fill()`/`input.press('Enter')`) through Playwright itself.
**Before seeding a scenario via direct API calls, grep the component for
where the field you're checking is set** -- if it's only ever set inside an
event handler's own response (a toast, an inline "just saved" banner, any
optimistic-update flash) and never rehydrated on render, seed the
precondition only and drive the real interaction; a plain `page.goto()`
will never show it.

**Gotcha (2026-08-07, TASK-062 verification): after clicking a Next.js
client-side `<Link>` or a `router.push()` call, `page.waitForLoadState('networkidle')`
can resolve *before* the resulting RSC fetch/navigation even starts --
the click handler returns synchronously, and if the network happens to be
already idle at that exact instant, `networkidle` is satisfied immediately,
long before the actual client-side transition completes.** This produced a
misleading, 100%-reproducible false failure: `page.url()` read the stale
pre-click URL, and a screenshot taken right after showed the old page --
looking exactly like a real navigation bug in the app, not a driving-script
race. Root-caused by direct isolation: the identical click, awaited with
`page.waitForTimeout(1500)` instead of `waitForLoadState('networkidle')`,
navigated correctly every time. **Use `page.waitForURL(<pattern>)` after any
click that triggers client-side navigation (a `<Link>` or a
`useRouter().push()` call), not `waitForLoadState('networkidle')` --
reserve `networkidle` for a fresh `page.goto()`/full-page form submission,
where there's always a real, immediate in-flight request for it to
legitimately wait on.**

**Look at the screenshot.** A blank frame or an unstyled page (classes
present in the DOM but no visible styling) is a real failure signal even
if the script reports no thrown errors.
