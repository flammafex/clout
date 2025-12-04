[<div align=center><img src="clout.webp">](https://carpocratian.org/en/church/)
[<div align=center><br><img src="church.png" width=72 height=72>](https://carpocratian.org/en/church/)

_A mission of [The Carpocratian Church of Commonality and Equality](https://carpocratian.org/en/church/)_.</div>
<div align=center><img src="mission.png" width=256 height=200></div></div>

# START SPREADING THE NEWS

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

## Features

### 🔐 Encrypted DMs (Slides)
End-to-end encrypted direct messages that propagate through the gossip network while remaining readable only by sender and recipient.

- **X25519 key exchange** with **XChaCha20-Poly1305 AEAD** encryption
- Messages called "slides" - encrypted DMs that slide through your network
- Ephemeral keypairs for forward secrecy
- No day pass required for sending slides

```bash
# Send an encrypted slide
clout slide <recipientPublicKey> "Your private message here"

# View your inbox
clout slides
```

### 💬 Replies & Threading
Flat thread model (Twitter/X style) with clickable posts and reply chains.

- Reply to any post with `replyTo` field
- View entire thread with parent post and all replies
- Navigate thread hierarchies with "View parent" links
- CLI: `clout reply <postId> "Your reply"` and `clout thread <postId>`

### 🌐 Web UI
Complete web interface for managing your Clout identity and interacting with the network.

```bash
# Start the web server
npm run web

# Open http://localhost:3000 in your browser
```

Features:
- **Feed tab**: View posts from your trust network
- **Post tab**: Create posts and replies
- **Trust tab**: Manage your web of trust
- **Slides tab**: Send/receive encrypted DMs
- **Thread tab**: Navigate conversation threads
- **Identity tab**: View your public key and identity info
- **Stats tab**: Network statistics

### 🆔 Identity Management
Cryptographic identity system for managing keypairs.

```bash
# Create a new identity
clout identity create

# List all identities
clout identity list

# Show your identity
clout id
```

Each identity consists of:
- **Public Key**: Your visible address (like a username)
- **Identity Name**: Local label for the keypair (only on your device)
- **Secret Key**: Stored securely in `~/.clout/identities.json`

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

## BE A PART OF IT

```bash
npm install
npm run build
```

## Quick Start

### CLI Usage

```bash
# Create your identity
clout identity create

# Post a message
clout post "Hello, decentralized world!"

# Reply to a post
clout reply <postId> "Great post!"

# Trust/follow someone
clout follow <publicKey>

# View your feed
clout feed

# View a conversation thread
clout thread <postId>

# Send an encrypted slide (DM)
clout slide <publicKey> "Private message"

# View your slides inbox
clout slides
```

### Programmatic Usage

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

// Reply to a post
const reply = await clout.post('Great point!', post.id);

// Send encrypted slide (DM)
const slide = await clout.slide('0x1234...', 'Private message');

// Get your feed (only posts from trusted network)
const feed = clout.getFeed();
console.log(feed.posts);

// Get your inbox (decrypted slides)
const inbox = clout.getInbox();
for (const slide of inbox.slides) {
  const message = clout.decryptSlide(slide);
  console.log(`From ${slide.sender}: ${message}`);
}

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

### The Dunbar Number and Network Scale

Clout's architecture is designed around **Dunbar's number** (~150) - the cognitive limit to the number of people with whom one can maintain stable social relationships.

#### Why 3 Hops?

The default `maxHops: 3` setting creates natural network boundaries that align with human cognitive limits:

- **Distance 1** (Direct trust): ~50-150 people you personally trust
- **Distance 2** (Friends of friends): ~2,500-22,500 people (50² to 150²)
- **Distance 3** (Extended network): ~125,000-3,375,000 people (50³ to 150³)

This creates a **self-regulating network size** where:
1. Your feed remains **cognitively manageable** (not millions of posts)
2. The network is **large enough** for content diversity
3. **Trust degrades naturally** with distance (0.9 → 0.6 → 0.3)

#### Contrast with Traditional Social Networks

Traditional platforms try to **exceed cognitive limits**:
- Facebook: Average 338 friends (>2× Dunbar's number)
- Twitter: No limit on follows (easily 1000+ for active users)
- Result: **Algorithmic curation becomes necessary** because humans can't process that much

Clout instead **respects cognitive limits**:
- Your direct trust list stays manageable (~150 or less)
- Extended network grows naturally through transitive trust
- No algorithmic feed curation needed - the trust graph itself provides natural filtering
- You maintain **meaningful relationships** rather than parasocial ones

#### The "Village Scale" Network

Think of Clout as creating **village-scale social networks**:
- **Distance 1**: Your village (~150 people)
- **Distance 2**: Neighboring villages you know through your villagers
- **Distance 3**: The extended region - far enough to be diverse, close enough to be trustworthy

This mirrors how humans **evolved to socialize** - in small, interconnected groups with transitive trust, not in massive anonymous crowds requiring algorithmic oversight.

#### Implications for Content Moderation

Because each user's feed is limited by their trust graph:
- **No global moderation needed** - you only see content from your extended network
- **Natural spam resistance** - spammers must infiltrate trust networks, not just create accounts
- **Subjective reality** - different trust graphs see entirely different "internets"
- **Cultural diversity** - isolated trust networks can maintain different norms without conflict

Clout's design acknowledges that **human social cognition doesn't scale infinitely**, and builds a protocol that works **with** our cognitive limits rather than against them.

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

- **IdentityManager**: Manages keypairs and cryptographic identities
- **CloutPost**: Creates immutable, timestamped posts with reply support
- **ContentGossip**: Propagates posts, slides, and trust signals through web of trust
- **ReputationValidator**: Filters content by graph distance
- **Crypto**: Encryption primitives (X25519 + XChaCha20-Poly1305)
- **TicketBooth**: Day pass system for spam prevention

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
