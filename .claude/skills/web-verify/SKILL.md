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
ps aux | grep -iE "node.*(dist/main|nest|main\.js|next)" | grep -v grep
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
  sub: "test-user",
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

**Gotcha:** re-using one minted session cookie across two separate
Playwright script invocations several minutes apart failed the second
time (a page that should have loaded showed an API-driven "not found"
state instead, with no thrown error) -- re-minting a fresh token
immediately before each run fixed it. Not root-caused (plausibly Keycloak
refresh-token rotation invalidating the earlier token once a new
password-grant login happened for the same user in between), but mint a
fresh cookie per verification run rather than reusing a saved one from
earlier in the session.

If `SESSION_SECRET`, the audience (`lis:session`), or `SessionPayload`'s
own fields ever change again in `apps/web/auth/session.ts`, diff this
recipe against the real interface before trusting it -- a stale recipe
fails silently (a rejected cookie looks identical to "not logged in" or,
worse, to the target page's own unrelated not-found state), not with an
error pointing back here.

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

**Look at the screenshot.** A blank frame or an unstyled page (classes
present in the DOM but no visible styling) is a real failure signal even
if the script reports no thrown errors.
