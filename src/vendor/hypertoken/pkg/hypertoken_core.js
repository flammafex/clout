let wasm;

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function dropObject(idx) {
    if (idx < 132) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(takeObject(mem.getUint32(i, true)));
    }
    return result;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getObject(idx) { return heap[idx]; }

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        wasm.__wbindgen_export(addHeapObject(e));
    }
}

let heap = new Array(128).fill(undefined);
heap.push(undefined, null, true, false);

let heap_next = heap.length;

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    }
}

let WASM_VECTOR_LEN = 0;

const ActionDispatcherFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_actiondispatcher_free(ptr >>> 0, 1));

const AgentManagerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_agentmanager_free(ptr >>> 0, 1));

const BatchOpsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_batchops_free(ptr >>> 0, 1));

const ChronicleFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_chronicle_free(ptr >>> 0, 1));

const GameStateManagerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_gamestatemanager_free(ptr >>> 0, 1));

const PositionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_position_free(ptr >>> 0, 1));

const SourceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_source_free(ptr >>> 0, 1));

const SpaceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_space_free(ptr >>> 0, 1));

const StackFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_stack_free(ptr >>> 0, 1));

const TokenFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_token_free(ptr >>> 0, 1));

const TokenOpsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_tokenops_free(ptr >>> 0, 1));

/**
 * Unified action dispatcher for HyperToken operations
 *
 * This provides a single entry point for all game actions,
 * using zero-overhead typed methods for optimal performance.
 */
