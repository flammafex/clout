/* tslint:disable */
/* eslint-disable */

export class ActionDispatcher {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Batch draw from multiple decks (typed, zero overhead)
   *
   * Takes JSON array of token arrays and array of draw counts.
   * Returns drawn cards and updated decks.
   *
   * Example:
   * ```js
   * const result = dispatcher.batchDraw(
   *   JSON.stringify(decks),
   *   JSON.stringify([3, 2, 5])
   * );
   * // result: { drawn: [[...], [...]], decks: [[...], [...]] }
   * ```
   */
  batchDraw(decks_json: string, counts_json: string): string;
  /**
   * Find a token in a list matching a predicate
   */
  batchFind(tokens_json: string, predicate: string): string;
  /**
   * Pause the game (typed, zero overhead)
   */
  gamePause(): string;
  /**
   * Start the game (typed, zero overhead)
   */
  gameStart(): string;
  /**
   * Get the source instance
   */
  getSource(): Source | undefined;
  /**
   * Set the source instance
   */
  setSource(source: Source): void;
  /**
   * Flip token in zone (typed, zero overhead)
   */
  spaceFlip(zone: string, token_id: string): void;
  /**
   * Move token between zones (typed, zero overhead)
   */
  spaceMove(token_id: string, from_zone: string, to_zone: string, x?: number | null, y?: number | null): void;
  /**
   * Burn cards from stack (typed, zero overhead)
   */
  stackBurn(count: number): string;
  /**
   * Draw cards from stack (typed, zero overhead)
   */
  stackDraw(count: number): string;
  /**
   * Peek at top cards of stack (typed, zero overhead)
   */
  stackPeek(count: number): string;
  /**
   * Swap two tokens (typed, zero overhead)
   */
  stackSwap(index_a: number, index_b: number): void;
  /**
   * Agent Trade (Wrapper)
   */
  agentTrade(agent1: string, offer1: string, agent2: string, offer2: string): string;
  /**
   * Count tokens in a list matching a predicate
   */
  batchCount(tokens_json: string, predicate: string): number;
  /**
   * Resume the game from pause (typed, zero overhead)
   */
  gameResume(): string;
  /**
   * Burn from source (typed, zero overhead)
   */
  sourceBurn(count: number): string;
  /**
   * Draw from source (typed, zero overhead)
   */
  sourceDraw(count: number): string;
  spaceClear(): void;
  /**
   * Place token in zone (typed, zero overhead)
   */
  spacePlace(zone: string, token_json: string, x?: number | null, y?: number | null): string;
  spaceStack(zone: string, x: number, y: number, off_x: number, off_y: number): void;
  /**
   * Reset stack to initial state (typed, zero overhead)
   */
  stackReset(): void;
  /**
   * Merge multiple tokens into one (typed, zero overhead)
   */
  tokenMerge(tokens_json: string, result_properties_json: string | null | undefined, keep_originals: boolean): string;
  /**
   * Split a token into multiple tokens (typed, zero overhead)
   */
  tokenSplit(token_json: string, count: number, properties_array_json?: string | null): string;
  /**
   * Create an agent (typed, zero overhead)
   */
  agentCreate(id: string, name: string, meta_json?: string | null): string;
  /**
   * Remove an agent (typed, zero overhead)
   */
  agentRemove(name: string): void;
  /**
   * Filter tokens with predefined predicate (typed, zero overhead)
   *
   * Supported predicates:
   * - "reversed": Filter reversed tokens
   * - "normal": Filter normal (non-reversed) tokens
   * - "merged": Filter merged tokens
   * - "split": Filter split tokens
   *
   * Example:
   * ```js
   * const filtered = dispatcher.batchFilter(
   *   JSON.stringify(tokens),
   *   "reversed"
   * );
   * ```
   */
  batchFilter(tokens_json: string, predicate: string): string;
  /**
   * Reset the source
   */
  sourceReset(tokens_json?: string | null): void;
  /**
   * Remove token from zone (typed, zero overhead)
   */
  spaceRemove(zone: string, token_id: string): string;
  spaceSpread(zone: string, x: number, y: number, spacing: number, horizontal: boolean): void;
  /**
   * Attach a token to another token (typed, zero overhead)
   */
  tokenAttach(host_json: string, attachment_json: string, attachment_type: string): string;
  /**
   * Detach a token from its host (typed, zero overhead)
   */
  tokenDetach(host_json: string, attachment_id: string): string;
  /**
   * Get all agents (typed, zero overhead)
   */
  agentGetAll(): string;
  /**
   * Collect tokens from multiple sources
   * 
   * Sources: "stack", "discard", "source", or any zone name (e.g., "hand")
   */
  batchCollect(sources_json: string): string;
  /**
   * Batch shuffle multiple decks (typed, zero overhead)
   *
   * Takes JSON array of token arrays, returns shuffled arrays.
   *
   * Example:
   * ```js
   * const decks = [[token1, token2], [token3, token4]];
   * const shuffled = dispatcher.batchShuffle(JSON.stringify(decks), "seed");
   * ```
   */
  batchShuffle(decks_json: string, seed_prefix?: string | null): string;
  /**
   * Reverse the stack
   */
  stackReverse(): void;
  /**
   * Shuffle stack with optional seed (typed, zero overhead)
   */
  stackShuffle(seed?: string | null): void;
  /**
   * Apply an operation to all tokens (forEach equivalent)
   * Maps to parallel_map for high-performance state updates
   */
  batchForEach(tokens_json: string, operation: string): string;
  /**
   * Get current game state (typed, zero overhead)
   */
  gameGetState(): string;
  /**
   * Inspect source
   */
  sourceInspect(): string;
  /**
   * Shuffle source (typed, zero overhead)
   */
  sourceShuffle(seed?: string | null): void;
  /**
   * Add token to agent's inventory (typed, zero overhead)
   */
  agentAddToken(name: string, token_json: string): void;
  /**
   * Advance to next phase or set specific phase (typed, zero overhead)
   */
  gameNextPhase(phase?: string | null): string;
  /**
   * Lock or unlock zone (typed, zero overhead)
   */
  spaceLockZone(name: string, locked: boolean): void;
  /**
   * Insert token at index (typed, zero overhead)
   */
  stackInsertAt(index: number, token_json: string): void;
  /**
   * Remove token at index (typed, zero overhead)
   */
  stackRemoveAt(index: number): string;
  /**
   * Transform a token by applying properties (typed, zero overhead)
   */
  tokenTransform(token_json: string, properties_json: string): string;
  /**
   * Agent draws cards from the Stack
   */
  agentDrawCards(agent_name: string, count: number): string;
  /**
   * Set agent active state (typed, zero overhead)
   */
  agentSetActive(name: string, active: boolean): void;
  /**
   * Add a stack to the source
   * Expects JSON with { "stack": { "stack": [Tokens...] }, "id": "optional-id" }
   */
  sourceAddStack(stack_json: string, stack_id?: string | null): void;
  /**
   * Clear all tokens from zone (typed, zero overhead)
   */
  spaceClearZone(name: string): void;
  /**
   * Steal token from another agent (typed, zero overhead)
   */
  agentStealToken(from: string, to: string, token_id: string): string;
  /**
   * Set arbitrary game state property (typed, zero overhead)
   */
  gameSetProperty(key: string, value_json: string): string;
  /**
   * Create new zone (typed, zero overhead)
   */
  spaceCreateZone(name: string): void;
  /**
   * Delete zone (typed, zero overhead)
   */
  spaceDeleteZone(name: string): void;
  /**
   * Remove token from agent's inventory (typed, zero overhead)
   */
  agentRemoveToken(name: string, token_id: string): string;
  /**
   * Shuffle tokens in zone (typed, zero overhead)
   */
  spaceShuffleZone(name: string, seed?: string | null): void;
  /**
   * Agent discards cards to the Stack's discard pile
   */
  agentDiscardCards(agent_name: string, token_ids_json: string): string;
  /**
   * Give resource to agent (typed, zero overhead)
   */
  agentGiveResource(name: string, resource: string, amount: bigint): void;
  /**
   * Take resource from agent (typed, zero overhead)
   */
  agentTakeResource(name: string, resource: string, amount: bigint): void;
  /**
   * Remove a stack from the source
   */
  sourceRemoveStack(stack_id: string): void;
  spaceTransferZone(from_zone: string, to_zone: string): number;
  /**
   * Steal resource from another agent (typed, zero overhead)
   */
  agentStealResource(from: string, to: string, resource: string, amount: bigint): string;
  /**
   * Transfer token between agents (typed, zero overhead)
   */
  agentTransferToken(from: string, to: string, token_id: string): string;
  /**
   * Transfer resource between agents (typed, zero overhead)
   */
  agentTransferResource(from: string, to: string, resource: string, amount: bigint): string;
  /**
   * Create a new ActionDispatcher
   */
  constructor();
  /**
   * End the game (typed, zero overhead)
   */
  gameEnd(winner?: string | null, reason?: string | null): string;
  /**
   * Get agent data (typed, zero overhead)
   */
  agentGet(name: string): string;
  /**
   * Map tokens with predefined operation (typed, zero overhead)
   *
   * Supported operations:
   * - "flip": Toggle reversal state
   * - "merge": Mark all as merged
   * - "unmerge": Mark all as unmerged
   *
   * Example:
   * ```js
   * const flipped = dispatcher.batchMap(
   *   JSON.stringify(tokens),
   *   "flip"
   * );
   * ```
   */
  batchMap(tokens_json: string, operation: string): string;
  /**
   * Get the space instance
   */
  getSpace(): Space | undefined;
  /**
   * Get the stack instance
   */
  getStack(): Stack | undefined;
  /**
   * Set the space instance
   */
  setSpace(space: Space): void;
  /**
   * Set the stack instance
   */
  setStack(stack: Stack): void;
  spaceFan(zone: string, x: number, y: number, radius: number, angle_start: number, angle_step: number): void;
  /**
   * Cut stack at index (typed, zero overhead)
   */
  stackCut(index: number): void;
}

