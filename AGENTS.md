# AGENTS.md

Guidance for AI coding agents (Codex, etc.) working in this repo. Read this before making changes.

## What this is

Clout is a decentralized, censorship-resistant social protocol. Each user holds a browser-native Ed25519 identity and a personal trust graph (stored in browser IndexedDB); content propagates P2P only within N trust "hops" of the author. The server is a thin relay/validator: it stores Day Pass anti-spam tickets and proxies VOPRF blinding requests to Freebird, but does not own the social graph.

Built as an inversion of the sibling Scarcity protocol (money/double-spend → reputation/signal-propagation).

## Repo layout

```
src/
  index.ts              # Public library entrypoint (re-exports)
  clout.ts              # Main Clout orchestration class (composes all modules)
  crypto.ts             # Cryptographic primitives — SECURITY-CRITICAL
  identity.ts           # Ed25519 identity — SECURITY-CRITICAL
  post.ts               # Post creation/signing
  content-gossip.ts     # Trust-based P2P propagation — SECURITY-CRITICAL
  reputation.ts         # Trust-graph distance scoring
  ticket-booth.ts       # Anti-Sybil Day Passes — SECURITY-CRITICAL
  invitation.ts         # Invitation codes
  tor.ts                # Tor SOCKS proxy
  clout/                # Domain modules (economics, content, media, trust, feed, reactions, messaging, state-sync, relay, profile, local-data)
  web/
    server.ts           # Express web server — primary runtime entrypoint (~310 lines, thin composition root)
    auth.ts             # Token-based session auth (disabled by default)
    routes/             # 12 route factories: feed, trust, media, slides, settings, data, submit, admin, opengraph, freebird-proxy, validation, index
    public/             # PWA frontend: index.html, manifest.json, service-worker.js, js/ (14 browser modules), *-browser.js crypto helpers
  cli/                  # CLI entrypoint + commands/ (identity, config, clout)
  integrations/         # Adapters: freebird, freebird-admin, witness, hypertoken
  store/                # Server persistence: file-store, user-data-store, profile-store
  storage/              # block-store.ts (content-addressed media, custom impl)
  chronicle/            # CRDT state (uses @automerge/automerge)
  vendor/               # Vendored: hypertoken/ (P2P transport), freebird/
test/
  integration/          # 9 integration test files (custom Node scripts, no framework)
  unit/                 # 3 unit test files
  run-integration-tests.ts  # Custom spawn-based runner — includes 5 of 9 (omits 05-live-services + 3 others)
docker-compose.yaml     # Full stack: clout + cli + freebird issuer/verifier + redis + 3-node witness + gateway + hypertoken relay
Dockerfile              # Multi-stage: builder, runtime (web), cli
.forgejo/workflows/     # CI: docker.yml only (builds/pushes images — does NOT run tests or lint)
docs/GETTING-STARTED.md # Architecture deep-dive
SECURITY_AUDIT.md       # 2025-12-06 audit; 7 high fixed, 8 medium / 10 low open
```

## Setup / run / test / lint / build

```bash
npm ci                              # install (native module: @roamhq/wrtc)
npm run build                        # tsc && copy-static (copies web/public to dist/)
npm run web                          # build + run web server on PORT (default 3000)
npm run web:dev                      # build (no watch) + run
npm run dev                          # tsc --watch (no server)
npm run lint                         # eslint src/
npm test                             # build + run integration tests via custom runner
npm run test:basic                   # single integration test (01)
npm run test:double-spend            # 02
npm run test:degradation             # 03
npm run test:phase3                  # 04
npm run test:live                     # 05 (NOT included in `npm test` — run manually)
npm run clean                        # rm dist/build/coverage/tmp
docker compose up --build            # full stack on localhost
docker compose run --rm cli <cmd>    # CLI commands
```

Node 20.

## Coding conventions

- **ESM throughout.** `"type": "module"`. Use `.js` extensions in relative imports (TS ESM resolution). Derive `__dirname` via `fileURLToPath(import.meta.url)`.
- **Strict TS, relaxed ESLint.** `strict: true` in tsconfig. `@typescript-eslint/no-explicit-any` is `warn` (not error); `no-unsafe-*` rules are off "initially"; `no-floating-promises` off "Enable later". Underscore-prefixed unused vars allowed. Don't tighten these globally without owner approval — existing code relies on the leniency.
- **Module pattern.** Domain logic in focused classes under `src/clout/` (e.g. `CloutEconomics`, `CloutTrust`), composed by the `Clout` facade in `src/clout.ts`. Route handlers are factory functions `createXRoutes(deps)` that inject dependencies via closures (see `src/web/routes/`).
- **Error handling.** Routes `try/catch` and return `{ success: false, error: message }` JSON. Production hides internal details. Don't leak stack traces.
- **Logging.** `console.log`/`warn` is allowed (`no-console: off`). Use `[Bootstrap]`/`[Server]`/`[Module]` prefixes and truncate keys (`key.slice(0, 16)...`) — never log full keys or tokens.
- **Naming.** PascalCase classes, camelCase functions, `Clout` prefix on domain classes.
- **Hashing.** Use `Crypto.stableStringify()` for any JSON that gets hashed — key ordering matters for signature verification.

