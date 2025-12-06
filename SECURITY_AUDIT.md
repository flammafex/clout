# Clout Security Audit Report

**Date:** 2025-12-06
**Auditor:** Claude Code (Automated Security Review)
**Repository:** clout
**Version:** Latest (commit cb3a4f4)

---

## Executive Summary

Clout is a decentralized reputation protocol that creates censorship-resistant, village-scale social networks using a Web of Trust model. The security audit identified **5 critical**, **7 high**, **8 medium**, and **5 low** severity issues across cryptography, authentication, network communication, data storage, and anti-Sybil mechanisms.

**Overall Risk Level: HIGH**

The most critical findings relate to:
1. Plaintext storage of private keys
2. Insecure fallback modes that bypass all Sybil resistance
3. Missing signature implementation in ticket delegation
4. Lack of input validation across multiple components

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Critical Vulnerabilities](#critical-vulnerabilities)
3. [High Severity Issues](#high-severity-issues)
4. [Medium Severity Issues](#medium-severity-issues)
5. [Low Severity Issues](#low-severity-issues)
6. [Cryptographic Review](#cryptographic-review)
7. [Network Security](#network-security)
8. [Recommendations](#recommendations)

---

## Architecture Overview

Clout implements a five-phase architecture:

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
- `freebird.ts` - Token validation
- `witness.ts` - Timestamp verification
- `content-gossip.ts` - Message propagation

---

## Critical Vulnerabilities

### CRIT-01: Plaintext Private Key Storage

**Location:** `src/cli/identity-manager.ts:72-75`
**Severity:** CRITICAL
**CVSS Score:** 9.8

**Description:**
Private keys are stored in plaintext JSON at `~/.clout/identities.json` without any encryption or file permission restrictions.

```typescript
// src/cli/identity-manager.ts:72-75
private saveStore(): void {
  const data = JSON.stringify(this.store, null, 2);
  writeFileSync(this.identityPath, data, 'utf-8');  // No encryption, no chmod
}
```

**Impact:**
- Any local process can read private keys
- Full account takeover if device is compromised
- Keys persist after user logout

**Recommendation:**
1. Encrypt keys using password-derived AES-256-GCM
2. Set file permissions to `0600` on Unix systems
3. Consider OS keychain integration (macOS Keychain, Windows Credential Manager)

---

### CRIT-02: Insecure Fallback Mode in Freebird (Anti-Sybil Bypass)

**Location:** `src/integrations/freebird.ts:34, 170-174, 331-334`
**Severity:** CRITICAL
**CVSS Score:** 10.0

**Description:**
When `allowInsecureFallback: true` and no Freebird issuers are available, tokens are generated using simple SHA-256 hashes instead of VOPRF, completely bypassing Sybil resistance.

```typescript
// src/integrations/freebird.ts:170-174
// Fallback: simulated blinding (only reached if allowInsecureFallback is true)
const nonce = Crypto.randomBytes(32);
return Crypto.hash(publicKey.bytes, nonce);

// src/integrations/freebird.ts:331-334
// Fallback: simulated token
return Crypto.hash(blindedValue, 'ISSUED');
```

**Impact:**
- Unlimited account creation (Sybil attack)
- Spam flooding of the network
- Complete breakdown of reputation system

**Recommendation:**
1. Remove `allowInsecureFallback` option entirely
2. Require explicit user confirmation with prominent warning
3. Add monitoring/alerting when fallback mode is active

---

### CRIT-03: Insecure Fallback Mode in Witness (Timestamp Bypass)

**Location:** `src/integrations/witness.ts:33, 266-279`
**Severity:** CRITICAL
**CVSS Score:** 10.0

**Description:**
When `allowInsecureFallback: true` and no Witness gateways are available, attestations use fake local hashes instead of cryptographic signatures.

```typescript
// src/integrations/witness.ts:266-279
return {
  hash,
  timestamp: Date.now(),
  signatures: [
    Crypto.toHex(Crypto.hash(hash, 'witness-1')),
    Crypto.toHex(Crypto.hash(hash, 'witness-2')),
    Crypto.toHex(Crypto.hash(hash, 'witness-3'))
  ],
  witnessIds: ['witness-1', 'witness-2', 'witness-3'],
  _insecureFallback: true
};
```

**Impact:**
- Timestamps can be arbitrarily forged
- Double-spend detection is disabled
- Post ordering can be manipulated

**Recommendation:**
Same as CRIT-02: remove or require explicit opt-in with strong warnings.

---

### CRIT-04: Missing Cryptographic Signature in Ticket Delegation

**Location:** `src/ticket-booth.ts:174-175`
**Severity:** CRITICAL
**CVSS Score:** 8.5

**Description:**
The delegation signature uses a hash instead of a proper Ed25519 signature:

```typescript
// src/ticket-booth.ts:174-175
const payloadHash = Crypto.hashString(JSON.stringify(delegationPayload));
const signature = Crypto.hash(payloadHash, delegator.privateKey.bytes);
```

This is **not a signature** - it's a keyed hash. Anyone who sees the hash can verify it was created with that key, but it provides no non-repudiation or standard signature properties.

**Impact:**
- Delegation proofs are not cryptographically valid
- Cannot verify delegator actually authorized the delegation
- Potential for delegation forgery

**Recommendation:**
Replace with proper Ed25519 signature:
```typescript
const signature = Crypto.sign(Crypto.hash(payloadHash), delegator.privateKey.bytes);
```

---

### CRIT-05: Fallback Token Verification Accepts Invalid Tokens

**Location:** `src/integrations/freebird.ts:447-458`
**Severity:** CRITICAL
**CVSS Score:** 9.0

**Description:**
When server verification fails, tokens are accepted based solely on length:

```typescript
// src/integrations/freebird.ts:447-452
// Local verification based on token format
if (token.length === 130) {
  // Real VOPRF token format - accept (server verification failed but format is valid)
  console.warn('[Freebird] Using local format validation (server unavailable)');
  return true;
}
```

**Impact:**
- Attackers can forge 130-byte tokens
- No actual cryptographic verification performed
- Sybil resistance bypassed when verifier is temporarily unavailable

**Recommendation:**
Cache valid tokens locally with cryptographic proofs, or fail closed when verification is unavailable.

---

## High Severity Issues

### HIGH-01: No Public Key Validation

**Location:** Multiple files
**Severity:** HIGH

**Description:**
Public keys are accepted as hex strings without validation of:
- Length (Ed25519: 32 bytes, X25519: 32 bytes)
- Point validity (on curve check)
- Format (valid hex characters)

**Files Affected:**
- `crypto.ts` - `fromHex()` accepts any hex
- `content-gossip.ts` - Trust signals with arbitrary keys
- `web/server.ts` - API accepts user-provided keys

**Impact:**
- Invalid keys could cause cryptographic operations to fail
- Potential for denial-of-service via malformed keys
- Edge cases in curve operations

---

### HIGH-02: No Rate Limiting Per Peer

**Location:** `src/content-gossip.ts`
**Severity:** HIGH

**Description:**
The gossip protocol has no per-peer message rate limiting. Malicious peers can flood the network with messages.

```typescript
// Only global limits exist:
maxPosts: config.maxPosts ?? 100_000
```

**Impact:**
- Resource exhaustion attacks
- Memory/CPU denial-of-service
- Network congestion

---

### HIGH-03: Web API Has No Authentication

**Location:** `src/web/server.ts`
**Severity:** HIGH

**Description:**
The web server has no authentication mechanism. All endpoints are accessible without credentials.

```typescript
// src/web/server.ts:77-79
this.app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'online' });
});
```

**Impact:**
- Local privilege escalation if server binds to non-localhost
- Unauthorized posting/trust management
- Private key exposure via API

---

### HIGH-04: Delegation Bypass After Reputation Drop

**Location:** `src/ticket-booth.ts:149-196`
**Severity:** HIGH

**Description:**
Once a delegation is issued, there's no check that the delegator's reputation remains valid. A user could:
1. Achieve 0.7+ reputation
2. Delegate passes to multiple accounts
3. Have their reputation drop (e.g., unfollowed)
4. Recipients still use their delegated passes

---

### HIGH-05: Message Replay Vulnerability

**Location:** `src/content-gossip.ts`
**Severity:** HIGH

**Description:**
Messages are only deduplicated by content hash, not by sender+timestamp. Old valid messages could be replayed:

```typescript
// Only checks if message exists, not if it's a replay
if (this.seenPosts.has(key)) {
  return;
}
```

---

### HIGH-06: Trust Graph Not Persisted

**Location:** `src/content-gossip.ts:149-151`
**Severity:** HIGH

**Description:**
The trust adjacency list and hop distance cache are stored only in memory:

```typescript
private readonly trustAdjacencyList = new Map<string, Set<string>>();
private readonly hopDistanceCache = new Map<string, number>();
```

On restart, extended trust graph information is lost.

---

### HIGH-07: JSON Serialization Non-Determinism

**Location:** `src/ticket-booth.ts:72`, `src/crypto.ts:468`
**Severity:** HIGH

**Description:**
JSON.stringify() is used for creating hashes of objects, but JSON key ordering is not guaranteed:

```typescript
const payloadHash = Crypto.hashString(JSON.stringify(ticketPayload));
```

Different JavaScript engines could produce different hashes for the same logical object.

---

## Medium Severity Issues

### MED-01: Timestamp Validation Allows Future Dates

**Location:** `src/content-gossip.ts:324-327`
**Severity:** MEDIUM

**Description:**
Posts with timestamps up to 5 seconds in the future are accepted:

```typescript
if (post.proof.timestamp > now + 5000) {
  console.log(`[ContentGossip] Rejecting future post`);
  return;
}
```

While 5 seconds is reasonable for clock drift, combined with fallback mode this could be exploited.

---

### MED-02: No Content Size Limits

**Location:** `src/content-gossip.ts`, `src/clout-types.ts`
**Severity:** MEDIUM

**Description:**
Post content has no maximum size validation. Large posts could:
- Exhaust memory during gossip
- Cause storage issues
- Enable DoS attacks

---

### MED-03: Media Upload Size Limit Too High

**Location:** `src/web/server.ts:52-56`
**Severity:** MEDIUM

```typescript
this.app.use('/api/media/upload', express.raw({
  type: ['image/*', 'video/*', 'audio/*', 'application/pdf'],
  limit: '100mb'
}));
```

100MB uploads without authentication enables disk exhaustion attacks.

---

### MED-04: Mutable Config via Casts

**Location:** `src/reputation.ts:453-458`
**Severity:** MEDIUM

```typescript
setMinReputation(reputation: number): void {
  (this as any).minReputation = reputation;  // Bypasses readonly
}
```

Using `as any` to mutate readonly properties indicates a design issue.

---

### MED-05: BFS Path Search Not Bounded

**Location:** `src/reputation.ts:182-219`
**Severity:** MEDIUM

**Description:**
The BFS path finding has no node visit limit beyond depth. With a densely connected graph, this could be computationally expensive.

---

### MED-06: Local Feed Data Unencrypted

**Location:** `src/store/file-store.ts`
**Severity:** MEDIUM

**Description:**
Cached posts and slides are stored in plaintext at `~/.clout/local-data.json`.

---

### MED-07: Error Messages Leak Internal State

**Location:** Multiple files
**Severity:** MEDIUM

**Description:**
Error messages include internal details that could aid attackers:
- Public key prefixes
- Hop distances
- Configuration values

---

### MED-08: No Circuit Breaker for Failed Peers

**Location:** `src/content-gossip.ts`
**Severity:** MEDIUM

**Description:**
Failed peers are not temporarily blacklisted, leading to repeated connection attempts.

---

## Low Severity Issues

### LOW-01: Console Logging of Sensitive Operations

**Location:** Multiple files
**Severity:** LOW

**Description:**
Operations like "trusts us" and key prefixes are logged to console, which may persist in logs.

---

### LOW-02: No File Permission Setting

**Location:** `src/cli/identity-manager.ts:74`
**Severity:** LOW

**Description:**
`writeFileSync` doesn't set explicit permissions (`0600` recommended).

---

### LOW-03: Trust Weight Float Precision

**Location:** `src/reputation.ts`
**Severity:** LOW

**Description:**
Trust weights (0.1-1.0) use JavaScript floating point, which has precision issues.

---

### LOW-04: Tor Circuit Isolation Hash Collision

**Location:** `src/tor.ts`
**Severity:** LOW

**Description:**
Circuit isolation uses simple hashing which could theoretically collide.

---

### LOW-05: Missing Type Exports

**Location:** Various
**Severity:** LOW

**Description:**
Some internal types are not exported, making extension difficult.

---

## Cryptographic Review

### Strengths

| Primitive | Implementation | Status |
|-----------|---------------|--------|
| Ed25519 Signing | @noble/curves | Correct |
| X25519 Key Exchange | @noble/curves | Correct |
| HKDF Key Derivation | @noble/hashes | Correct |
| XChaCha20-Poly1305 | @noble/ciphers | Correct |
| SHA-256 Hashing | @noble/hashes | Correct |
| Constant-time Comparison | Custom | Correct |
| Domain Separation | Implemented | Correct |

### Concerns

1. **Random Number Generation**: Uses Node.js `crypto` module, not suitable for browser
2. **No Key Rotation Mechanism**: Master keys cannot be rotated
3. **Ephemeral Key Revocation**: No mechanism to revoke compromised ephemeral keys

---

## Network Security

### Gossip Protocol

| Feature | Status | Notes |
|---------|--------|-------|
| Message Signing | Optional | Should be mandatory |
| Replay Prevention | Partial | Timestamp-based only |
| Flooding Prevention | Missing | No per-peer limits |
| Partition Detection | Missing | CRDT assumes connectivity |

### Web API

| Feature | Status | Notes |
|---------|--------|-------|
| Authentication | Missing | No auth mechanism |
| HTTPS | Not enforced | HTTP only |
| CORS | Open | All origins allowed |
| Rate Limiting | Missing | DoS vulnerable |

---

## Recommendations

### Immediate Actions (Critical)

1. **Encrypt Private Keys**
   - Implement password-based encryption for `~/.clout/identities.json`
   - Set file permissions to 0600

2. **Remove Insecure Fallback Modes**
   - Make Freebird/Witness availability required
   - Or require explicit CLI flag with strong warnings

3. **Fix Delegation Signature**
   - Replace `Crypto.hash()` with `Crypto.sign()` in ticket-booth.ts

4. **Add Input Validation**
   - Validate public key lengths and formats
   - Add content size limits
   - Sanitize all user inputs

### Short-Term (High Priority)

5. **Add Web API Authentication**
   - Implement session tokens
   - Add rate limiting per IP/session

6. **Implement Per-Peer Rate Limiting**
   - Track message rates per peer
   - Temporarily ban flooding peers

7. **Persist Trust Graph**
   - Save adjacency list to disk
   - Restore on startup

8. **Add Replay Protection**
   - Include nonce/sequence numbers in messages
   - Track message IDs per sender

### Long-Term (Architecture)

9. **Formal Security Model**
   - Document trust assumptions
   - Define threat model

10. **Security Monitoring**
    - Add metrics for suspicious activity
    - Alert on fallback mode activation

11. **Key Management**
    - Implement key rotation
    - Support hardware security modules

---

## Files Reviewed

| File | Lines | Risk Level |
|------|-------|------------|
| src/crypto.ts | 576 | Low |
| src/integrations/freebird.ts | 499 | Critical |
| src/integrations/witness.ts | 707 | Critical |
| src/cli/identity-manager.ts | 221 | Critical |
| src/ticket-booth.ts | 288 | Critical |
| src/content-gossip.ts | 1036 | High |
| src/reputation.ts | 470 | Medium |
| src/web/server.ts | 227 | High |

---

## Conclusion

The Clout codebase demonstrates strong cryptographic foundations using well-vetted libraries (@noble/curves, @noble/hashes, @noble/ciphers). However, critical security issues exist in:

1. **Key Storage** - Plaintext private keys
2. **Fallback Modes** - Complete bypass of security controls
3. **Authentication** - Missing signature and missing API auth
4. **Input Validation** - Insufficient across all interfaces

These issues must be addressed before production deployment. The fallback modes in particular represent a complete breakdown of the security model when external services are unavailable.

---

**Report Generated By:** Claude Code Security Audit
**Classification:** For Development Team Use