export class ActionDispatcher {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ActionDispatcherFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_actiondispatcher_free(ptr, 0);
    }
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
     * @param {string} decks_json
     * @param {string} counts_json
     * @returns {string}
     */
    batchDraw(decks_json, counts_json) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(decks_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(counts_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_batchDraw(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Find a token in a list matching a predicate
     * @param {string} tokens_json
     * @param {string} predicate
     * @returns {string}
     */
    batchFind(tokens_json, predicate) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(tokens_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(predicate, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_batchFind(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Pause the game (typed, zero overhead)
     * @returns {string}
     */
    gamePause() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.actiondispatcher_gamePause(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Start the game (typed, zero overhead)
     * @returns {string}
     */
    gameStart() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.actiondispatcher_gameStart(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Get the source instance
     * @returns {Source | undefined}
     */
    getSource() {
        const ret = wasm.actiondispatcher_getSource(this.__wbg_ptr);
        return ret === 0 ? undefined : Source.__wrap(ret);
    }
    /**
     * Set the source instance
     * @param {Source} source
     */
    setSource(source) {
        _assertClass(source, Source);
        var ptr0 = source.__destroy_into_raw();
        wasm.actiondispatcher_setSource(this.__wbg_ptr, ptr0);
    }
    /**
     * Flip token in zone (typed, zero overhead)
     * @param {string} zone
     * @param {string} token_id
     */
    spaceFlip(zone, token_id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(token_id, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_spaceFlip(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Move token between zones (typed, zero overhead)
     * @param {string} token_id
     * @param {string} from_zone
     * @param {string} to_zone
     * @param {number | null} [x]
     * @param {number | null} [y]
     */
    spaceMove(token_id, from_zone, to_zone, x, y) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(token_id, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(from_zone, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(to_zone, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len2 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_spaceMove(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, !isLikeNone(x), isLikeNone(x) ? 0 : x, !isLikeNone(y), isLikeNone(y) ? 0 : y);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Burn cards from stack (typed, zero overhead)
     * @param {number} count
     * @returns {string}
     */
    stackBurn(count) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.actiondispatcher_stackBurn(retptr, this.__wbg_ptr, count);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Draw cards from stack (typed, zero overhead)
     * @param {number} count
     * @returns {string}
     */
    stackDraw(count) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.actiondispatcher_stackDraw(retptr, this.__wbg_ptr, count);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Peek at top cards of stack (typed, zero overhead)
     * @param {number} count
     * @returns {string}
     */
    stackPeek(count) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.actiondispatcher_stackPeek(retptr, this.__wbg_ptr, count);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Swap two tokens (typed, zero overhead)
     * @param {number} index_a
     * @param {number} index_b
     */
    stackSwap(index_a, index_b) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.actiondispatcher_stackSwap(retptr, this.__wbg_ptr, index_a, index_b);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Agent Trade (Wrapper)
     * @param {string} agent1
     * @param {string} offer1
     * @param {string} agent2
     * @param {string} offer2
     * @returns {string}
     */
    agentTrade(agent1, offer1, agent2, offer2) {
        let deferred6_0;
        let deferred6_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(agent1, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(offer1, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(agent2, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passStringToWasm0(offer2, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len3 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_agentTrade(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr5 = r0;
            var len5 = r1;
            if (r3) {
                ptr5 = 0; len5 = 0;
                throw takeObject(r2);
            }
            deferred6_0 = ptr5;
            deferred6_1 = len5;
            return getStringFromWasm0(ptr5, len5);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred6_0, deferred6_1, 1);
        }
    }
    /**
     * Count tokens in a list matching a predicate
     * @param {string} tokens_json
     * @param {string} predicate
     * @returns {number}
     */
    batchCount(tokens_json, predicate) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(tokens_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(predicate, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_batchCount(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Resume the game from pause (typed, zero overhead)
     * @returns {string}
     */
    gameResume() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.actiondispatcher_gameResume(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Burn from source (typed, zero overhead)
     * @param {number} count
     * @returns {string}
     */
    sourceBurn(count) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.actiondispatcher_sourceBurn(retptr, this.__wbg_ptr, count);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Draw from source (typed, zero overhead)
     * @param {number} count
     * @returns {string}
     */
    sourceDraw(count) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.actiondispatcher_sourceDraw(retptr, this.__wbg_ptr, count);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    spaceClear() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.actiondispatcher_spaceClear(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Place token in zone (typed, zero overhead)
     * @param {string} zone
     * @param {string} token_json
     * @param {number | null} [x]
     * @param {number | null} [y]
     * @returns {string}
     */
    spacePlace(zone, token_json, x, y) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(token_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_spacePlace(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, !isLikeNone(x), isLikeNone(x) ? 0 : x, !isLikeNone(y), isLikeNone(y) ? 0 : y);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * @param {string} zone
     * @param {number} x
     * @param {number} y
     * @param {number} off_x
     * @param {number} off_y
     */
    spaceStack(zone, x, y, off_x, off_y) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_spaceStack(retptr, this.__wbg_ptr, ptr0, len0, x, y, off_x, off_y);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Reset stack to initial state (typed, zero overhead)
     */
    stackReset() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.actiondispatcher_stackReset(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Merge multiple tokens into one (typed, zero overhead)
     * @param {string} tokens_json
     * @param {string | null | undefined} result_properties_json
     * @param {boolean} keep_originals
     * @returns {string}
     */
    tokenMerge(tokens_json, result_properties_json, keep_originals) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(tokens_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(result_properties_json) ? 0 : passStringToWasm0(result_properties_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            var len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_tokenMerge(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, keep_originals);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Split a token into multiple tokens (typed, zero overhead)
     * @param {string} token_json
     * @param {number} count
     * @param {string | null} [properties_array_json]
     * @returns {string}
     */
    tokenSplit(token_json, count, properties_array_json) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(token_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(properties_array_json) ? 0 : passStringToWasm0(properties_array_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            var len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_tokenSplit(retptr, this.__wbg_ptr, ptr0, len0, count, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Create an agent (typed, zero overhead)
     * @param {string} id
     * @param {string} name
     * @param {string | null} [meta_json]
     * @returns {string}
     */
    agentCreate(id, name, meta_json) {
        let deferred5_0;
        let deferred5_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            var ptr2 = isLikeNone(meta_json) ? 0 : passStringToWasm0(meta_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            var len2 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_agentCreate(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr4 = r0;
            var len4 = r1;
            if (r3) {
                ptr4 = 0; len4 = 0;
                throw takeObject(r2);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * Remove an agent (typed, zero overhead)
     * @param {string} name
     */
    agentRemove(name) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_agentRemove(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
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
     * @param {string} tokens_json
     * @param {string} predicate
     * @returns {string}
     */
    batchFilter(tokens_json, predicate) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(tokens_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(predicate, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_batchFilter(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Reset the source
     * @param {string | null} [tokens_json]
     */
    sourceReset(tokens_json) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(tokens_json) ? 0 : passStringToWasm0(tokens_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            var len0 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_sourceReset(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Remove token from zone (typed, zero overhead)
     * @param {string} zone
     * @param {string} token_id
     * @returns {string}
     */
    spaceRemove(zone, token_id) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(token_id, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_spaceRemove(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * @param {string} zone
     * @param {number} x
     * @param {number} y
     * @param {number} spacing
     * @param {boolean} horizontal
     */
    spaceSpread(zone, x, y, spacing, horizontal) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_spaceSpread(retptr, this.__wbg_ptr, ptr0, len0, x, y, spacing, horizontal);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Attach a token to another token (typed, zero overhead)
     * @param {string} host_json
     * @param {string} attachment_json
     * @param {string} attachment_type
     * @returns {string}
     */
    tokenAttach(host_json, attachment_json, attachment_type) {
        let deferred5_0;
        let deferred5_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(host_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(attachment_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(attachment_type, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len2 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_tokenAttach(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr4 = r0;
            var len4 = r1;
            if (r3) {
                ptr4 = 0; len4 = 0;
                throw takeObject(r2);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * Detach a token from its host (typed, zero overhead)
     * @param {string} host_json
     * @param {string} attachment_id
     * @returns {string}
     */
    tokenDetach(host_json, attachment_id) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(host_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(attachment_id, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_tokenDetach(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Get all agents (typed, zero overhead)
     * @returns {string}
     */
    agentGetAll() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.actiondispatcher_agentGetAll(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Collect tokens from multiple sources
     *
     * Sources: "stack", "discard", "source", or any zone name (e.g., "hand")
     * @param {string} sources_json
     * @returns {string}
     */
    batchCollect(sources_json) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(sources_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_batchCollect(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeObject(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred3_0, deferred3_1, 1);
        }
    }
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
     * @param {string} decks_json
     * @param {string | null} [seed_prefix]
     * @returns {string}
     */
    batchShuffle(decks_json, seed_prefix) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(decks_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(seed_prefix) ? 0 : passStringToWasm0(seed_prefix, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            var len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_batchShuffle(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Reverse the stack
     */
    stackReverse() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.actiondispatcher_stackReverse(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Shuffle stack with optional seed (typed, zero overhead)
     * @param {string | null} [seed]
     */
    stackShuffle(seed) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(seed) ? 0 : passStringToWasm0(seed, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            var len0 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_stackShuffle(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Apply an operation to all tokens (forEach equivalent)
     * Maps to parallel_map for high-performance state updates
     * @param {string} tokens_json
     * @param {string} operation
     * @returns {string}
     */
    batchForEach(tokens_json, operation) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(tokens_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(operation, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_batchForEach(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Get current game state (typed, zero overhead)
     * @returns {string}
     */
    gameGetState() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.actiondispatcher_gameGetState(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Inspect source
     * @returns {string}
     */
    sourceInspect() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.actiondispatcher_sourceInspect(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Shuffle source (typed, zero overhead)
     * @param {string | null} [seed]
     */
    sourceShuffle(seed) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(seed) ? 0 : passStringToWasm0(seed, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            var len0 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_sourceShuffle(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Add token to agent's inventory (typed, zero overhead)
     * @param {string} name
     * @param {string} token_json
     */
    agentAddToken(name, token_json) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(token_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_agentAddToken(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Advance to next phase or set specific phase (typed, zero overhead)
     * @param {string | null} [phase]
     * @returns {string}
     */
    gameNextPhase(phase) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(phase) ? 0 : passStringToWasm0(phase, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            var len0 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_gameNextPhase(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeObject(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Lock or unlock zone (typed, zero overhead)
     * @param {string} name
     * @param {boolean} locked
     */
    spaceLockZone(name, locked) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_spaceLockZone(retptr, this.__wbg_ptr, ptr0, len0, locked);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Insert token at index (typed, zero overhead)
     * @param {number} index
     * @param {string} token_json
     */
    stackInsertAt(index, token_json) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(token_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_stackInsertAt(retptr, this.__wbg_ptr, index, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Remove token at index (typed, zero overhead)
     * @param {number} index
     * @returns {string}
     */
    stackRemoveAt(index) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.actiondispatcher_stackRemoveAt(retptr, this.__wbg_ptr, index);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Transform a token by applying properties (typed, zero overhead)
     * @param {string} token_json
     * @param {string} properties_json
     * @returns {string}
     */
    tokenTransform(token_json, properties_json) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(token_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(properties_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_tokenTransform(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Agent draws cards from the Stack
     * @param {string} agent_name
     * @param {number} count
     * @returns {string}
     */
    agentDrawCards(agent_name, count) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(agent_name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_agentDrawCards(retptr, this.__wbg_ptr, ptr0, len0, count);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeObject(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Set agent active state (typed, zero overhead)
     * @param {string} name
     * @param {boolean} active
     */
    agentSetActive(name, active) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_agentSetActive(retptr, this.__wbg_ptr, ptr0, len0, active);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Add a stack to the source
     * Expects JSON with { "stack": { "stack": [Tokens...] }, "id": "optional-id" }
     * @param {string} stack_json
     * @param {string | null} [stack_id]
     */
    sourceAddStack(stack_json, stack_id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(stack_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(stack_id) ? 0 : passStringToWasm0(stack_id, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            var len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_sourceAddStack(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Clear all tokens from zone (typed, zero overhead)
     * @param {string} name
     */
    spaceClearZone(name) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_spaceClearZone(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Steal token from another agent (typed, zero overhead)
     * @param {string} from
     * @param {string} to
     * @param {string} token_id
     * @returns {string}
     */
    agentStealToken(from, to, token_id) {
        let deferred5_0;
        let deferred5_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(from, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(to, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(token_id, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len2 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_agentStealToken(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr4 = r0;
            var len4 = r1;
            if (r3) {
                ptr4 = 0; len4 = 0;
                throw takeObject(r2);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * Set arbitrary game state property (typed, zero overhead)
     * @param {string} key
     * @param {string} value_json
     * @returns {string}
     */
    gameSetProperty(key, value_json) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(key, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(value_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_gameSetProperty(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Create new zone (typed, zero overhead)
     * @param {string} name
     */
    spaceCreateZone(name) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_spaceCreateZone(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Delete zone (typed, zero overhead)
     * @param {string} name
     */
    spaceDeleteZone(name) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_spaceDeleteZone(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Remove token from agent's inventory (typed, zero overhead)
     * @param {string} name
     * @param {string} token_id
     * @returns {string}
     */
    agentRemoveToken(name, token_id) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(token_id, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_agentRemoveToken(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Shuffle tokens in zone (typed, zero overhead)
     * @param {string} name
     * @param {string | null} [seed]
     */
    spaceShuffleZone(name, seed) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(seed) ? 0 : passStringToWasm0(seed, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            var len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_spaceShuffleZone(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Agent discards cards to the Stack's discard pile
     * @param {string} agent_name
     * @param {string} token_ids_json
     * @returns {string}
     */
    agentDiscardCards(agent_name, token_ids_json) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(agent_name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(token_ids_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_agentDiscardCards(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Give resource to agent (typed, zero overhead)
     * @param {string} name
     * @param {string} resource
     * @param {bigint} amount
     */
    agentGiveResource(name, resource, amount) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(resource, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_agentGiveResource(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, amount);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Take resource from agent (typed, zero overhead)
     * @param {string} name
     * @param {string} resource
     * @param {bigint} amount
     */
    agentTakeResource(name, resource, amount) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(resource, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_agentTakeResource(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, amount);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Remove a stack from the source
     * @param {string} stack_id
     */
    sourceRemoveStack(stack_id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(stack_id, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_sourceRemoveStack(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {string} from_zone
     * @param {string} to_zone
     * @returns {number}
     */
    spaceTransferZone(from_zone, to_zone) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(from_zone, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(to_zone, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_spaceTransferZone(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Steal resource from another agent (typed, zero overhead)
     * @param {string} from
     * @param {string} to
     * @param {string} resource
     * @param {bigint} amount
     * @returns {string}
     */
    agentStealResource(from, to, resource, amount) {
        let deferred5_0;
        let deferred5_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(from, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(to, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(resource, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len2 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_agentStealResource(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, amount);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr4 = r0;
            var len4 = r1;
            if (r3) {
                ptr4 = 0; len4 = 0;
                throw takeObject(r2);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * Transfer token between agents (typed, zero overhead)
     * @param {string} from
     * @param {string} to
     * @param {string} token_id
     * @returns {string}
     */
    agentTransferToken(from, to, token_id) {
        let deferred5_0;
        let deferred5_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(from, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(to, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(token_id, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len2 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_agentStealToken(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr4 = r0;
            var len4 = r1;
            if (r3) {
                ptr4 = 0; len4 = 0;
                throw takeObject(r2);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * Transfer resource between agents (typed, zero overhead)
     * @param {string} from
     * @param {string} to
     * @param {string} resource
     * @param {bigint} amount
     * @returns {string}
     */
    agentTransferResource(from, to, resource, amount) {
        let deferred5_0;
        let deferred5_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(from, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(to, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(resource, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len2 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_agentTransferResource(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, amount);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr4 = r0;
            var len4 = r1;
            if (r3) {
                ptr4 = 0; len4 = 0;
                throw takeObject(r2);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * Create a new ActionDispatcher
     */
    constructor() {
        const ret = wasm.actiondispatcher_new();
        this.__wbg_ptr = ret >>> 0;
        ActionDispatcherFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * End the game (typed, zero overhead)
     * @param {string | null} [winner]
     * @param {string | null} [reason]
     * @returns {string}
     */
    gameEnd(winner, reason) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(winner) ? 0 : passStringToWasm0(winner, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            var len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(reason) ? 0 : passStringToWasm0(reason, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            var len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_gameEnd(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Get agent data (typed, zero overhead)
     * @param {string} name
     * @returns {string}
     */
    agentGet(name) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_agentGet(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeObject(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred3_0, deferred3_1, 1);
        }
    }
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
     * @param {string} tokens_json
     * @param {string} operation
     * @returns {string}
     */
    batchMap(tokens_json, operation) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(tokens_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(operation, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_batchForEach(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Get the space instance
     * @returns {Space | undefined}
     */
    getSpace() {
        const ret = wasm.actiondispatcher_getSpace(this.__wbg_ptr);
        return ret === 0 ? undefined : Space.__wrap(ret);
    }
    /**
     * Get the stack instance
     * @returns {Stack | undefined}
     */
    getStack() {
        const ret = wasm.actiondispatcher_getStack(this.__wbg_ptr);
        return ret === 0 ? undefined : Stack.__wrap(ret);
    }
    /**
     * Set the space instance
     * @param {Space} space
     */
    setSpace(space) {
        _assertClass(space, Space);
        var ptr0 = space.__destroy_into_raw();
        wasm.actiondispatcher_setSpace(this.__wbg_ptr, ptr0);
    }
    /**
     * Set the stack instance
     * @param {Stack} stack
     */
    setStack(stack) {
        _assertClass(stack, Stack);
        var ptr0 = stack.__destroy_into_raw();
        wasm.actiondispatcher_setStack(this.__wbg_ptr, ptr0);
    }
    /**
     * @param {string} zone
     * @param {number} x
     * @param {number} y
     * @param {number} radius
     * @param {number} angle_start
     * @param {number} angle_step
     */
    spaceFan(zone, x, y, radius, angle_start, angle_step) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.actiondispatcher_spaceFan(retptr, this.__wbg_ptr, ptr0, len0, x, y, radius, angle_start, angle_step);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Cut stack at index (typed, zero overhead)
     * @param {number} index
     */
    stackCut(index) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.actiondispatcher_stackCut(retptr, this.__wbg_ptr, index);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) ActionDispatcher.prototype[Symbol.dispose] = ActionDispatcher.prototype.free;

/**
 * Agent manager for WASM
 */
export class AgentManager {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AgentManagerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_agentmanager_free(ptr, 0);
    }
    /**
     * Steal token from another agent
     * @param {string} from
     * @param {string} to
     * @param {string} token_id
     * @returns {string}
     */
    stealToken(from, to, token_id) {
        let deferred5_0;
        let deferred5_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(from, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(to, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(token_id, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len2 = WASM_VECTOR_LEN;
            wasm.agentmanager_stealToken(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr4 = r0;
            var len4 = r1;
            if (r3) {
                ptr4 = 0; len4 = 0;
                throw takeObject(r2);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * Create a new agent
     * @param {string} id
     * @param {string} name
     * @param {string | null} [meta_json]
     * @returns {string}
     */
    createAgent(id, name, meta_json) {
        let deferred5_0;
        let deferred5_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            var ptr2 = isLikeNone(meta_json) ? 0 : passStringToWasm0(meta_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            var len2 = WASM_VECTOR_LEN;
            wasm.agentmanager_createAgent(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr4 = r0;
            var len4 = r1;
            if (r3) {
                ptr4 = 0; len4 = 0;
                throw takeObject(r2);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * Remove an agent
     * @param {string} name
     */
    removeAgent(name) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.agentmanager_removeAgent(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Remove token from agent's inventory
     * @param {string} name
     * @param {string} token_id
     * @returns {string}
     */
    removeToken(name, token_id) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(token_id, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.agentmanager_removeToken(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Give resources to an agent
     * @param {string} name
     * @param {string} resource
     * @param {bigint} amount
     */
    giveResource(name, resource, amount) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(resource, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.agentmanager_giveResource(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, amount);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Take resources from an agent
     * @param {string} name
     * @param {string} resource
     * @param {bigint} amount
     */
    takeResource(name, resource, amount) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(resource, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.agentmanager_takeResource(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, amount);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get all agents as JSON array
     * @returns {string}
     */
    getAllAgents() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.agentmanager_getAllAgents(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Steal resource from another agent
     * @param {string} from
     * @param {string} to
     * @param {string} resource
     * @param {bigint} amount
     * @returns {string}
     */
    stealResource(from, to, resource, amount) {
        let deferred5_0;
        let deferred5_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(from, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(to, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(resource, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len2 = WASM_VECTOR_LEN;
            wasm.agentmanager_stealResource(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, amount);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr4 = r0;
            var len4 = r1;
            if (r3) {
                ptr4 = 0; len4 = 0;
                throw takeObject(r2);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * Transfer token between agents
     * @param {string} from
     * @param {string} to
     * @param {string} token_id
     * @returns {string}
     */
    transferToken(from, to, token_id) {
        let deferred5_0;
        let deferred5_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(from, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(to, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(token_id, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len2 = WASM_VECTOR_LEN;
            wasm.agentmanager_stealToken(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr4 = r0;
            var len4 = r1;
            if (r3) {
                ptr4 = 0; len4 = 0;
                throw takeObject(r2);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * Set agent active state
     * @param {string} name
     * @param {boolean} active
     */
    setAgentActive(name, active) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.agentmanager_setAgentActive(retptr, this.__wbg_ptr, ptr0, len0, active);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Transfer resource between agents
     * @param {string} from
     * @param {string} to
     * @param {string} resource
     * @param {bigint} amount
     * @returns {string}
     */
    transferResource(from, to, resource, amount) {
        let deferred5_0;
        let deferred5_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(from, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(to, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(resource, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len2 = WASM_VECTOR_LEN;
            wasm.agentmanager_transferResource(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, amount);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr4 = r0;
            var len4 = r1;
            if (r3) {
                ptr4 = 0; len4 = 0;
                throw takeObject(r2);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * Create a new Agent manager
     */
    constructor() {
        const ret = wasm.agentmanager_new();
        this.__wbg_ptr = ret >>> 0;
        AgentManagerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {string} agent1_name
     * @param {string} offer1_json
     * @param {string} agent2_name
     * @param {string} offer2_json
     * @returns {string}
     */
    trade(agent1_name, offer1_json, agent2_name, offer2_json) {
        let deferred6_0;
        let deferred6_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(agent1_name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(offer1_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(agent2_name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passStringToWasm0(offer2_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len3 = WASM_VECTOR_LEN;
            wasm.agentmanager_trade(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr5 = r0;
            var len5 = r1;
            if (r3) {
                ptr5 = 0; len5 = 0;
                throw takeObject(r2);
            }
            deferred6_0 = ptr5;
            deferred6_1 = len5;
            return getStringFromWasm0(ptr5, len5);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred6_0, deferred6_1, 1);
        }
    }
    /**
     * Add token to agent's inventory
     * @param {string} name
     * @param {string} token_json
     */
    addToken(name, token_json) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(token_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.agentmanager_addToken(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get agent state as JSON
     * @param {string} name
     * @returns {string}
     */
    getAgent(name) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.agentmanager_getAgent(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeObject(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred3_0, deferred3_1, 1);
        }
    }
}
if (Symbol.dispose) AgentManager.prototype[Symbol.dispose] = AgentManager.prototype.free;

/**
 * BatchOps: High-performance batch operations
 *
 * Provides WASM-exposed batch operations that can process
 * multiple items efficiently using optimized algorithms.
 */
export class BatchOps {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        BatchOpsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_batchops_free(ptr, 0);
    }
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
     * @param {string} decks_json
     * @param {string} counts_json
     * @returns {string}
     */
    batchDraw(decks_json, counts_json) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(decks_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(counts_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.batchops_batchDraw(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
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
     * @param {string} tokens_json
     * @param {string} operation
     * @returns {string}
     */
    parallelMap(tokens_json, operation) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(tokens_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(operation, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.batchops_parallelMap(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
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
     * @param {string} decks_json
     * @param {string | null} [seed_prefix]
     * @returns {string}
     */
    batchShuffle(decks_json, seed_prefix) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(decks_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(seed_prefix) ? 0 : passStringToWasm0(seed_prefix, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            var len1 = WASM_VECTOR_LEN;
            wasm.batchops_batchShuffle(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Parallel find operation
     *
     * Returns the first token matching the predicate.
     * @param {string} tokens_json
     * @param {string} predicate
     * @returns {string}
     */
    parallelFind(tokens_json, predicate) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(tokens_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(predicate, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.batchops_parallelFind(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Parallel count operation
     *
     * Returns the number of tokens matching the predicate.
     * @param {string} tokens_json
     * @param {string} predicate
     * @returns {number}
     */
    parallelCount(tokens_json, predicate) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(tokens_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(predicate, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.batchops_parallelCount(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
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
     * @param {string} tokens_json
     * @param {string} predicate
     * @returns {string}
     */
    parallelFilter(tokens_json, predicate) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(tokens_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(predicate, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.batchops_parallelFilter(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Create a new BatchOps instance
     */
    constructor() {
        const ret = wasm.batchops_new();
        this.__wbg_ptr = ret >>> 0;
        BatchOpsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) BatchOps.prototype[Symbol.dispose] = BatchOps.prototype.free;

/**
 * Chronicle wraps an Automerge CRDT document
 *
 * This implementation stores HyperTokenState fields as native Automerge
 * maps and lists, enabling field-level CRDT conflict resolution.
 *
 * Document structure:
 * ROOT
 * ├── stack: { stack: [...], drawn: [...], discards: [...] }
 * ├── zones: { zone_name: [...placements...], ... }
 * ├── source: { stackIds: [...], tokens: [...], burned: [...], seed, reshufflePolicy: {...} }
 * ├── gameLoop: { turn, running, activeAgentIndex, phase, maxTurns }
 * ├── rules: { fired: { ruleName: timestamp, ... } }
 * ├── agents: { agentName: {...}, ... }
 * ├── version: "string"
 * └── nullifiers: { hash: timestamp, ... }
 */
export class Chronicle {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ChronicleFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_chronicle_free(ptr, 0);
    }
    /**
     * Get the number of changes in the document
     * @returns {number}
     */
    changeCount() {
        const ret = wasm.chronicle_changeCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Save document to Base64 string (for easier transport)
     * @returns {string}
     */
    saveToBase64() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.chronicle_saveToBase64(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Load document from Base64 string
     * @param {string} base64
     */
    loadFromBase64(base64) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(base64, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.chronicle_loadFromBase64(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Receive a sync message and update the document
     *
     * Takes:
     * - message_base64: The sync message from the peer (base64 encoded)
     * - sync_state_bytes: Optional serialized SyncState
     *
     * Returns: JSON with updated sync state and any response message
     * @param {string} message_base64
     * @param {Uint8Array | null} [sync_state_bytes]
     * @returns {string}
     */
    receiveSyncMessage(message_base64, sync_state_bytes) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(message_base64, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(sync_state_bytes) ? 0 : passArray8ToWasm0(sync_state_bytes, wasm.__wbindgen_export3);
            var len1 = WASM_VECTOR_LEN;
            wasm.chronicle_receiveSyncMessage(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
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
     * @param {Uint8Array | null} [sync_state_bytes]
     * @returns {string}
     */
    generateSyncMessage(sync_state_bytes) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(sync_state_bytes) ? 0 : passArray8ToWasm0(sync_state_bytes, wasm.__wbindgen_export3);
            var len0 = WASM_VECTOR_LEN;
            wasm.chronicle_generateSyncMessage(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeObject(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Create a new Chronicle with an empty CRDT document
     */
    constructor() {
        const ret = wasm.chronicle_new();
        this.__wbg_ptr = ret >>> 0;
        ChronicleFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Load a document from binary format
     * @param {Uint8Array} data
     */
    load(data) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export3);
            const len0 = WASM_VECTOR_LEN;
            wasm.chronicle_load(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Save the document to a binary format
     * @returns {Uint8Array}
     */
    save() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.chronicle_save(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            if (r3) {
                throw takeObject(r2);
            }
            var v1 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export2(r0, r1 * 1, 1);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Merge another document into this one
     * @param {Uint8Array} other_data
     */
    merge(other_data) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(other_data, wasm.__wbindgen_export3);
            const len0 = WASM_VECTOR_LEN;
            wasm.chronicle_merge(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Apply a change to the document
     *
     * JavaScript usage:
     * ```js
     * chronicle.change("draw-card", newStateJson);
     * ```
     * @param {string} _message
     * @param {string} new_state_json
     */
    change(_message, new_state_json) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(_message, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(new_state_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.chronicle_change(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get the current document state as JSON
     *
     * Reads native Automerge fields and reconstructs HyperTokenState.
     * @returns {string}
     */
    getState() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.chronicle_getState(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Set the entire state (used for initialization)
     *
     * Takes a JSON string of HyperTokenState and stores each field
     * natively in the CRDT for proper conflict resolution.
     * @param {string} state_json
     */
    setState(state_json) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(state_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.chronicle_setState(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Simple full-document sync (for backwards compatibility)
     *
     * Merges the given binary document into this one.
     * @param {Uint8Array} other_doc_bytes
     */
    syncFull(other_doc_bytes) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(other_doc_bytes, wasm.__wbindgen_export3);
            const len0 = WASM_VECTOR_LEN;
            wasm.chronicle_merge(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) Chronicle.prototype[Symbol.dispose] = Chronicle.prototype.free;

/**
 * Game state manager for WASM
 */
export class GameStateManager {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GameStateManagerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_gamestatemanager_free(ptr, 0);
    }
    /**
     * Advance to next phase or set specific phase
     * @param {string | null} [phase]
     * @returns {string}
     */
    nextPhase(phase) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(phase) ? 0 : passStringToWasm0(phase, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            var len0 = WASM_VECTOR_LEN;
            wasm.gamestatemanager_nextPhase(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeObject(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Set arbitrary game state property
     * @param {string} key
     * @param {string} value_json
     * @returns {string}
     */
    setProperty(key, value_json) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(key, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(value_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.gamestatemanager_setProperty(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * End the game
     * @param {string | null} [winner]
     * @param {string | null} [reason]
     * @returns {string}
     */
    end(winner, reason) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(winner) ? 0 : passStringToWasm0(winner, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            var len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(reason) ? 0 : passStringToWasm0(reason, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            var len1 = WASM_VECTOR_LEN;
            wasm.gamestatemanager_end(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Create a new GameState manager
     */
    constructor() {
        const ret = wasm.gamestatemanager_new();
        this.__wbg_ptr = ret >>> 0;
        GameStateManagerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Pause the game
     * @returns {string}
     */
    pause() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.gamestatemanager_pause(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Start the game
     * @returns {string}
     */
    start() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.gamestatemanager_start(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Resume the game from pause
     * @returns {string}
     */
    resume() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.gamestatemanager_resume(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Get current game state as JSON
     * @returns {string}
     */
    getState() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.gamestatemanager_getState(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
}
if (Symbol.dispose) GameStateManager.prototype[Symbol.dispose] = GameStateManager.prototype.free;

/**
 * Position in 2D space
 */
export class Position {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PositionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_position_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get x() {
        const ret = wasm.__wbg_get_position_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set x(arg0) {
        wasm.__wbg_set_position_x(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {number}
     */
    get y() {
        const ret = wasm.__wbg_get_position_y(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set y(arg0) {
        wasm.__wbg_set_position_y(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} x
     * @param {number} y
     */
    constructor(x, y) {
        const ret = wasm.position_new(x, y);
        this.__wbg_ptr = ret >>> 0;
        PositionFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) Position.prototype[Symbol.dispose] = Position.prototype.free;

/**
 * Source: Ordered collection combining multiple stacks
 *
 * Provides high-performance replacement for TypeScript Source class.
 * Key improvements over TypeScript:
 * - No JSON.parse/stringify cloning for shuffle (zero-copy)
 * - Efficient Vec operations instead of Array manipulations
 * - Direct memory management (no GC pressure)
 * - Eliminates Chronicle proxy serialization overhead
 *
 * Performance targets (vs TypeScript):
 * - Shuffle: 237ms → <5ms (50x improvement)
 * - Reset: 183ms → <5ms (35x improvement)
 * - Add stack: 88ms → <1ms (88x improvement)
 */
export class Source {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Source.prototype);
        obj.__wbg_ptr = ptr;
        SourceFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SourceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_source_free(ptr, 0);
    }
    /**
     * Get burned tokens as JSON
     * @returns {string}
     */
    getBurned() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.source_getBurned(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Get tokens as JSON
     * @returns {string}
     */
    getTokens() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.source_getTokens(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Get the number of burned tokens
     * @returns {number}
     */
    burnedCount() {
        const ret = wasm.source_burnedCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Remove a stack by ID
     * @param {string} stack_id
     */
    removeStack(stack_id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(stack_id, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.source_removeStack(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get stack IDs as JSON
     * @returns {string}
     */
    getStackIds() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.source_getStackIds(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Restore burned cards to the main tokens list (soft reset)
     */
    restoreBurned() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.source_restoreBurned(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get reshuffle policy as JSON
     * @returns {string}
     */
    getReshufflePolicy() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.source_getReshufflePolicy(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Set reshuffle policy
     * @param {number} threshold
     * @param {string} mode
     */
    setReshufflePolicy(threshold, mode) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.source_setReshufflePolicy(retptr, this.__wbg_ptr, threshold, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Initialize source with tokens from JSON array
     * @param {string} tokens_json
     * @param {string} stack_ids_json
     */
    initializeWithTokens(tokens_json, stack_ids_json) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(tokens_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(stack_ids_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.source_initializeWithTokens(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Create a new Source
     */
    constructor() {
        const ret = wasm.source_new();
        this.__wbg_ptr = ret >>> 0;
        SourceFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Burn (remove) N tokens from the top of the source
     * @param {number} count
     * @returns {string}
     */
    burn(count) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.source_burn(retptr, this.__wbg_ptr, count);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Draw N tokens from the source
     *
     * Returns JSON array of drawn tokens
     * If reshuffle policy is set and threshold is reached, auto-reshuffles
     * @param {number} count
     * @returns {string}
     */
    draw(count) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.source_draw(retptr, this.__wbg_ptr, count);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Get the number of tokens in the source
     * @returns {number}
     */
    size() {
        const ret = wasm.source_size(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Reset source with new tokens
     * @param {string} tokens_json
     */
    reset(tokens_json) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(tokens_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.source_reset(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Inspect source state (summary for debugging/UI)
     * @returns {string}
     */
    inspect() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.source_inspect(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Shuffle the source
     *
     * If seed is provided, uses deterministic shuffle
     * @param {string | null} [seed]
     */
    shuffle(seed) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(seed) ? 0 : passStringToWasm0(seed, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            var len0 = WASM_VECTOR_LEN;
            wasm.source_shuffle(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get current seed
     * @returns {number | undefined}
     */
    getSeed() {
        const ret = wasm.source_getSeed(this.__wbg_ptr);
        return ret === 0x100000001 ? undefined : ret;
    }
    /**
     * Add tokens from a stack
     * @param {string} tokens_json
     * @param {string} stack_id
     */
    addStack(tokens_json, stack_id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(tokens_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(stack_id, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.source_addStack(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get current state as JSON
     * @returns {string}
     */
    getState() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.source_getState(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Set state from JSON
     * @param {string} state_json
     */
    setState(state_json) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(state_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.source_setState(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) Source.prototype[Symbol.dispose] = Source.prototype.free;

/**
 * Space: 2D placement with zone management
 *
 * Provides high-performance spatial token management.
 * Key improvements over TypeScript:
 * - Direct HashMap lookups (no object proxy overhead)
 * - Efficient vector operations (no JSON cloning)
 * - Better memory layout
 *
 * Performance targets (vs TypeScript):
 * - Place 1000 tokens: 958ms → <50ms (20x improvement)
 * - Query 100 tokens: 82ms → <5ms (16x improvement)
 */
export class Space {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Space.prototype);
        obj.__wbg_ptr = ptr;
        SpaceFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SpaceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_space_free(ptr, 0);
    }
    /**
     * Clear all tokens from a zone
     * @param {string} zone_name
     */
    clearZone(zone_name) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(zone_name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.space_clearZone(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get all tokens in a zone as JSON array
     * @param {string} zone_name
     * @returns {string}
     */
    getTokens(zone_name) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(zone_name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.space_getTokens(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeObject(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Move a placement between zones by placement ID
     * @param {string} placement_id
     * @param {string} from_zone
     * @param {string} to_zone
     * @param {number | null} [x]
     * @param {number | null} [y]
     */
    move(placement_id, from_zone, to_zone, x, y) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(placement_id, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(from_zone, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(to_zone, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len2 = WASM_VECTOR_LEN;
            wasm.space_move(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, !isLikeNone(x), isLikeNone(x) ? 0 : x, !isLikeNone(y), isLikeNone(y) ? 0 : y);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Create a zone
     * @param {string} name
     */
    createZone(name) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.space_createZone(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Delete a zone
     * @param {string} name
     */
    deleteZone(name) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.space_deleteZone(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Shuffle tokens in a zone (randomize z-index)
     * @param {string} zone_name
     * @param {string | null} [seed]
     */
    shuffleZone(zone_name, seed) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(zone_name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(seed) ? 0 : passStringToWasm0(seed, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            var len1 = WASM_VECTOR_LEN;
            wasm.space_shuffleZone(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Arrange tokens in a stack (pile) layout
     * @param {string} zone_name
     * @param {number} x
     * @param {number} y
     * @param {number} offset_x
     * @param {number} offset_y
     */
    stackLayout(zone_name, x, y, offset_x, offset_y) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(zone_name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.space_stackLayout(retptr, this.__wbg_ptr, ptr0, len0, x, y, offset_x, offset_y);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Transfer all tokens from one zone to another
     * @param {string} from_zone
     * @param {string} to_zone
     * @returns {number}
     */
    transferZone(from_zone, to_zone) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(from_zone, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(to_zone, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.space_transferZone(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get all placements in a zone as JSON
     * @param {string} zone_name
     * @returns {string}
     */
    getPlacements(zone_name) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(zone_name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.space_getPlacements(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeObject(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Get list of all zone names
     * @returns {string[]}
     */
    getZoneNames() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.space_getZoneNames(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayJsValueFromWasm0(r0, r1).slice();
            wasm.__wbindgen_export2(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Check if a zone is locked
     * @param {string} name
     * @returns {boolean}
     */
    isZoneLocked(name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.space_isZoneLocked(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Arrange tokens in a fan (arc) layout
     * @param {string} zone_name
     * @param {number} x
     * @param {number} y
     * @param {number} radius
     * @param {number} angle_start
     * @param {number} angle_step
     */
    fan(zone_name, x, y, radius, angle_start, angle_step) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(zone_name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.space_fan(retptr, this.__wbg_ptr, ptr0, len0, x, y, radius, angle_start, angle_step);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Create a new Space
     */
    constructor() {
        const ret = wasm.agentmanager_new();
        this.__wbg_ptr = ret >>> 0;
        SpaceFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Flip a placement in a zone by placement ID
     * @param {string} zone_name
     * @param {string} placement_id
     * @param {boolean | null} [face_up]
     */
    flip(zone_name, placement_id, face_up) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(zone_name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(placement_id, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.space_flip(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, isLikeNone(face_up) ? 0xFFFFFF : face_up ? 1 : 0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Clear all tokens from ALL zones (Global clear)
     */
    clear() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.space_clear(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get the count of tokens in a zone
     * @param {string} zone_name
     * @returns {number}
     */
    count(zone_name) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(zone_name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.space_count(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Place a token in a zone
     * Returns the placement as JSON
     * @param {string} zone_name
     * @param {string} token_json
     * @param {number | null} [x]
     * @param {number | null} [y]
     * @returns {string}
     */
    place(zone_name, token_json, x, y) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(zone_name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(token_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.space_place(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, !isLikeNone(x), isLikeNone(x) ? 0 : x, !isLikeNone(y), isLikeNone(y) ? 0 : y);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Remove a placement from a zone by placement ID
     * @param {string} zone_name
     * @param {string} placement_id
     * @returns {string}
     */
    remove(zone_name, placement_id) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(zone_name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(placement_id, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.space_remove(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Arrange tokens in a linear spread
     * @param {string} zone_name
     * @param {number} x
     * @param {number} y
     * @param {number} spacing
     * @param {boolean} horizontal
     */
    spread(zone_name, x, y, spacing, horizontal) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(zone_name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.space_spread(retptr, this.__wbg_ptr, ptr0, len0, x, y, spacing, horizontal);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Check if a zone exists
     * @param {string} name
     * @returns {boolean}
     */
    hasZone(name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.space_hasZone(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Get the full state as JSON
     * @returns {string}
     */
    getState() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.space_getState(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Lock or unlock a zone
     * @param {string} name
     * @param {boolean} locked
     */
    lockZone(name, locked) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.space_lockZone(retptr, this.__wbg_ptr, ptr0, len0, locked);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Set the state from JSON
     * @param {string} state_json
     */
    setState(state_json) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(state_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.space_setState(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) Space.prototype[Symbol.dispose] = Space.prototype.free;

/**
 * Stack: Ordered collection with shuffle/draw operations
 *
 * Provides a high-performance replacement for the TypeScript Stack class.
 * Key improvements:
 * - No JSON.parse/stringify cloning (zero-copy operations)
 * - Efficient Vec operations instead of Array manipulations
 * - Direct memory management (no GC pressure)
 *
 * Performance targets (vs TypeScript):
 * - Shuffle 1000 tokens: 986ms → <50ms (20x improvement)
 * - Draw single card: 18ms → <1ms (18x improvement)
 */
export class Stack {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Stack.prototype);
        obj.__wbg_ptr = ptr;
        StackFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        StackFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_stack_free(ptr, 0);
    }
    /**
     * Get the number of drawn tokens
     * @returns {number}
     */
    drawnCount() {
        const ret = wasm.stack_drawnCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get the number of discarded tokens
     * @returns {number}
     */
    discardCount() {
        const ret = wasm.stack_discardCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Reverse a range of tokens
     * @param {number} start
     * @param {number} end
     */
    reverseRange(start, end) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.stack_reverseRange(retptr, this.__wbg_ptr, start, end);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Add a specific token to the discard pile (used by agents discarding)
     * @param {string} token_json
     */
    addToDiscard(token_json) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(token_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.stack_addToDiscard(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Static helper: Shuffle an array of tokens without creating a Stack instance
     *
     * Avoids the overhead of Stack instantiation for standalone shuffle operations.
     * This is much faster for Source.ts which just needs to shuffle tokens without
     * the full Stack state management.
     * @param {string} tokens_json
     * @param {string} seed
     * @returns {string}
     */
    static shuffleTokens(tokens_json, seed) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(tokens_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(seed, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.stack_shuffleTokens(retptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Initialize stack with tokens from JSON array
     * @param {string} tokens_json
     */
    initializeWithTokens(tokens_json) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(tokens_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.stack_initializeWithTokens(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Cut the deck at a specific index
     * @param {number} index
     */
    cut(index) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.stack_cut(retptr, this.__wbg_ptr, index);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Create a new Stack
     */
    constructor() {
        const ret = wasm.stack_new();
        this.__wbg_ptr = ret >>> 0;
        StackFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Burn (remove) N tokens from the top of the stack
     * @param {number} count
     * @returns {string}
     */
    burn(count) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.stack_burn(retptr, this.__wbg_ptr, count);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Draw N tokens from the stack
     *
     * Returns JSON array of drawn tokens
     * @param {number} count
     * @returns {string}
     */
    draw(count) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.stack_draw(retptr, this.__wbg_ptr, count);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Peek at N tokens from the top of the stack (without removing them)
     *
     * Returns JSON array of tokens
     * @param {number} count
     * @returns {string}
     */
    peek(count) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.stack_peek(retptr, this.__wbg_ptr, count);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Get the number of tokens in the stack
     * @returns {number}
     */
    size() {
        const ret = wasm.stack_size(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Swap two tokens by index
     * @param {number} index_a
     * @param {number} index_b
     */
    swap(index_a, index_b) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.stack_swap(retptr, this.__wbg_ptr, index_a, index_b);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Reset the stack (move all drawn/discarded back to stack)
     */
    reset() {
        wasm.stack_reset(this.__wbg_ptr);
    }
    /**
     * Discard drawn tokens to discard pile
     * @param {number} count
     */
    discard(count) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.stack_discard(retptr, this.__wbg_ptr, count);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Reverse the order of the stack
     */
    reverse() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.stack_reverse(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Shuffle the stack
     *
     * If seed is provided, uses deterministic shuffle
     * @param {string | null} [seed]
     */
    shuffle(seed) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(seed) ? 0 : passStringToWasm0(seed, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            var len0 = WASM_VECTOR_LEN;
            wasm.stack_shuffle(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get the full state as JSON
     * @returns {string}
     */
    getState() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.stack_getState(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Insert a token at a specific index
     * @param {number} index
     * @param {string} token_json
     */
    insertAt(index, token_json) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(token_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.stack_insertAt(retptr, this.__wbg_ptr, index, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Remove a token at a specific index
     * @param {number} index
     * @returns {string}
     */
    removeAt(index) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.stack_removeAt(retptr, this.__wbg_ptr, index);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Set the state from JSON
     * @param {string} state_json
     */
    setState(state_json) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(state_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.stack_setState(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) Stack.prototype[Symbol.dispose] = Stack.prototype.free;

/**
 * Universal entity representation
 *
 * Tokens are the fundamental data structure representing game entities
 * (cards, items, agents, etc.). They support:
 * - Metadata and grouping
 * - Reversals (tarot-style)
 * - Tags and attachments
 * - Merge/split tracking for composite entities
 */
export class Token {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Token.prototype);
        obj.__wbg_ptr = ptr;
        TokenFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TokenFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_token_free(ptr, 0);
    }
    /**
     * Remove a tag from the token
     * @param {string} tag
     * @returns {boolean}
     */
    removeTag(tag) {
        const ptr0 = passStringToWasm0(tag, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.token_removeTag(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Check if token is reversed
     * @returns {boolean}
     */
    isReversed() {
        const ret = wasm.token_isReversed(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Create a new Token with minimal properties
     * @param {string} id
     * @param {number} index
     */
    constructor(id, index) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.token_new(ptr0, len0, index);
        this.__wbg_ptr = ret >>> 0;
        TokenFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Flip the token (toggle reversed state)
     */
    flip() {
        wasm.token_flip(this.__wbg_ptr);
    }
    /**
     * Get the token ID
     * @returns {string}
     */
    getId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.token_getId(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Add a tag to the token
     * @param {string} tag
     */
    addTag(tag) {
        const ptr0 = passStringToWasm0(tag, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
        const len0 = WASM_VECTOR_LEN;
        wasm.token_addTag(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Check if token has a specific tag
     * @param {string} tag
     * @returns {boolean}
     */
    hasTag(tag) {
        const ptr0 = passStringToWasm0(tag, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.token_hasTag(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Convert Token to JSON string
     * @returns {string}
     */
    toJSON() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.token_toJSON(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Create a Token from a JSON string
     * @param {string} json
     * @returns {Token}
     */
    static fromJSON(json) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.token_fromJSON(retptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return Token.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get the token index
     * @returns {number}
     */
    getIndex() {
        const ret = wasm.token_getIndex(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) Token.prototype[Symbol.dispose] = Token.prototype.free;

/**
 * Token operations manager for WASM
 */
export class TokenOps {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TokenOpsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_tokenops_free(ptr, 0);
    }
    /**
     * Create a new TokenOps instance
     */
    constructor() {
        const ret = wasm.batchops_new();
        this.__wbg_ptr = ret >>> 0;
        TokenOpsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Merge multiple tokens into one
     *
     * Combines properties from multiple tokens. The first token is used as
     * the base, with properties from subsequent tokens merged in.
     * @param {string} tokens_json
     * @param {string | null | undefined} result_properties_json
     * @param {boolean} keep_originals
     * @returns {string}
     */
    merge(tokens_json, result_properties_json, keep_originals) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(tokens_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(result_properties_json) ? 0 : passStringToWasm0(result_properties_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            var len1 = WASM_VECTOR_LEN;
            wasm.tokenops_merge(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, keep_originals);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Split a token into multiple tokens
     *
     * Creates multiple copies of a token with optional custom properties.
     * @param {string} token_json
     * @param {number} count
     * @param {string | null} [properties_array_json]
     * @returns {string}
     */
    split(token_json, count, properties_array_json) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(token_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(properties_array_json) ? 0 : passStringToWasm0(properties_array_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            var len1 = WASM_VECTOR_LEN;
            wasm.tokenops_split(retptr, this.__wbg_ptr, ptr0, len0, count, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Attach a token to another token
     *
     * Creates an attachment relationship. The attachment token gains
     * _attachedTo and _attachmentType properties.
     * @param {string} host_json
     * @param {string} attachment_json
     * @param {string} attachment_type
     * @returns {string}
     */
    attach(host_json, attachment_json, attachment_type) {
        let deferred5_0;
        let deferred5_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(host_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(attachment_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(attachment_type, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len2 = WASM_VECTOR_LEN;
            wasm.tokenops_attach(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr4 = r0;
            var len4 = r1;
            if (r3) {
                ptr4 = 0; len4 = 0;
                throw takeObject(r2);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * Detach a token from its host
     *
     * Removes the attachment relationship and returns the detached token.
     * @param {string} host_json
     * @param {string} attachment_id
     * @returns {string}
     */
    detach(host_json, attachment_id) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(host_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(attachment_id, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.tokenops_detach(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Transform a token by applying properties
     *
     * This modifies the token's properties in-place. Properties are merged
     * with existing token data.
     * @param {string} token_json
     * @param {string} properties_json
     * @returns {string}
     */
    transform(token_json, properties_json) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(token_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(properties_json, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            wasm.tokenops_transform(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred4_0, deferred4_1, 1);
        }
    }
}
if (Symbol.dispose) TokenOps.prototype[Symbol.dispose] = TokenOps.prototype.free;

/**
 * @returns {boolean}
 */
export function health_check() {
    const ret = wasm.health_check();
    return ret !== 0;
}

export function init() {
    wasm.init();
}

/**
 * @returns {string}
 */
export function version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.version(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred1_0 = r0;
        deferred1_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export2(deferred1_0, deferred1_1, 1);
    }
}

const EXPECTED_RESPONSE_TYPES = new Set(['basic', 'cors', 'default']);

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && EXPECTED_RESPONSE_TYPES.has(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }
}

function __wbg_get_imports() {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbg___wbindgen_is_function_8d400b8b1af978cd = function(arg0) {
        const ret = typeof(getObject(arg0)) === 'function';
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_object_ce774f3490692386 = function(arg0) {
        const val = getObject(arg0);
        const ret = typeof(val) === 'object' && val !== null;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_string_704ef9c8fc131030 = function(arg0) {
        const ret = typeof(getObject(arg0)) === 'string';
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_undefined_f6b95eab589e0269 = function(arg0) {
        const ret = getObject(arg0) === undefined;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_throw_dd24417ed36fc46e = function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
    };
    imports.wbg.__wbg_call_3020136f7a2d6e44 = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = getObject(arg0).call(getObject(arg1), getObject(arg2));
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_call_abb4ff46ce38be40 = function() { return handleError(function (arg0, arg1) {
        const ret = getObject(arg0).call(getObject(arg1));
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_crypto_574e78ad8b13b65f = function(arg0) {
        const ret = getObject(arg0).crypto;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_getRandomValues_9b655bdd369112f2 = function() { return handleError(function (arg0, arg1) {
        globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
    }, arguments) };
    imports.wbg.__wbg_getRandomValues_b8f5dbd5f3995a9e = function() { return handleError(function (arg0, arg1) {
        getObject(arg0).getRandomValues(getObject(arg1));
    }, arguments) };
    imports.wbg.__wbg_getTime_ad1e9878a735af08 = function(arg0) {
        const ret = getObject(arg0).getTime();
        return ret;
    };
    imports.wbg.__wbg_length_22ac23eaec9d8053 = function(arg0) {
        const ret = getObject(arg0).length;
        return ret;
    };
    imports.wbg.__wbg_msCrypto_a61aeb35a24c1329 = function(arg0) {
        const ret = getObject(arg0).msCrypto;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_new_0_23cedd11d9b40c9d = function() {
        const ret = new Date();
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_new_no_args_cb138f77cf6151ee = function(arg0, arg1) {
        const ret = new Function(getStringFromWasm0(arg0, arg1));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_new_with_length_aa5eaf41d35235e5 = function(arg0) {
        const ret = new Uint8Array(arg0 >>> 0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_node_905d3e251edff8a2 = function(arg0) {
        const ret = getObject(arg0).node;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_now_69d776cd24f5215b = function() {
        const ret = Date.now();
        return ret;
    };
    imports.wbg.__wbg_process_dc0fbacc7c1c06f7 = function(arg0) {
        const ret = getObject(arg0).process;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_prototypesetcall_dfe9b766cdc1f1fd = function(arg0, arg1, arg2) {
        Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), getObject(arg2));
    };
    imports.wbg.__wbg_randomFillSync_ac0988aba3254290 = function() { return handleError(function (arg0, arg1) {
        getObject(arg0).randomFillSync(takeObject(arg1));
    }, arguments) };
    imports.wbg.__wbg_require_60cc747a6bc5215a = function() { return handleError(function () {
        const ret = module.require;
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_static_accessor_GLOBAL_769e6b65d6557335 = function() {
        const ret = typeof global === 'undefined' ? null : global;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_static_accessor_GLOBAL_THIS_60cf02db4de8e1c1 = function() {
        const ret = typeof globalThis === 'undefined' ? null : globalThis;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_static_accessor_SELF_08f5a74c69739274 = function() {
        const ret = typeof self === 'undefined' ? null : self;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_static_accessor_WINDOW_a8924b26aa92d024 = function() {
        const ret = typeof window === 'undefined' ? null : window;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_subarray_845f2f5bce7d061a = function(arg0, arg1, arg2) {
        const ret = getObject(arg0).subarray(arg1 >>> 0, arg2 >>> 0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_versions_c01dfd4722a88165 = function(arg0) {
        const ret = getObject(arg0).versions;
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_cast_2241b6af4c4b2941 = function(arg0, arg1) {
        // Cast intrinsic for `Ref(String) -> Externref`.
        const ret = getStringFromWasm0(arg0, arg1);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_cast_cb9088102bce6b30 = function(arg0, arg1) {
        // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
        const ret = getArrayU8FromWasm0(arg0, arg1);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_object_clone_ref = function(arg0) {
        const ret = getObject(arg0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_object_drop_ref = function(arg0) {
        takeObject(arg0);
    };

    return imports;
}

function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;


    wasm.__wbindgen_start();
    return wasm;
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (typeof module !== 'undefined') {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (typeof module_or_path !== 'undefined') {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (typeof module_or_path === 'undefined') {
        module_or_path = new URL('hypertoken_core_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync };
export default __wbg_init;
