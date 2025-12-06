# Getting Started with Clout

This guide explains how to participate in the Clout network - whether you want to join an existing community, start your own, or understand how the network spreads content.

## Understanding Clout's Model

**Important**: Clout is fundamentally different from traditional federated social networks like Mastodon.

| Concept | Traditional Federation (Mastodon) | Clout |
|---------|-----------------------------------|-------|
| **Server/Instance** | Separate servers you join | No instances - pure P2P network |
| **Moderation** | Server admin controls visibility | Your personal trust graph controls visibility |
| **Federation** | Server-to-server protocol | User-to-user gossip based on trust |
| **Feed Algorithm** | Server-side computation | Client-side trust graph filtering |
| **Censorship** | Instance can ban you | No central authority - "shadowban" via not propagating |

In Clout, there are no "instances" to join. Instead, you:
1. Create a cryptographic identity
2. Get invited by someone already in the network (for anti-spam)
3. Build your **web of trust** by following people you trust
4. Your feed is determined by posts from your trust graph (up to 3 hops away by default)

---

## Joining Someone's Network (Being Invited)

To participate in Clout, you need to be invited by someone already in the network. This isn't about "joining their instance" - it's about being vouched for to prevent spam.

### Step 1: Create Your Identity

```bash
# Using CLI
clout identity create

# This generates:
# - Public Key: Your visible address (like a username)
# - Private Key: Stored securely in ~/.clout/identities.json
```

Or programmatically:
```typescript
import { Crypto } from 'clout';

const keypair = Crypto.generateKeyPair();
console.log('Your public key:', keypair.publicKey.hex);
// Share this with whoever will invite you
```

### Step 2: Share Your Public Key

Send your public key to someone who will invite you. They need this to create your invitation.

### Step 3: Receive and Accept Invitation

Your inviter will send you an invitation code:

```typescript
// Accept the invitation
const freebirdToken = await yourNode.acceptInvitation(invitationCode);
```

### Step 4: Get Your Day Pass

Exchange your Freebird token for a Day Pass (anti-spam measure):

```bash
# CLI
clout ticket
```

```typescript
// Programmatic
await clout.buyDayPass(freebirdToken);

// Duration depends on your reputation:
// - New users: 1 day
// - Reputation ≥0.5: 2 days
// - Reputation ≥0.7: 3 days
// - Reputation ≥0.9: 7 days
```

### Step 5: Trust Your Inviter (Optional but Recommended)

```bash
# CLI
clout follow <inviter-public-key>

# With custom trust weight (0.1 to 1.0)
clout follow <public-key> --weight 0.8
```

```typescript
// Programmatic
await clout.trust(inviterPublicKey);      // Full trust (1.0)
await clout.trust(inviterPublicKey, 0.8); // Partial trust (0.8)
```

### Step 6: Start Posting

```bash
# CLI
clout post "Hello, Clout!"
clout reply <post-id> "Great post!"

# Send encrypted DM
clout slide <public-key> "Private message"
```

---

## Starting Your Own Node and Inviting Friends

There's no "instance" to set up in the traditional sense. You run a Clout node, and you can invite friends to join the network through you.

### Option A: Web UI (Light Client)

The simplest way to run Clout:

```bash
# Start the web server
npm run web

# Open http://localhost:3000
```

This runs a **light client** that:
- Stores your identity locally
- Connects to relay servers for peer discovery
- Propagates content through your trust graph

### Option B: CLI Node

```bash
# Build Clout
npm install
npm run build

# Create your identity
clout identity create

# Start using Clout
clout post "Hello from my node!"
```

### Option C: Programmatic Node

```typescript
import { Clout, Crypto, FreebirdAdapter, WitnessAdapter } from 'clout';

// Generate identity
const keypair = Crypto.generateKeyPair();

// Connect to infrastructure
const freebird = new FreebirdAdapter({
  issuerEndpoints: ['http://freebird-server:8081'],
  verifierUrl: 'http://freebird-server:8082'
});

const witness = new WitnessAdapter({
  endpoints: ['http://witness-server:8080']
});

// Create Clout instance
const clout = new Clout({
  publicKey: keypair.publicKey.hex,
  privateKey: keypair.privateKey.bytes,
  freebird,
  witness,
  maxHops: 3,         // See posts up to 3 degrees away
  minReputation: 0.3  // Minimum trust score required
});
```