export class AgentManager {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Steal token from another agent
   */
  stealToken(from: string, to: string, token_id: string): string;
  /**
   * Create a new agent
   */
  createAgent(id: string, name: string, meta_json?: string | null): string;
  /**
   * Remove an agent
   */
  removeAgent(name: string): void;
  /**
   * Remove token from agent's inventory
   */
  removeToken(name: string, token_id: string): string;
  /**
   * Give resources to an agent
   */
  giveResource(name: string, resource: string, amount: bigint): void;
  /**
   * Take resources from an agent
   */
  takeResource(name: string, resource: string, amount: bigint): void;
  /**
   * Get all agents as JSON array
   */
  getAllAgents(): string;
  /**
   * Steal resource from another agent
   */
  stealResource(from: string, to: string, resource: string, amount: bigint): string;
  /**
   * Transfer token between agents
   */
  transferToken(from: string, to: string, token_id: string): string;
  /**
   * Set agent active state
   */
  setAgentActive(name: string, active: boolean): void;
  /**
   * Transfer resource between agents
   */
  transferResource(from: string, to: string, resource: string, amount: bigint): string;
  /**
   * Create a new Agent manager
   */
  constructor();
  trade(agent1_name: string, offer1_json: string, agent2_name: string, offer2_json: string): string;
  /**
   * Add token to agent's inventory
   */
  addToken(name: string, token_json: string): void;
  /**
   * Get agent state as JSON
   */
  getAgent(name: string): string;
}

