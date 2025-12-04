[<div align=center><img src="clout.webp">](https://carpocratian.org/en/church/)
[<div align=center><br><img src="church.png" width=72 height=72>](https://carpocratian.org/en/church/)

_A mission of [The Carpocratian Church of Commonality and Equality](https://carpocratian.org/en/church/)_.</div>
<div align=center><img src="mission.png" width=256 height=200></div></div>

# Clout - Uncensorable Reputation Protocol

**Clout** is an uncensorable reputation protocol that inverts the logic of [Scarcity](https://github.com/flammafex/Scarcity):

- **Scarcity uses gossip to STOP data** (prevent double-spends)
- **Clout uses gossip to SPREAD data** (posts and trust signals)

By leveraging the same cryptographic primitives (Freebird, Witness, HyperToken) used in Scarcity, Clout creates a censorship-resistant social protocol where your feed is determined by **your** web of trust, not by centralized algorithms.

## The Key Inversion

### Scarcity (Money Protocol)
- **Primitive**: Value (tokens)
- **Operation**: Transfer value, prevent double-spend
- **Gossip Logic**: "I've seen this spend, REJECT it"
- **Validator**: Checks if money is fake

### Clout (Reputation Protocol)
- **Primitive**: Trust (follow relationships)
- **Operation**: Post content, propagate to trusted network
- **Gossip Logic**: "I trust this author, ACCEPT and propagate it"
- **Validator**: Checks if author is trusted (graph distance)

## Architecture

Clout is built in 5 phases by refactoring Scarcity's core components:

### Phase 1: Trust (Identity)
- **Scarcity**: `createOwnershipProof` (proves you own money)
- **Clout**: `signContent` (proves you authored content)
- Uses Freebird for anonymous authorship proofs

### Phase 2: Post (Content)
- **Scarcity**: `ScarbuckToken` (value that can be spent)
- **Clout**: `CloutPost` (content that can only be read)
- Posts are content-addressable and immutable

### Phase 3: ContentGossip (Propagation)
- **Scarcity**: `NullifierGossip` (rejects if seen)
- **Clout**: `ContentGossip` (accepts if trusted)
- The "Shadowban" effect: untrusted content vanishes from your reality

### Phase 4: Reputation (Validation)
- **Scarcity**: `TransferValidator` (prevents double-spends)
- **Clout**: `ReputationValidator` (filters by graph distance)
- Scores based on trust paths: self=1.0, 1-hop=0.9, 2-hop=0.6, 3-hop=0.3

### Phase 5: State Sync (CRDT)
- Uses Chronicle (from HyperToken) for conflict-free state merging
- Your profile is a CRDT that syncs P2P
- Follow someone = merge their Chronicle into your view

## Installation

```bash
npm install
npm run build
```

## Quick Start

```typescript
import { Clout, Crypto, FreebirdAdapter, WitnessAdapter } from 'clout';

// Set up infrastructure
const keypair = Crypto.generateKeyPair();
const freebird = new FreebirdAdapter({
  issuerEndpoints: ['http://localhost:3000'],
  verifierUrl: 'http://localhost:3000'
});
const witness = new WitnessAdapter({
  endpoints: ['http://localhost:4000']
});

// Create Clout instance
const clout = new Clout({
  publicKey: keypair.publicKey,
  privateKey: keypair.privateKey.bytes,
  freebird,
  witness,
  maxHops: 3  // Show posts up to 3 degrees away
});

// Trust someone (like "following")
await clout.trust('0x1234...'); // Their public key

// Post content
const post = await clout.post('Hello, decentralized world!');

// Get your feed (only posts from trusted network)
const feed = clout.getFeed();
console.log(feed.posts);

// Get reputation of a user
const reputation = clout.getReputation('0x1234...');
console.log(reputation.distance); // Graph distance
console.log(reputation.score);    // Trust score (0-1)
```

## How It Works

### The "Shadowban" Effect

When you receive a post from the network:

1. **Trust Check**: Is the author within `maxHops` of your trust graph?
   - Yes → Accept and propagate to your peers
   - No → **Silently drop** (the "shadowban")

2. **Witness Verification**: Is the timestamp proof valid?

3. **Content Verification**: Does the content hash match the ID?

4. **Authorship Proof**: (Optional) Is the Freebird proof valid?

Posts from untrusted sources **vanish from your reality**. They never enter your feed, never get propagated by you. This creates **subjective, uncensorable feeds** where each user sees their own web of trust.

### Trust Graph

- **Distance 0**: You
- **Distance 1**: People you directly follow
- **Distance 2**: Friends of friends
- **Distance 3**: 3 degrees of separation
- **Distance 4+**: Too far (filtered out)

Each user computes their own feed based on their unique trust graph. There is no global feed, no centralized algorithm. Your reality is defined by who **you** trust.

## Comparison to Scarcity

| Component | Scarcity (Money) | Clout (Reputation) |
|-----------|------------------|-------------------|
| Primitive | Token (value) | Post (content) |
| Operation | transfer() | post() |
| Validation | Prevent double-spend | Check trust distance |
| Gossip | Broadcast nullifiers | Broadcast posts |
| Success Metric | Money not duplicated | Content reaches trusted network |
| Failure Mode | Double-spend detected | Post from untrusted source |

## Protocol Components

- **CloutIdentity**: Manages your identity and trust graph
- **CloutPost**: Creates immutable, timestamped posts
- **ContentGossip**: Propagates content through web of trust
- **ReputationValidator**: Filters content by graph distance
- **CloutStateManager**: CRDT-based state synchronization

## Advanced Usage

### Custom Reputation Thresholds

```typescript
const clout = new Clout({
  // ...config
  maxHops: 2,           // Only show up to 2 degrees
  minReputation: 0.5    // Minimum score of 0.5 required
});
```

### State Export/Import

```typescript
// Export state for backup
const state = clout.exportState();
localStorage.setItem('clout-state', state);

// Import state
const savedState = localStorage.getItem('clout-state');
clout.importState(savedState);
```

### P2P Mesh Networking

```typescript
// Add peer connection
clout.addPeer({
  id: 'peer-1',
  send: async (msg) => { /* send to peer */ },
  isConnected: () => true
});
```

## Dependencies

Clout reuses Scarcity's infrastructure:

- **Freebird**: Anonymous authorization using P-256 VOPRF
- **Witness**: Threshold timestamping for proof-of-order
- **HyperToken**: P2P networking and CRDT state sync
- **@noble/curves** & **@noble/hashes**: Cryptographic primitives

## License

Apache-2.0

## Credits

Built by refactoring [Scarcity](https://github.com/flammafex/Scarcity), which itself builds on:
- [Freebird](https://github.com/flammafex/Freebird)
- [Witness](https://github.com/flammafex/Witness)
- [HyperToken](https://github.com/flammafex/Hypertoken)

The architecture inverts Scarcity's "Conservation of Value" into Clout's "Propagation of Signal."
