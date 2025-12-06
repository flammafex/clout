# Getting Started with Clout

This guide explains how to participate in the Clout network - whether you want to start your own network, join an existing one, or understand how networks connect.

## Understanding Clout's Model

**Important**: Clout is fundamentally different from traditional federated social networks like Mastodon.

| Concept | Traditional Federation (Mastodon) | Clout |
|---------|-----------------------------------|-------|
| **Server/Instance** | Separate servers you join | You configure your own infrastructure stack |
| **Who's the origin?** | Server admin creates the instance | You run your own Witness + Freebird + Relay |
| **Moderation** | Server admin controls visibility | Your personal trust graph controls visibility |
| **Federation** | Server-to-server protocol | User-to-user gossip; networks connect via shared infrastructure |
| **Anti-spam** | Server admin approves accounts | Freebird tokens + Day Pass system |

**The key insight**: In Clout, you don't "join someone's instance." You either:
1. **Start your own network** by running your own infrastructure (Witness, Freebird, Relay)
2. **Connect to an existing network** by pointing your node at shared infrastructure

---

## Architecture: The Three Infrastructure Components

Clout is built on three infrastructure services that you can run yourself:

```
┌─────────────────────────────────────────────────────────────┐
│                     YOUR CLOUT NODE                         │
│  (Identity, Posts, Trust Graph, Feed)                       │
└─────────────────────────────────────────────────────────────┘
          │                │                    │
          ▼                ▼                    ▼
   ┌────────────┐   ┌─────────────┐   ┌────────────────────┐
   │  WITNESS   │   │  FREEBIRD   │   │  HYPERTOKEN RELAY  │
   │ (Timestamp)│   │ (Anti-Sybil)│   │ (P2P Networking)   │
   └────────────┘   └─────────────┘   └────────────────────┘
```