export class BatchOps {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Batch draw from multiple decks
   *
   * Takes JSON array of token arrays and array of draw counts.
   * Returns drawn cards and updated decks.
   *
   * Example:
   * ```js
   * const result = batchOps.batchDraw(
   *   JSON.stringify(decks),
   *   JSON.stringify([3, 2, 5])  // Draw 3 from first deck, 2 from second, etc.
   * );
   * // result: { drawn: [[...], [...], [...]], decks: [[...], [...], [...]] }
   * ```
   */
  batchDraw(decks_json: string, counts_json: string): string;
  /**
   * Parallel map operation on tokens
   *
   * Applies a transformation to all tokens efficiently.
   * The transformer is specified as a string operation type.
   *
   * Supported operations:
   * - "flip": Toggle faceUp state
   * - "lock": Set locked = true
   * - "unlock": Set locked = false
   *
   * Example:
   * ```js
   * const flipped = batchOps.parallelMap(
   *   JSON.stringify(tokens),
   *   "flip"
   * );
   * ```
   */
  parallelMap(tokens_json: string, operation: string): string;
  /**
   * Batch shuffle multiple decks
   *
   * Takes JSON array of token arrays, returns shuffled arrays.
   *
   * Example:
   * ```js
   * const batchOps = new BatchOps();
   * const decks = [
   *   [token1, token2, token3],
   *   [token4, token5, token6],
   * ];
   *
   * const shuffled = batchOps.batchShuffle(JSON.stringify(decks), "seed");
   * ```
   */
  batchShuffle(decks_json: string, seed_prefix?: string | null): string;
  /**
   * Parallel find operation
   *
   * Returns the first token matching the predicate.
   */
  parallelFind(tokens_json: string, predicate: string): string;
  /**
   * Parallel count operation
   *
   * Returns the number of tokens matching the predicate.
   */
  parallelCount(tokens_json: string, predicate: string): number;
  /**
   * Parallel filter operation on tokens
   *
   * Filters tokens based on a predicate efficiently.
   *
   * Supported predicates:
   * - "faceUp": Filter face-up tokens
   * - "faceDown": Filter face-down tokens
   * - "locked": Filter locked tokens
   * - "unlocked": Filter unlocked tokens
   *
   * Example:
   * ```js
   * const faceUpTokens = batchOps.parallelFilter(
   *   JSON.stringify(tokens),
   *   "faceUp"
   * );
   * ```
   */
  parallelFilter(tokens_json: string, predicate: string): string;
  /**
   * Create a new BatchOps instance
   */
  constructor();
}