### Inviting Friends

Once you're in the network, you can invite others:

```typescript
// Create invitation for a friend
const invitation = await clout.invite(friendPublicKey, {
  message: "Welcome to Clout!"
});

// Share the invitation code with your friend
console.log('Invitation code:', invitation.code);
```

**For High-Reputation Users (≥0.7)**: You can delegate day passes directly:

```typescript
// Delegate a pass (no Freebird token needed by recipient)
await clout.delegatePass(friendPublicKey, 24); // 24-hour pass

// Limits:
// - Reputation ≥0.9: 10 delegations per week
// - Reputation ≥0.7: 5 delegations per week
```

Your friend accepts the delegation:
```typescript
await friend.acceptDelegatedPass();
```

---

## Infrastructure: Relay Servers

While Clout is P2P, **relay servers** provide optional infrastructure for:

1. **WebRTC Signaling** - Helps peers establish direct connections
2. **NAT Traversal** - Allows connections through firewalls
3. **Peer Discovery** - Bootstrap finding other nodes
4. **Message Forwarding** - For unreachable peers

### Running Your Own Relay

If you want to run infrastructure for your community:

```typescript
import { RelayServer } from 'clout';

const relay = new RelayServer({
  port: 3000,
  host: '0.0.0.0'
});

await relay.start();
// Relay now accepting WebSocket connections
```

Relay servers are **optional helpers** - they don't control content, can't censor, and don't store your data. They simply help peers find each other.

### Configuration

Configure your node to use specific infrastructure in `~/.scarcity/config.json`:

```json
{
  "witness": {
    "gatewayUrl": "http://witness-server:8080"
  },
  "freebird": {
    "issuerEndpoints": ["http://freebird-server:8081"],
    "verifierUrl": "http://freebird-server:8082"
  },
  "hypertoken": {
    "relayUrl": "ws://relay-server:3000"
  }
}
```

Or via environment variables:
```bash
WITNESS_GATEWAY_URL=http://witness:8080
FREEBIRD_ISSUER_URL=http://freebird:8081
FREEBIRD_VERIFIER_URL=http://freebird:8082
HYPERTOKEN_RELAY_URL=ws://relay:3000
```

---

## How "Federation" Works: Trust-Based Propagation

In Clout, there's no server-to-server federation. Instead, **content spreads through trust graphs**.

### The Propagation Flow

```
1. Alice posts "Hello world!"
   → Alice signs the post
   → Witness timestamps it
   → Post broadcasts to gossip network

2. Bob receives the post
   → Bob checks: Is Alice in my trust graph (within 3 hops)?
   → YES: Bob accepts and re-propagates to his peers
   → NO: Post is silently dropped (the "shadowban effect")

3. Charlie (who trusts Bob but not Alice)
   → If Charlie is within 3 hops of Alice via Bob, he sees the post
   → Otherwise, Alice's post never reaches Charlie's feed
```

### Your Trust Graph = Your "Instance"