| Component | Purpose | Source |
|-----------|---------|--------|
| **Witness** | Timestamping for proof-of-order | [Witness repo](https://github.com/flammafex/Witness) or fallback mode |
| **Freebird** | Anonymous anti-spam tokens (VOPRF) | [Freebird repo](https://github.com/flammafex/Freebird) or fallback mode |
| **HyperToken Relay** | WebRTC signaling, peer discovery | **Built into Clout** - you can run this |

---

## Option 1: Start Your Own Network (Be the Origin)

This is the primary use case. You run your own infrastructure and become the origin of your network.

### Step 1: Start the Relay Server

The relay server is built into Clout:

```bash
# Build Clout
npm install
npm run build
```

Create `start-relay.js`:
```javascript
import { RelayServer } from './dist/src/index.js';

const relay = new RelayServer({
  port: 3000,
  host: '0.0.0.0'
});

await relay.start();
console.log('Relay listening on ws://0.0.0.0:3000');
```

```bash
node start-relay.js
```

### Step 2: Set Up Witness (Timestamping)

**Option A: Run your own Witness server**

Deploy from the [Witness repository](https://github.com/flammafex/Witness):
```bash
# From Witness repo
cargo build --release
./target/release/witness-gateway --port 8080
```

**Option B: Use fallback mode (development/small networks)**

If no Witness gateway is configured, Clout automatically uses simulated local attestations. This is fine for development or small trusted networks where you don't need cryptographic proof-of-order.

### Step 3: Set Up Freebird (Anti-Spam Tokens)

**Option A: Run your own Freebird issuers**

Deploy from the [Freebird repository](https://github.com/flammafex/Freebird):
```bash
# From Freebird repo
cargo build --release
./target/release/freebird-issuer --port 8081
./target/release/freebird-verifier --port 8082
```

For MPC threshold issuance (recommended for production), run multiple issuers.

**Option B: Use fallback mode (development/small networks)**

If no Freebird issuers are configured, Clout uses hash-based simulated tokens. This is fine for development or small trusted networks where Sybil attacks aren't a concern.

### Step 4: Configure Your Node

Create `~/.clout/config.json`:

```json
{
  "witness": {
    "gatewayUrl": "http://localhost:8080"
  },
  "freebird": {
    "issuerEndpoints": ["http://localhost:8081"],
    "verifierUrl": "http://localhost:8082"
  },
  "hypertoken": {
    "relayUrl": "ws://localhost:3000"
  }
}
```

Or use environment variables:
```bash
export WITNESS_GATEWAY_URL=http://localhost:8080
export FREEBIRD_ISSUER_URL=http://localhost:8081
export FREEBIRD_VERIFIER_URL=http://localhost:8082
export HYPERTOKEN_RELAY_URL=ws://localhost:3000
```

### Step 5: Create Your Identity and Start Posting

```bash
# Create your identity
clout identity create

# You're the origin - no invitation needed!
# Get a day pass (uses your Freebird)
clout ticket

# Start posting
clout post "Hello from my own Clout network!"
```

### Step 6: Invite Friends to Your Network

Share your infrastructure URLs with friends. They configure their nodes to point at your services:

```json
{
  "witness": { "gatewayUrl": "http://your-server:8080" },
  "freebird": {
    "issuerEndpoints": ["http://your-server:8081"],
    "verifierUrl": "http://your-server:8082"
  },
  "hypertoken": { "relayUrl": "ws://your-server:3000" }
}
```

For anti-spam, you can issue invitations:
```bash
clout invite <friend-public-key>
```

Or if you have high reputation, delegate day passes directly:
```typescript
await clout.delegatePass(friendPublicKey, 24); // 24-hour pass
```

---

## Option 2: Connect to Someone's Network

If a friend is running Clout infrastructure and you want to join their network:

### Step 1: Get Their Infrastructure URLs

Your friend shares their configuration:
- Witness gateway URL
- Freebird issuer/verifier URLs
- HyperToken relay URL

### Step 2: Configure Your Node

```json
{
  "witness": { "gatewayUrl": "http://their-witness:8080" },
  "freebird": {
    "issuerEndpoints": ["http://their-freebird:8081"],
    "verifierUrl": "http://their-freebird:8082"
  },
  "hypertoken": { "relayUrl": "ws://their-relay:3000" }
}
```

### Step 3: Create Identity and Get Invited

```bash
clout identity create
clout id  # Share this public key with your friend
```

Your friend invites you:
```bash
clout invite <your-public-key>
```

### Step 4: Accept and Start Posting

```bash
# Accept invitation and get day pass
clout ticket

# Start posting
clout post "Hello!"

# Trust your friend
clout follow <friend-public-key>
```

---

## Option 3: Quick Start with Fallback Mode (Development Only)

For development or small trusted groups, you can skip external infrastructure by explicitly enabling insecure fallback mode.

**⚠️ SECURITY WARNING**: Fallback mode removes critical security guarantees:
- **No Sybil resistance** - Anyone can create unlimited fake accounts
- **No timestamp verification** - Timestamps can be forged
- **No double-spend protection** - Cannot detect malicious behavior

### Enabling Fallback Mode

Create `~/.clout/config.json`:

```json
{
  "witness": {
    "gatewayUrl": "http://localhost:8080",
    "allowInsecureFallback": true
  },
  "freebird": {
    "issuerEndpoints": ["http://localhost:8081"],
    "verifierUrl": "http://localhost:8082",
    "allowInsecureFallback": true
  },
  "hypertoken": {
    "relayUrl": "ws://localhost:3000"
  }
}
```

Or programmatically:

```typescript
const freebird = new FreebirdAdapter({
  issuerEndpoints: ['http://localhost:8081'],
  verifierUrl: 'http://localhost:8082',
  allowInsecureFallback: true  // ⚠️ INSECURE
});

const witness = new WitnessAdapter({
  gatewayUrl: 'http://localhost:8080',
  allowInsecureFallback: true  // ⚠️ INSECURE
});
```

### What Happens in Fallback Mode

When servers are unavailable and fallback is enabled:
- **Witness**: Uses fake local attestations with hash-based "signatures"
- **Freebird**: Uses 32-byte hash tokens instead of 130-byte VOPRF tokens
- **Warnings**: Loud console warnings are displayed

When fallback is **disabled** (default):
- Operations fail with clear error messages
- No silent degradation of security
- Forces you to fix infrastructure before proceeding

### When to Use Fallback Mode

✅ **Appropriate uses**:
- Local development and testing
- Demos and prototypes
- Very small trusted friend groups (< 10 people who all know each other)

❌ **Never use for**:
- Production deployments
- Networks with strangers
- Any scenario where spam/abuse is possible

---

## How Networks Connect ("Federation")

Networks connect when users from different infrastructure setups trust each other.

### Scenario: Two Independent Networks

**Network A**: Alice runs her own Witness + Freebird + Relay
**Network B**: Bob runs his own Witness + Freebird + Relay

These are completely separate until:

1. Alice and Bob meet (out of band)
2. They exchange public keys
3. Alice trusts Bob: `clout follow <bob-key>`
4. Bob trusts Alice: `clout follow <alice-key>`

Now:
- Posts from Alice propagate to Bob (and vice versa)
- Alice's friends can see Bob's posts (2 hops)
- Bob's friends can see Alice's posts (2 hops)
- The networks are **bridged through trust**, not infrastructure

### Shared Infrastructure

Alternatively, multiple communities can share infrastructure:

```
Community A ──┐
              │
Community B ──┼──► Shared Witness + Freebird + Relay
              │
Community C ──┘
```

Users from all communities can discover each other through the shared relay, but they still only see content from their trust graphs.

---

## Infrastructure Deep Dive

### HyperToken Relay (Built-in)

The relay server handles:
- **WebRTC Signaling**: ICE candidates, offer/answer exchange
- **NAT Traversal**: Helps peers behind firewalls connect
- **Peer Discovery**: Returns list of connected peers
- **Message Forwarding**: Routes messages to unreachable peers

```typescript
import { RelayServer } from 'clout';

const relay = new RelayServer({
  port: 3000,
  host: '0.0.0.0'
});

await relay.start();

// Check stats
console.log(relay.getStats());
// { connectedClients: 5, clients: [...] }
```

The relay is **optional infrastructure** - it helps with connectivity but doesn't control content.

### Witness (Timestamping)

Provides proof-of-order for posts and transactions:
- Threshold signatures from multiple witness nodes
- BLS12-381 aggregated signatures
- Prevents backdating attacks

Configuration supports multiple gateways for quorum:
```json
{
  "witness": {
    "gatewayUrls": [
      "http://witness-1:8080",
      "http://witness-2:8080",
      "http://witness-3:8080"
    ],
    "quorumThreshold": 2
  }
}
```

### Freebird (Anti-Sybil)

Issues anonymous tokens using VOPRF (Verifiable Oblivious Pseudorandom Function):
- P-256 curve with DLEQ proofs
- MPC threshold issuance across multiple issuers
- Tokens are unlinkable - privacy preserving

Configuration for MPC mode:
```json
{
  "freebird": {
    "issuerEndpoints": [
      "http://issuer-1:8081",
      "http://issuer-2:8081",
      "http://issuer-3:8081"
    ],
    "verifierUrl": "http://verifier:8082"
  }
}
```

### Tor-Only Relay Mode (Maximum Privacy)

For maximum privacy, run your relay as a Tor hidden service. This hides client IP addresses from the relay operator.

**Server Setup:**

1. Configure Tor hidden service in `/etc/tor/torrc`:
```
HiddenServiceDir /var/lib/tor/clout-relay/
HiddenServicePort 80 127.0.0.1:3000
```

2. Restart Tor and get your .onion address:
```bash
sudo systemctl restart tor
cat /var/lib/tor/clout-relay/hostname
# Example: abc123xyz.onion
```

3. Start relay in Tor-only mode:
```typescript
import { RelayServer } from 'clout';

const relay = new RelayServer({
  port: 3000,
  torOnly: true,  // Forces binding to 127.0.0.1
  onionAddress: 'abc123xyz.onion'  // For logging
});

await relay.start();
// [RelayServer] Started in Tor-only mode on 127.0.0.1:3000
// [RelayServer] Client IP addresses are hidden from relay operator
```

**Client Connection via Tor:**

```typescript
import { RelayClient } from 'clout';

const client = new RelayClient({
  publicKey: myPublicKey,
  nodeType: 'light',
  relayUrl: 'ws://abc123xyz.onion',
  privateKey: myPrivateKey,
  tor: {
    proxyHost: 'localhost',
    proxyPort: 9050  // Tor SOCKS5 proxy
  },
  requireTor: true  // Fail if Tor unavailable
});

await client.connect();
// [RelayClient] Connected to ws://abc123xyz.onion (via Tor)
```

**Privacy Guarantees:**
- Relay operator cannot see client IP addresses (only sees Tor circuits)
- Traffic analysis is prevented by Tor's onion routing
- Clients can verify they're using Tor via `client.isUsingTor()`

**Configuration for clients:**

```json
{
  "hypertoken": {
    "relayUrl": "ws://abc123xyz.onion"
  },
  "tor": {
    "enabled": true,
    "proxyHost": "localhost",
    "proxyPort": 9050
  }
}
```

---

## Trust-Based Content Propagation

Once you're on a network, content spreads through trust graphs:

```
1. You post "Hello world!"
   → Signed with your key
   → Timestamped by Witness
   → Broadcast to gossip network

2. Alice (who trusts you) receives the post
   → Checks: Are you in her trust graph (within 3 hops)?
   → YES: Alice accepts and re-propagates
   → NO: Post is silently dropped

3. Bob (who trusts Alice but not you)
   → Receives your post via Alice (2 hops)
   → If within his maxHops, he sees it
```

### Trust Graph Settings

```typescript
const clout = new Clout({
  // ...
  maxHops: 3,           // See posts up to 3 degrees away
  minReputation: 0.3,   // Minimum trust score required
  trustDecayDays: 365,  // Trust decays over time (1-year half-life)

  contentTypeFilters: {
    'slide': { maxHops: 5, minReputation: 0.2 },       // More permissive for DMs
    'image/png': { maxHops: 2, minReputation: 0.7 },   // Stricter for images
  }
});
```

---

## Docker Compose Example

Full stack deployment:

```yaml
version: '3'
services:
  relay:
    build: .
    command: node start-relay.js
    ports:
      - "3000:3000"

  witness:
    image: witness:latest  # From Witness repo
    ports:
      - "8080:8080"
    environment:
      - NETWORK_ID=my-network
      - THRESHOLD=2

  freebird-issuer:
    image: freebird:latest  # From Freebird repo
    ports:
      - "8081:8081"

  freebird-verifier:
    image: freebird:latest
    command: ["--verifier"]
    ports:
      - "8082:8082"

  clout-web:
    build: .
    command: npm run web
    ports:
      - "8000:3000"
    environment:
      - WITNESS_GATEWAY_URL=http://witness:8080
      - FREEBIRD_ISSUER_URL=http://freebird-issuer:8081
      - FREEBIRD_VERIFIER_URL=http://freebird-verifier:8082
      - HYPERTOKEN_RELAY_URL=ws://relay:3000
    depends_on:
      - relay
      - witness
      - freebird-issuer
      - freebird-verifier
```

---

## Privacy Features

### Encrypted Trust Signals (Default)

By default, Clout uses **encrypted trust signals** to hide your social graph from third parties.

**How it works:**
- When you trust someone (`clout follow <key>`), the trustee's identity is encrypted
- Only the trustee can decrypt to see who trusts them
- Third parties see the signal but cannot determine who is being trusted
- A cryptographic commitment prevents duplicate detection without revealing identity

**Privacy guarantees:**
| What | Visibility |
|------|------------|
| Truster identity | PUBLIC (needed for signature verification) |
| Trustee identity | ENCRYPTED (only trustee can decrypt) |
| Trust relationship | HIDDEN (observers cannot map social graph) |

**Configuration:**

```typescript
const clout = new Clout({
  publicKey: myPublicKey,
  privateKey: myPrivateKey,
  freebird,
  witness,

  // Privacy: encrypted trust signals (default: true)
  useEncryptedTrustSignals: true,
});
```

To disable (legacy plaintext mode, NOT recommended):
```typescript
const clout = new Clout({
  // ...
  useEncryptedTrustSignals: false, // ⚠️ Exposes social graph
});
```

**Cryptographic construction:**
- Commitment: `H(trustee || nonce)` - prevents duplicate detection attacks
- Encryption: X25519 ECDH + XChaCha20-Poly1305 AEAD
- Signature: Ed25519 over `(commitment || weight || timestamp)`

---

## Summary

| Goal | How to Do It |
|------|--------------|
| **Start your own network** | Run Relay (built-in) + Witness + Freebird, create identity |
| **Quick start (dev/small group)** | Just run Clout with fallback mode - no external services needed |
| **Join someone's network** | Configure their infrastructure URLs, get invited |
| **Connect two networks** | Users from each network trust each other |
| **Invite friends** | `clout invite <key>` or delegate day passes |

### Key Points

1. **You are the origin** - Configure your own infrastructure stack
2. **Fallback mode works** - Witness and Freebird have local fallbacks for development
3. **Relay is built-in** - You can run the HyperToken relay from this codebase
4. **Invitations are anti-spam** - Not access control; anyone can run their own network
5. **Networks connect through trust** - Not through infrastructure federation
6. **Privacy by default** - Encrypted trust signals hide your social graph

---

## CLI Quick Reference

```bash
# Identity
clout identity create           # Create new identity
clout identity list             # List identities
clout id                        # Show current identity

# Social
clout post "message"            # Create post
clout reply <postId> "message"  # Reply to post
clout follow <publicKey>        # Trust someone
clout feed                      # View your feed
clout thread <postId>           # View conversation

# Private Messages
clout slide <publicKey> "msg"   # Send encrypted DM
clout slides                    # View inbox

# Access
clout invite <publicKey>        # Create invitation
clout ticket                    # Check/get day pass
```