export class Chronicle {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Get the number of changes in the document
   */
  changeCount(): number;
  /**
   * Save document to Base64 string (for easier transport)
   */
  saveToBase64(): string;
  /**
   * Load document from Base64 string
   */
  loadFromBase64(base64: string): void;
  /**
   * Receive a sync message and update the document
   *
   * Takes:
   * - message_base64: The sync message from the peer (base64 encoded)
   * - sync_state_bytes: Optional serialized SyncState
   *
   * Returns: JSON with updated sync state and any response message
   */
  receiveSyncMessage(message_base64: string, sync_state_bytes?: Uint8Array | null): string;
  /**
   * Generate a sync message for incremental synchronization
   *
   * Takes an optional serialized SyncState from a previous sync.
   * Returns a tuple: (sync_message, new_sync_state) as JSON.
   *
   * Usage:
   * ```js
   * // First sync (no prior state)
   * const result = chronicle.generateSyncMessage(null);
   * const { message, syncState } = JSON.parse(result);
   *
   * // Subsequent syncs (use saved sync state)
   * const result2 = chronicle.generateSyncMessage(syncState);
   * ```
   */
  generateSyncMessage(sync_state_bytes?: Uint8Array | null): string;
  /**
   * Create a new Chronicle with an empty CRDT document
   */
  constructor();
  /**
   * Load a document from binary format
   */
  load(data: Uint8Array): void;
  /**
   * Save the document to a binary format
   */
  save(): Uint8Array;
  /**
   * Merge another document into this one
   */
  merge(other_data: Uint8Array): void;
  /**
   * Apply a change to the document
   *
   * JavaScript usage:
   * ```js
   * chronicle.change("draw-card", newStateJson);
   * ```
   */
  change(_message: string, new_state_json: string): void;
  /**
   * Get the current document state as JSON
   *
   * Reads native Automerge fields and reconstructs HyperTokenState.
   */
  getState(): string;
  /**
   * Set the entire state (used for initialization)
   *
   * Takes a JSON string of HyperTokenState and stores each field
   * natively in the CRDT for proper conflict resolution.
   */
  setState(state_json: string): void;
  /**
   * Simple full-document sync (for backwards compatibility)
   *
   * Merges the given binary document into this one.
   */
  syncFull(other_doc_bytes: Uint8Array): void;
}

export class GameStateManager {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Advance to next phase or set specific phase
   */
  nextPhase(phase?: string | null): string;
  /**
   * Set arbitrary game state property
   */
  setProperty(key: string, value_json: string): string;
  /**
   * End the game
   */
  end(winner?: string | null, reason?: string | null): string;
  /**
   * Create a new GameState manager
   */
  constructor();
  /**
   * Pause the game
   */
  pause(): string;
  /**
   * Start the game
   */
  start(): string;
  /**
   * Resume the game from pause
   */
  resume(): string;
  /**
   * Get current game state as JSON
   */
  getState(): string;
}

export class Position {
  free(): void;
  [Symbol.dispose](): void;
  constructor(x: number, y: number);
  x: number;
  y: number;
}

export class Source {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Get burned tokens as JSON
   */
  getBurned(): string;
  /**
   * Get tokens as JSON
   */
  getTokens(): string;
  /**
   * Get the number of burned tokens
   */
  burnedCount(): number;
  /**
   * Remove a stack by ID
   */
  removeStack(stack_id: string): void;
  /**
   * Get stack IDs as JSON
   */
  getStackIds(): string;
  /**
   * Restore burned cards to the main tokens list (soft reset)
   */
  restoreBurned(): void;
  /**
   * Get reshuffle policy as JSON
   */
  getReshufflePolicy(): string;
  /**
   * Set reshuffle policy
   */
  setReshufflePolicy(threshold: number, mode: string): void;
  /**
   * Initialize source with tokens from JSON array
   */
  initializeWithTokens(tokens_json: string, stack_ids_json: string): void;
  /**
   * Create a new Source
   */
  constructor();
  /**
   * Burn (remove) N tokens from the top of the source
   */
  burn(count: number): string;
  /**
   * Draw N tokens from the source
   *
   * Returns JSON array of drawn tokens
   * If reshuffle policy is set and threshold is reached, auto-reshuffles
   */
  draw(count: number): string;
  /**
   * Get the number of tokens in the source
   */
  size(): number;
  /**
   * Reset source with new tokens
   */
  reset(tokens_json: string): void;
  /**
   * Inspect source state (summary for debugging/UI)
   */
  inspect(): string;
  /**
   * Shuffle the source
   *
   * If seed is provided, uses deterministic shuffle
   */
  shuffle(seed?: string | null): void;
  /**
   * Get current seed
   */
  getSeed(): number | undefined;
  /**
   * Add tokens from a stack
   */
  addStack(tokens_json: string, stack_id: string): void;
  /**
   * Get current state as JSON
   */
  getState(): string;
  /**
   * Set state from JSON
   */
  setState(state_json: string): void;
}

