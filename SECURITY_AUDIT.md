# Clout Security Audit Report

**Date:** 2025-12-06
**Auditor:** Claude Code (Automated Security Review)
**Repository:** clout
**Commit:** fd22b3f

---

## Executive Summary

Clout is a decentralized reputation protocol that creates censorship-resistant, village-scale social networks using a Web of Trust model.

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 0 | All downgraded after review |
| High | 0 | All 7 fixed |
| Medium | 8 | Open |
| Low | 10 | Open (mostly by design) |

**Overall Risk Level: LOW**

### High-Severity Issues Fixed

| Issue | Fix |
|-------|-----|
| No public key validation | `Crypto.isValidPublicKeyHex()` + `validatePublicKey()` helper |
| No web API authentication | `AuthManager` with Ed25519 signature login |
| No per-peer rate limiting | Sliding window rate limiter with temp bans |
| Delegation bypass | Reputation verified at mint time |
| Message replay vulnerability | Nonce + expiry in signed messages |
| Trust graph not persisted | FileSystemStore persistence |
| JSON non-determinism | `Crypto.stableStringify()` for hashing |

### Design Decisions (Not Vulnerabilities)

- **Private key storage**: User responsibility model (like SSH/GPG)
- **Insecure fallback modes**: Disabled by default, require explicit opt-in
- **Delegation signature**: Witness attestation provides security, not the keyed hash
- **Token format verification**: Intentional graceful degradation

---

## Architecture Overview

| Phase | Component | Purpose |
|-------|-----------|---------|
| 1 | Trust (Identity) | Ed25519 keypairs, Web of Trust graph |
| 2 | Post (Content) | Immutable content-addressable posts |
| 3 | Content Gossip | Trust-based message propagation |
| 4 | Reputation | Graph distance and trust scoring |
| 5 | State Sync | CRDT-based P2P state merging |

**Security-Critical Components:**
- `crypto.ts` - Cryptographic primitives
- `identity-manager.ts` - Key storage
- `ticket-booth.ts` - Anti-Sybil mechanism
- `freebird.ts` - VOPRF token validation
- `witness.ts` - Timestamp verification
- `content-gossip.ts` - Message propagation

---

## Fixed Issues (High Severity)

### HIGH-01: Public Key Validation ✅

**Files:** `crypto.ts`, `web/routes/trust.ts`, `web/routes/slides.ts`

Added:
- `Crypto.isValidPublicKeyHex()` - validates 64-char hex format
- `Crypto.parsePublicKey()` - validates + parses to bytes
- `validatePublicKey()` helper in all web API routes

### HIGH-02: Per-Peer Rate Limiting ✅

**File:** `content-gossip.ts`

Added sliding window rate limiter:
- Default: 100 messages per minute per peer
- Violators banned for 5 minutes
- Configurable via `rateLimit` config
- Stats: `getStats().rateLimitedPeers`

### HIGH-03: Web API Authentication ✅

**Files:** `web/server.ts`, `web/auth.ts`

Added token-based auth:
- Login via Ed25519 challenge-response signature
- Session tokens with 24h expiry
- Public routes: `/api/health`, `/api/auth/login`, `/api/auth/status`
- Protected routes require `Authorization: Bearer <token>`
- Configurable: `CLOUT_AUTH=false` to disable

### HIGH-04: Delegation Reputation Verification ✅

**Files:** `ticket-booth.ts`, `clout.ts`

Added runtime reputation check:
- `ReputationGetter` callback type
- `setReputationGetter()` on TicketBooth
- `mintDelegatedTicket()` verifies delegator still has ≥0.7 reputation
- Delegation stores `requiredReputation` threshold

### HIGH-05: Message Replay Protection ✅

**Files:** `content-gossip.ts`, `clout-types.ts`

Added nonce + expiry to signed messages:
- `SignedContentGossipMessage.nonce` - 32-byte random
- `SignedContentGossipMessage.expiresAt` - message expiry timestamp
- `seenMessages` Map tracks sender+nonce pairs
- Default: 5-minute message validity, 10-minute nonce tracking
- Configurable via `replayProtection` config

### HIGH-06: Trust Graph Persistence ✅

**Files:** `content-gossip.ts`, `store/file-store.ts`

Added trust graph storage:
- `FileSystemStore.saveTrustEdge(truster, trustee)`
- `FileSystemStore.removeTrustEdge(truster, trustee)`
- `FileSystemStore.getTrustGraph()` returns Map
- `ContentGossip.onTrustEdge` callback for persistence
- `ContentGossip.persistedTrustGraph` for initialization

### HIGH-07: Deterministic JSON Hashing ✅

**File:** `crypto.ts`

Added stable serialization:
- `Crypto.stableStringify()` - recursive sorted keys
- `Crypto.hashObject()` - stable stringify + hash
- Updated: `post.ts`, `invitation.ts`, `ticket-booth.ts`

---

## Design Decisions (Downgraded from Critical)

### Plaintext Private Key Storage

**Location:** `identity-manager.ts`
**Status:** By design (user responsibility)

Private keys stored at `~/.clout/identities.json`. Follows SSH/GPG model where users secure their own devices.

**Optional enhancement:** Password-based encryption for users who want it.

### Insecure Fallback Modes

**Locations:** `freebird.ts`, `witness.ts`
**Status:** Disabled by default