## Testing expectations

- **No test framework.** Tests are plain Node scripts spawned sequentially by `test/run-integration-tests.ts`. No Jest/Mocha/Vitest, no coverage tooling.
- **The runner omits `05-live-services.test.ts`** — only files 01–04 run under `npm test`. Run `npm run test:live` separately if you need it.
- **Tests require a build first** (`npm run build` is part of every test script).
- **No CI gate.** Forgejo CI (`.forgejo/workflows/docker.yml`) only builds/pushes Docker images on push to `main` or tags. It does NOT run `npm test` or `npm run lint`. You must run both locally before requesting review.
- **Integration tests are the primary safety net.** Unit tests are minimal (3 files). Security-critical modules (`crypto.ts`, `identity.ts`, `ticket-booth.ts`, `content-gossip.ts`) depend on these few tests — don't break them.
- When adding a new integration test file, **also add it to the `tests` array in `test/run-integration-tests.ts`** or it won't run.

## PR / review expectations

- Run `npm run lint && npm run build && npm test` locally before opening a PR. All must pass.
- Keep changes minimal and focused. Don't reformat unrelated code.
- Don't commit `dist/`, `.env`, or `data/` (all in `.gitignore`).
- Commit messages follow existing style: `feat:`, `fix:`, `chore:` prefixes (see `git log`).
- For security-sensitive changes (crypto, identity, trust, auth, anti-Sybil), summarize the threat model in the PR description and reference `SECURITY_AUDIT.md` if relevant.
- For new env vars, update `.env.example` and document in the PR.
- For new API routes, follow the factory pattern in `src/web/routes/` and add appropriate rate limiting if the route is abuse-prone.

## Constraints — ask before touching

1. **Crypto & identity** (`src/crypto.ts`, `src/identity.ts`, `src/ticket-booth.ts`, `src/content-gossip.ts`, canonical hashing in trust signals). Any change here can break signature verification across the network. Read `SECURITY_AUDIT.md` first.
2. **Trust signal canonical format** — the plaintext format (`hashObject({truster, trustee, weight, timestamp, revoked?})`, witness proof hash MUST equal payload hash, Ed25519 over `CLOUT_TRUST_SIGNAL_V1:{payloadHash}`) is a wire protocol. Don't change it without a migration plan.
3. **Insecure fallback modes** (Witness/Freebird `allowInsecureFallback`) — don't enable by default, don't make fallback silent.
4. **Auth defaults** — `CLOUT_AUTH=false` and visitor mode are on by default. Don't "harden" by flipping defaults without owner sign-off; local-first use depends on it.
5. **`src/web/invitation-redemption.ts` in-memory state** (`invitationCodeToInviter`, `usedInvitationCodes`, `pendingInvitationClaims`, etc.) is a multi-step invitation redemption state machine. If you touch it, preserve the reserve→mint→consume ordering and the 15-min pending-claim cleanup.
7. **External service contracts** (Freebird VOPRF, Witness threshold signatures, HyperToken relay protocol) — these are separate Rust repos. Don't change client adapters in ways that assume newer server versions without confirming compatibility.

## Definition of done

A change is complete when:

- [ ] `npm run lint` passes with no new warnings (existing `any`/`unsafe-*` warnings are acceptable; don't introduce new ones needlessly).
- [ ] `npm run build` succeeds (TS compiles, static assets copied to `dist/`).
- [ ] `npm test` passes (all 4 runner-included integration tests green).
- [ ] If you added a new test file, it's registered in `test/run-integration-tests.ts`.
- [ ] If you changed env vars, `.env.example` is updated.
- [ ] If you changed the public API (`src/index.ts` exports), types are updated and downstream callers (`src/web/`, `src/cli/`) still compile.
- [ ] If you touched crypto/identity/trust/auth/anti-Sybil: PR description includes threat-model notes.
- [ ] If you touched `src/web/invitation-redemption.ts` invitation state: the reserve→mint→consume flow and restart-durability (`invitations.json` reload) still hold.
- [ ] No secrets, private keys, or full public keys logged. Keys truncated to ≤16 chars in logs.
- [ ] `dist/` is not committed.