export class Space {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Clear all tokens from a zone
   */
  clearZone(zone_name: string): void;
  /**
   * Get all tokens in a zone as JSON array
   */
  getTokens(zone_name: string): string;
  /**
   * Move a placement between zones by placement ID
   */
  move(placement_id: string, from_zone: string, to_zone: string, x?: number | null, y?: number | null): void;
  /**
   * Create a zone
   */
  createZone(name: string): void;
  /**
   * Delete a zone
   */
  deleteZone(name: string): void;
  /**
   * Shuffle tokens in a zone (randomize z-index)
   */
  shuffleZone(zone_name: string, seed?: string | null): void;
  /**
   * Arrange tokens in a stack (pile) layout
   */
  stackLayout(zone_name: string, x: number, y: number, offset_x: number, offset_y: number): void;
  /**
   * Transfer all tokens from one zone to another
   */
  transferZone(from_zone: string, to_zone: string): number;
  /**
   * Get all placements in a zone as JSON
   */
  getPlacements(zone_name: string): string;
  /**
   * Get list of all zone names
   */
  getZoneNames(): string[];
  /**
   * Check if a zone is locked
   */
  isZoneLocked(name: string): boolean;
  /**
   * Arrange tokens in a fan (arc) layout
   */
  fan(zone_name: string, x: number, y: number, radius: number, angle_start: number, angle_step: number): void;
  /**
   * Create a new Space
   */
  constructor();
  /**
   * Flip a placement in a zone by placement ID
   */
  flip(zone_name: string, placement_id: string, face_up?: boolean | null): void;
  /**
   * Clear all tokens from ALL zones (Global clear)
   */
  clear(): void;
  /**
   * Get the count of tokens in a zone
   */
  count(zone_name: string): number;
  /**
   * Place a token in a zone
   * Returns the placement as JSON
   */
  place(zone_name: string, token_json: string, x?: number | null, y?: number | null): string;
  /**
   * Remove a placement from a zone by placement ID
   */
  remove(zone_name: string, placement_id: string): string;
  /**
   * Arrange tokens in a linear spread
   */
  spread(zone_name: string, x: number, y: number, spacing: number, horizontal: boolean): void;
  /**
   * Check if a zone exists
   */
  hasZone(name: string): boolean;
  /**
   * Get the full state as JSON
   */
  getState(): string;
  /**
   * Lock or unlock a zone
   */
  lockZone(name: string, locked: boolean): void;
  /**
   * Set the state from JSON
   */
  setState(state_json: string): void;
}

export class Stack {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Get the number of drawn tokens
   */
  drawnCount(): number;
  /**
   * Get the number of discarded tokens
   */
  discardCount(): number;
  /**
   * Reverse a range of tokens
   */
  reverseRange(start: number, end: number): void;
  /**
   * Add a specific token to the discard pile (used by agents discarding)
   */
  addToDiscard(token_json: string): void;
  /**
   * Static helper: Shuffle an array of tokens without creating a Stack instance
   *
   * Avoids the overhead of Stack instantiation for standalone shuffle operations.
   * This is much faster for Source.ts which just needs to shuffle tokens without
   * the full Stack state management.
   */
  static shuffleTokens(tokens_json: string, seed: string): string;
  /**
   * Initialize stack with tokens from JSON array
   */
  initializeWithTokens(tokens_json: string): void;
  /**
   * Cut the deck at a specific index
   */
  cut(index: number): void;
  /**
   * Create a new Stack
   */
  constructor();
  /**
   * Burn (remove) N tokens from the top of the stack
   */
  burn(count: number): string;
  /**
   * Draw N tokens from the stack
   *
   * Returns JSON array of drawn tokens
   */
  draw(count: number): string;
  /**
   * Peek at N tokens from the top of the stack (without removing them)
   *
   * Returns JSON array of tokens
   */
  peek(count: number): string;
  /**
   * Get the number of tokens in the stack
   */
  size(): number;
  /**
   * Swap two tokens by index
   */
  swap(index_a: number, index_b: number): void;
  /**
   * Reset the stack (move all drawn/discarded back to stack)
   */
  reset(): void;
  /**
   * Discard drawn tokens to discard pile
   */
  discard(count: number): void;
  /**
   * Reverse the order of the stack
   */
  reverse(): void;
  /**
   * Shuffle the stack
   *
   * If seed is provided, uses deterministic shuffle
   */
  shuffle(seed?: string | null): void;
  /**
   * Get the full state as JSON
   */
  getState(): string;
  /**
   * Insert a token at a specific index
   */
  insertAt(index: number, token_json: string): void;
  /**
   * Remove a token at a specific index
   */
  removeAt(index: number): string;
  /**
   * Set the state from JSON
   */
  setState(state_json: string): void;
}

export class Token {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Remove a tag from the token
   */
  removeTag(tag: string): boolean;
  /**
   * Check if token is reversed
   */
  isReversed(): boolean;
  /**
   * Create a new Token with minimal properties
   */
  constructor(id: string, index: number);
  /**
   * Flip the token (toggle reversed state)
   */
  flip(): void;
  /**
   * Get the token ID
   */
  getId(): string;
  /**
   * Add a tag to the token
   */
  addTag(tag: string): void;
  /**
   * Check if token has a specific tag
   */
  hasTag(tag: string): boolean;
  /**
   * Convert Token to JSON string
   */
  toJSON(): string;
  /**
   * Create a Token from a JSON string
   */
  static fromJSON(json: string): Token;
  /**
   * Get the token index
   */
  getIndex(): number;
}