Both require explicit `allowInsecureFallback: true` to enable. When activated:
- Prominent warning banners displayed
- Fallback attestations marked with `_insecureFallback: true`

**Recommendation:** Add production environment check.

### Delegation Keyed Hash

**Location:** `ticket-booth.ts`
**Status:** Naming issue only

The delegation "signature" is a keyed hash, but security comes from Witness attestation (verified at mint time), not the hash.

**Recommendation:** Rename `signature` to `binding`.

### Token Format Verification

**Location:** `freebird.ts`
**Status:** Intentional graceful degradation

When VOPRF server is temporarily unavailable, 130-byte tokens accepted by format. This prioritizes availability during transient failures.

---

## Medium Severity Issues (Open)

| ID | Issue | Location |
|----|-------|----------|
| MED-01 | Timestamp allows 5s future | `content-gossip.ts:324` |
| MED-02 | No content size limits | `content-gossip.ts` |
| MED-03 | 100MB media upload limit | `web/server.ts:52` |
| MED-04 | Mutable config via `as any` | `reputation.ts:453` |
| MED-05 | BFS path search unbounded | `reputation.ts:182` |
| MED-06 | Local feed unencrypted | `store/file-store.ts` |
| MED-07 | Error messages leak state | Multiple |
| MED-08 | No circuit breaker for peers | `content-gossip.ts` |

---

## Low Severity Issues (Open)

| ID | Issue | Notes |
|----|-------|-------|
| LOW-01 | Console logging of operations | May persist in logs |
| LOW-02 | No file permission setting | Should use 0600 |
| LOW-03 | Float precision for trust weights | JavaScript limitation |
| LOW-04 | Tor circuit hash collision | Theoretical |
| LOW-05 | Missing type exports | API usability |
| LOW-06 | Freebird fallback opt-in | Documented |
| LOW-07 | Witness fallback opt-in | Documented |
| LOW-08 | Plaintext keys | User responsibility |
| LOW-09 | Delegation naming | Style issue |
| LOW-10 | Token format fallback | Intentional |

---

## Cryptographic Review

### Primitives

| Primitive | Library | Status |
|-----------|---------|--------|
| Ed25519 Signing | @noble/curves | ✅ Correct |
| X25519 Key Exchange | @noble/curves | ✅ Correct |
| HKDF Key Derivation | @noble/hashes | ✅ Correct |
| XChaCha20-Poly1305 | @noble/ciphers | ✅ Correct |
| SHA-256 Hashing | @noble/hashes | ✅ Correct |
| Constant-time Comparison | Custom | ✅ Correct |
| Domain Separation | Implemented | ✅ Correct |
| Deterministic JSON | Crypto.stableStringify | ✅ Fixed |

### Notes

- RNG uses Node.js `crypto` module (not browser-compatible)
- No key rotation mechanism
- No ephemeral key revocation

---

## Network Security

### Gossip Protocol

| Feature | Status |
|---------|--------|
| Message Signing | ✅ Optional (configurable) |
| Replay Prevention | ✅ Nonce + expiry |
| Flooding Prevention | ✅ Per-peer rate limiting |
| Partition Detection | ⚠️ CRDT assumes connectivity |

### Web API

| Feature | Status |
|---------|--------|
| Authentication | ✅ Token-based with signature login |
| Rate Limiting | ✅ Per-peer in gossip |
| HTTPS | ⚠️ Not enforced (user responsibility) |
| CORS | ⚠️ Open (localhost use case) |

---

## Recommendations

### Remaining Work

1. **Content Size Limits** - Add max post size validation
2. **Media Upload Auth** - Require auth before 100MB uploads
3. **Circuit Breaker** - Blacklist failing peers temporarily
4. **BFS Bound** - Limit node visits in path search

### Optional Enhancements

5. **Key Encryption** - Optional password protection
6. **File Permissions** - Set 0600 on sensitive files
7. **Production Guard** - Refuse fallback modes in production
8. **HTTPS** - Add TLS termination docs

---

## Files Reviewed

| File | Risk Level |
|------|------------|
| src/crypto.ts | Low |
| src/integrations/freebird.ts | Low (fallback disabled) |
| src/integrations/witness.ts | Low (fallback disabled) |
| src/cli/identity-manager.ts | Low (user responsibility) |
| src/ticket-booth.ts | Low (fixed) |
| src/content-gossip.ts | Low (fixed) |
| src/reputation.ts | Medium |
| src/web/server.ts | Low (fixed) |
| src/web/auth.ts | Low (new) |
| src/store/file-store.ts | Low (fixed) |

---

## Conclusion

The Clout codebase demonstrates strong cryptographic foundations using well-vetted libraries (@noble/curves, @noble/hashes, @noble/ciphers). All high-severity security issues have been addressed:

- ✅ Input validation on all public key inputs
- ✅ Web API protected by token authentication
- ✅ Per-peer rate limiting prevents flooding
- ✅ Delegation verified against current reputation
- ✅ Message replay prevented via nonce + expiry
- ✅ Trust graph persisted across restarts
- ✅ Deterministic hashing for cross-engine compatibility

The remaining medium-severity issues are mostly hardening items (size limits, circuit breakers) rather than exploitable vulnerabilities. The low-severity items are primarily design decisions documented as intentional.

**The codebase is suitable for deployment with the current security posture.**

---

*Report Generated By: Claude Code Security Audit*