| Distance | Who | Example Size | Trust Score |
|----------|-----|--------------|-------------|
| 0 | You | 1 | 1.0 |
| 1 | People you directly trust | ~50-150 (Dunbar's number) | 0.9 |
| 2 | Friends of friends | ~2,500-22,500 | 0.6 |
| 3 | Extended network | ~125,000-3.3M | 0.3 |
| 4+ | Too far - filtered out | - | - |

Each person's view of the network is **subjective** - determined entirely by their own trust graph.

### Weighted Trust

Trust isn't binary. You can assign weights:

```typescript
await clout.trust(aliceKey, 1.0);   // Full trust
await clout.trust(bobKey, 0.5);     // Partial trust
await clout.trust(charlieKey, 0.1); // Minimal trust
```

Trust weights multiply through paths:
- You trust Alice (0.8)
- Alice trusts Bob (0.7)
- Your effective trust in Bob = 0.8 × 0.7 = 0.56

### Temporal Decay

Trust relationships decay over time (default: 1-year half-life):

```typescript
const clout = new Clout({
  // ...
  trustDecayDays: 365  // Half-life (0 = no decay)
});

// Fresh trust: 1.0× multiplier
// 1 year old: 0.5× multiplier
// 2 years old: 0.25× multiplier
```

This keeps your network reflecting **active relationships**.

### Content-Type Filtering

Set different rules for different content:

```typescript
const clout = new Clout({
  maxHops: 3,
  minReputation: 0.3,
  contentTypeFilters: {
    'slide': { maxHops: 5, minReputation: 0.2 },       // More permissive for DMs
    'image/png': { maxHops: 2, minReputation: 0.7 },   // Stricter for images
  }
});
```

---

## Connecting Multiple Communities

Since Clout doesn't have instances, "connecting communities" happens naturally through **trust bridges**.

### Scenario: Two Groups

**Group A**: Alice's network (tech enthusiasts)
**Group B**: Bob's network (artists)

If Alice and Bob trust each other:
- Alice's network can see Bob's posts (and vice versa)
- Posts from Group B can reach Group A members through Alice
- The trust scores ensure only relevant content propagates

### Cross-Community Visibility

```
Group A:             Group B:
  ┌───┐               ┌───┐
  │ A │───────────────│ B │
  └───┘     Trust     └───┘
    │                   │
┌───┴───┐           ┌───┴───┐
│A1  A2 │           │B1  B2 │
└───────┘           └───────┘
```

- A1 and A2 see each other's posts (1 hop)
- A1 sees B's posts (2 hops via Alice)
- A1 sees B1's posts (3 hops: A1→Alice→Bob→B1)
- If B1 is too far, A1 never sees B1's posts

### No Central Federation Required

Unlike Mastodon where admins must configure server federation:
- No allowlists/blocklists to manage
- No "defederating" - just stop trusting someone
- Communities naturally connect through shared trust
- Different communities can have different norms without conflict

---

## Privacy Features

### Tor Integration

```typescript
import { TorProxy } from 'clout';

const torProxy = new TorProxy({
  proxyHost: 'localhost',
  proxyPort: 9050,
  circuitIsolation: true  // Separate circuits per destination
});
```

### Ephemeral Keys

Posts use rotating ephemeral keys (24-hour rotation) for forward secrecy:

```typescript
// Enabled by default
await clout.post('Hello world');

// Disable for permanent signature
await clout.post('Permanent record', { useEphemeralKey: false });
```

### Encrypted DMs (Slides)

End-to-end encrypted messages using X25519 + XChaCha20-Poly1305:

```bash
clout slide <recipient-key> "Private message"
```

---

## Quick Reference

### CLI Commands

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
clout ticket                    # Check day pass status
```

### Key Differences from Mastodon/Traditional Federation

1. **No servers to join** - You ARE the node
2. **No admins** - You control your own experience
3. **No global moderation** - Trust graph is the filter
4. **No federation agreements** - Trust bridges form naturally
5. **No algorithmic feed** - Just your trust graph
6. **No central point of failure** - Pure P2P

---

## Summary

| Task | How to Do It |
|------|--------------|
| **Join the network** | Get invited by someone, accept invitation, buy day pass |
| **Start your own node** | Run `npm run web` or build CLI, create identity |
| **Invite friends** | `clout invite <their-public-key>` or delegate pass |
| **Run infrastructure** | Optional: Run relay server for NAT traversal |
| **Connect communities** | Trust someone from another community |
| **"Federate"** | Automatic through trust - no configuration needed |

Clout respects Dunbar's number (~150 direct relationships) and creates **village-scale social networks** where your feed stays cognitively manageable without algorithmic curation.