export class TokenOps {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a new TokenOps instance
   */
  constructor();
  /**
   * Merge multiple tokens into one
   *
   * Combines properties from multiple tokens. The first token is used as
   * the base, with properties from subsequent tokens merged in.
   */
  merge(tokens_json: string, result_properties_json: string | null | undefined, keep_originals: boolean): string;
  /**
   * Split a token into multiple tokens
   *
   * Creates multiple copies of a token with optional custom properties.
   */
  split(token_json: string, count: number, properties_array_json?: string | null): string;
  /**
   * Attach a token to another token
   *
   * Creates an attachment relationship. The attachment token gains
   * _attachedTo and _attachmentType properties.
   */
  attach(host_json: string, attachment_json: string, attachment_type: string): string;
  /**
   * Detach a token from its host
   *
   * Removes the attachment relationship and returns the detached token.
   */
  detach(host_json: string, attachment_id: string): string;
  /**
   * Transform a token by applying properties
   *
   * This modifies the token's properties in-place. Properties are merged
   * with existing token data.
   */
  transform(token_json: string, properties_json: string): string;
}

export function health_check(): boolean;

export function init(): void;

export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_actiondispatcher_free: (a: number, b: number) => void;
  readonly __wbg_agentmanager_free: (a: number, b: number) => void;
  readonly __wbg_batchops_free: (a: number, b: number) => void;
  readonly __wbg_chronicle_free: (a: number, b: number) => void;
  readonly __wbg_gamestatemanager_free: (a: number, b: number) => void;
  readonly __wbg_get_position_x: (a: number) => number;
  readonly __wbg_get_position_y: (a: number) => number;
  readonly __wbg_position_free: (a: number, b: number) => void;
  readonly __wbg_set_position_x: (a: number, b: number) => void;
  readonly __wbg_set_position_y: (a: number, b: number) => void;
  readonly __wbg_source_free: (a: number, b: number) => void;
  readonly __wbg_space_free: (a: number, b: number) => void;
  readonly __wbg_stack_free: (a: number, b: number) => void;
  readonly __wbg_token_free: (a: number, b: number) => void;
  readonly actiondispatcher_agentAddToken: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly actiondispatcher_agentCreate: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
  readonly actiondispatcher_agentDiscardCards: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly actiondispatcher_agentDrawCards: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly actiondispatcher_agentGet: (a: number, b: number, c: number, d: number) => void;
  readonly actiondispatcher_agentGetAll: (a: number, b: number) => void;
  readonly actiondispatcher_agentGiveResource: (a: number, b: number, c: number, d: number, e: number, f: number, g: bigint) => void;
  readonly actiondispatcher_agentRemove: (a: number, b: number, c: number, d: number) => void;
  readonly actiondispatcher_agentRemoveToken: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly actiondispatcher_agentSetActive: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly actiondispatcher_agentStealResource: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: bigint) => void;
  readonly actiondispatcher_agentStealToken: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
  readonly actiondispatcher_agentTakeResource: (a: number, b: number, c: number, d: number, e: number, f: number, g: bigint) => void;
  readonly actiondispatcher_agentTrade: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
  readonly actiondispatcher_agentTransferResource: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: bigint) => void;
  readonly actiondispatcher_batchCollect: (a: number, b: number, c: number, d: number) => void;
  readonly actiondispatcher_batchCount: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly actiondispatcher_batchDraw: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly actiondispatcher_batchFilter: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly actiondispatcher_batchFind: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly actiondispatcher_batchForEach: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly actiondispatcher_batchShuffle: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly actiondispatcher_gameEnd: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly actiondispatcher_gameGetState: (a: number, b: number) => void;
  readonly actiondispatcher_gameNextPhase: (a: number, b: number, c: number, d: number) => void;
  readonly actiondispatcher_gamePause: (a: number, b: number) => void;
  readonly actiondispatcher_gameResume: (a: number, b: number) => void;
  readonly actiondispatcher_gameSetProperty: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly actiondispatcher_gameStart: (a: number, b: number) => void;
  readonly actiondispatcher_getSource: (a: number) => number;
  readonly actiondispatcher_getSpace: (a: number) => number;
  readonly actiondispatcher_getStack: (a: number) => number;
  readonly actiondispatcher_new: () => number;
  readonly actiondispatcher_setSource: (a: number, b: number) => void;
  readonly actiondispatcher_setSpace: (a: number, b: number) => void;
  readonly actiondispatcher_setStack: (a: number, b: number) => void;
  readonly actiondispatcher_sourceAddStack: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly actiondispatcher_sourceBurn: (a: number, b: number, c: number) => void;
  readonly actiondispatcher_sourceDraw: (a: number, b: number, c: number) => void;
  readonly actiondispatcher_sourceInspect: (a: number, b: number) => void;
  readonly actiondispatcher_sourceRemoveStack: (a: number, b: number, c: number, d: number) => void;
  readonly actiondispatcher_sourceReset: (a: number, b: number, c: number, d: number) => void;
  readonly actiondispatcher_sourceShuffle: (a: number, b: number, c: number, d: number) => void;
  readonly actiondispatcher_spaceClear: (a: number, b: number) => void;
  readonly actiondispatcher_spaceClearZone: (a: number, b: number, c: number, d: number) => void;
  readonly actiondispatcher_spaceCreateZone: (a: number, b: number, c: number, d: number) => void;
  readonly actiondispatcher_spaceDeleteZone: (a: number, b: number, c: number, d: number) => void;
  readonly actiondispatcher_spaceFan: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
  readonly actiondispatcher_spaceFlip: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly actiondispatcher_spaceLockZone: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly actiondispatcher_spaceMove: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
  readonly actiondispatcher_spacePlace: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
  readonly actiondispatcher_spaceRemove: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly actiondispatcher_spaceShuffleZone: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly actiondispatcher_spaceSpread: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
  readonly actiondispatcher_spaceStack: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
  readonly actiondispatcher_spaceTransferZone: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly actiondispatcher_stackBurn: (a: number, b: number, c: number) => void;
  readonly actiondispatcher_stackCut: (a: number, b: number, c: number) => void;
  readonly actiondispatcher_stackDraw: (a: number, b: number, c: number) => void;
  readonly actiondispatcher_stackInsertAt: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly actiondispatcher_stackPeek: (a: number, b: number, c: number) => void;
  readonly actiondispatcher_stackRemoveAt: (a: number, b: number, c: number) => void;
  readonly actiondispatcher_stackReset: (a: number, b: number) => void;
  readonly actiondispatcher_stackReverse: (a: number, b: number) => void;
  readonly actiondispatcher_stackShuffle: (a: number, b: number, c: number, d: number) => void;
  readonly actiondispatcher_stackSwap: (a: number, b: number, c: number, d: number) => void;
  readonly actiondispatcher_tokenAttach: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
  readonly actiondispatcher_tokenDetach: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly actiondispatcher_tokenMerge: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
  readonly actiondispatcher_tokenSplit: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
  readonly actiondispatcher_tokenTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly agentmanager_addToken: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly agentmanager_createAgent: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
  readonly agentmanager_getAgent: (a: number, b: number, c: number, d: number) => void;
  readonly agentmanager_getAllAgents: (a: number, b: number) => void;
  readonly agentmanager_giveResource: (a: number, b: number, c: number, d: number, e: number, f: number, g: bigint) => void;
  readonly agentmanager_new: () => number;
  readonly agentmanager_removeAgent: (a: number, b: number, c: number, d: number) => void;
  readonly agentmanager_removeToken: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly agentmanager_setAgentActive: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly agentmanager_stealResource: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: bigint) => void;
  readonly agentmanager_stealToken: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
  readonly agentmanager_takeResource: (a: number, b: number, c: number, d: number, e: number, f: number, g: bigint) => void;
  readonly agentmanager_trade: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
  readonly agentmanager_transferResource: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: bigint) => void;
  readonly batchops_batchDraw: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly batchops_batchShuffle: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly batchops_new: () => number;
  readonly batchops_parallelCount: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly batchops_parallelFilter: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly batchops_parallelFind: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly batchops_parallelMap: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly chronicle_change: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly chronicle_changeCount: (a: number) => number;
  readonly chronicle_generateSyncMessage: (a: number, b: number, c: number, d: number) => void;
  readonly chronicle_getState: (a: number, b: number) => void;
  readonly chronicle_load: (a: number, b: number, c: number, d: number) => void;
  readonly chronicle_loadFromBase64: (a: number, b: number, c: number, d: number) => void;
  readonly chronicle_merge: (a: number, b: number, c: number, d: number) => void;
  readonly chronicle_new: () => number;
  readonly chronicle_receiveSyncMessage: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly chronicle_save: (a: number, b: number) => void;
  readonly chronicle_saveToBase64: (a: number, b: number) => void;
  readonly chronicle_setState: (a: number, b: number, c: number, d: number) => void;
  readonly gamestatemanager_end: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly gamestatemanager_getState: (a: number, b: number) => void;
  readonly gamestatemanager_new: () => number;
  readonly gamestatemanager_nextPhase: (a: number, b: number, c: number, d: number) => void;
  readonly gamestatemanager_pause: (a: number, b: number) => void;
  readonly gamestatemanager_resume: (a: number, b: number) => void;
  readonly gamestatemanager_setProperty: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly gamestatemanager_start: (a: number, b: number) => void;
  readonly health_check: () => number;
  readonly init: () => void;
  readonly position_new: (a: number, b: number) => number;
  readonly source_addStack: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly source_burn: (a: number, b: number, c: number) => void;
  readonly source_burnedCount: (a: number) => number;
  readonly source_draw: (a: number, b: number, c: number) => void;
  readonly source_getBurned: (a: number, b: number) => void;
  readonly source_getReshufflePolicy: (a: number, b: number) => void;
  readonly source_getSeed: (a: number) => number;
  readonly source_getStackIds: (a: number, b: number) => void;
  readonly source_getState: (a: number, b: number) => void;
  readonly source_getTokens: (a: number, b: number) => void;
  readonly source_initializeWithTokens: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly source_inspect: (a: number, b: number) => void;
  readonly source_new: () => number;
  readonly source_removeStack: (a: number, b: number, c: number, d: number) => void;
  readonly source_reset: (a: number, b: number, c: number, d: number) => void;
  readonly source_restoreBurned: (a: number, b: number) => void;
  readonly source_setReshufflePolicy: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly source_setState: (a: number, b: number, c: number, d: number) => void;
  readonly source_shuffle: (a: number, b: number, c: number, d: number) => void;
  readonly source_size: (a: number) => number;
  readonly space_clear: (a: number, b: number) => void;
  readonly space_clearZone: (a: number, b: number, c: number, d: number) => void;
  readonly space_count: (a: number, b: number, c: number, d: number) => void;
  readonly space_createZone: (a: number, b: number, c: number, d: number) => void;
  readonly space_deleteZone: (a: number, b: number, c: number, d: number) => void;
  readonly space_fan: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
  readonly space_flip: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
  readonly space_getPlacements: (a: number, b: number, c: number, d: number) => void;
  readonly space_getState: (a: number, b: number) => void;
  readonly space_getTokens: (a: number, b: number, c: number, d: number) => void;
  readonly space_getZoneNames: (a: number, b: number) => void;
  readonly space_hasZone: (a: number, b: number, c: number) => number;
  readonly space_isZoneLocked: (a: number, b: number, c: number) => number;
  readonly space_lockZone: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly space_move: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
  readonly space_place: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
  readonly space_remove: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly space_setState: (a: number, b: number, c: number, d: number) => void;
  readonly space_shuffleZone: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly space_spread: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
  readonly space_stackLayout: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
  readonly space_transferZone: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly stack_addToDiscard: (a: number, b: number, c: number, d: number) => void;
  readonly stack_burn: (a: number, b: number, c: number) => void;
  readonly stack_cut: (a: number, b: number, c: number) => void;
  readonly stack_discard: (a: number, b: number, c: number) => void;
  readonly stack_discardCount: (a: number) => number;
  readonly stack_draw: (a: number, b: number, c: number) => void;
  readonly stack_drawnCount: (a: number) => number;
  readonly stack_getState: (a: number, b: number) => void;
  readonly stack_initializeWithTokens: (a: number, b: number, c: number, d: number) => void;
  readonly stack_insertAt: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly stack_new: () => number;
  readonly stack_peek: (a: number, b: number, c: number) => void;
  readonly stack_removeAt: (a: number, b: number, c: number) => void;
  readonly stack_reset: (a: number) => void;
  readonly stack_reverse: (a: number, b: number) => void;
  readonly stack_reverseRange: (a: number, b: number, c: number, d: number) => void;
  readonly stack_setState: (a: number, b: number, c: number, d: number) => void;
  readonly stack_shuffle: (a: number, b: number, c: number, d: number) => void;
  readonly stack_shuffleTokens: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly stack_size: (a: number) => number;
  readonly stack_swap: (a: number, b: number, c: number, d: number) => void;
  readonly token_addTag: (a: number, b: number, c: number) => void;
  readonly token_flip: (a: number) => void;
  readonly token_fromJSON: (a: number, b: number, c: number) => void;
  readonly token_getId: (a: number, b: number) => void;
  readonly token_getIndex: (a: number) => number;
  readonly token_hasTag: (a: number, b: number, c: number) => number;
  readonly token_isReversed: (a: number) => number;
  readonly token_new: (a: number, b: number, c: number) => number;
  readonly token_removeTag: (a: number, b: number, c: number) => number;
  readonly token_toJSON: (a: number, b: number) => void;
  readonly tokenops_attach: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
  readonly tokenops_detach: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly tokenops_merge: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
  readonly tokenops_split: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
  readonly tokenops_transform: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly version: (a: number) => void;
  readonly chronicle_syncFull: (a: number, b: number, c: number, d: number) => void;
  readonly agentmanager_transferToken: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
  readonly space_new: () => number;
  readonly tokenops_new: () => number;
  readonly actiondispatcher_batchMap: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly actiondispatcher_agentTransferToken: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
  readonly __wbg_tokenops_free: (a: number, b: number) => void;
  readonly __wbindgen_export: (a: number) => void;
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
  readonly __wbindgen_export2: (a: number, b: number, c: number) => void;
  readonly __wbindgen_export3: (a: number, b: number) => number;
  readonly __wbindgen_export4: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
