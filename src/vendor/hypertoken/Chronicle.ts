/*
 * Copyright 2025 The Carpocratian Church of Commonality and Equality, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * ChronicleWasm: Fully Rust-backed Chronicle implementation
 *
 * This implementation uses Rust automerge-rs as the CRDT backend.
 * Binary sync is used to preserve CRDT history and merge metadata
 * when transferring state between WASM and TypeScript layers.
 *
 * The Rust Chronicle stores the entire CloutState within
 * the CRDT document, maintaining all conflict-free merge semantics.
 */

import * as A from "@automerge/automerge";
import { Emitter } from "./events.js";
import { CloutState } from "../../clout-types.js";
import { Buffer } from "node:buffer";
import { tryLoadWasm, isWasmAvailable, getWasmModule, type WasmChronicle } from "./WasmBridge.js";

/**
 * Chronicle with Rust/WASM backend
 *
 * Maintains the same API as Chronicle.ts but uses automerge-rs internally.
 * Falls back to TypeScript Automerge if WASM is unavailable.
 */
export class ChronicleWasm extends Emitter {
  private _doc: A.Doc<CloutState>;
  private _wasmChronicle: WasmChronicle | null = null;
  private _useWasm: boolean = false;

  constructor(initialState?: CloutState) {
    super();

    // Initialize TypeScript doc (fallback)
    this._doc = initialState ? A.from<CloutState>(initialState) : A.init<CloutState>();

    // Initialize WASM Chronicle
    this._initializeWasm(initialState);
  }

  private _initializeWasm(initialState?: CloutState): void {
    if (!isWasmAvailable()) {
      console.warn("⚠️  WASM not available, Chronicle using TypeScript Automerge fallback");
      return;
    }

    try {
      const wasm = getWasmModule();
      if (!wasm) {
        console.warn("⚠️  WASM module not loaded, Chronicle using TypeScript fallback");
        return;
      }

      // Create Rust Chronicle
      this._wasmChronicle = new wasm.Chronicle();

      // Initialize with state if provided
	  if (initialState) {
        this._wasmChronicle.setState(JSON.stringify(initialState));
      } else {
        // FIX: Initialize with required fields (arrays), not just {}
        const emptyState: CloutState = {
          myPosts: [],
          myTrustSignals: [],
          myReactions: [],
          myPostDeletions: []
        };
        this._wasmChronicle.setState(JSON.stringify(emptyState));
      }

      this._useWasm = true;
    } catch (error) {
      console.error("❌ Failed to initialize WASM Chronicle:", error);
      console.warn("⚠️  Falling back to TypeScript Automerge");
      this._wasmChronicle = null;
      this._useWasm = false;
    }
  }

  get state(): A.Doc<CloutState> {
    // If using WASM, sync from WASM to TypeScript doc using binary format
    if (this._useWasm && this._wasmChronicle) {
      try {
        // Use binary sync to preserve CRDT history/metadata
        const binary = this._wasmChronicle.save();
        this._doc = A.load<CloutState>(new Uint8Array(binary));
      } catch (error) {
        console.error("❌ Failed to get state from WASM Chronicle:", error);
      }
    }

    return this._doc;
  }

  get isWasmEnabled(): boolean {
    return this._useWasm && this._wasmChronicle !== null;
  }

  change(message: string, callback: (doc: CloutState) => void, source: string = "local"): void {
    if (this._useWasm && this._wasmChronicle) {
      try {
        // Get current state from WASM
        const currentStateJson = this._wasmChronicle.getState();
        const currentState = JSON.parse(currentStateJson) as CloutState;

        // Apply callback to get new state
        const newState = { ...currentState };
        callback(newState);

        // Store new state in WASM
        this._wasmChronicle.change(message, JSON.stringify(newState));

        // Use binary sync to preserve CRDT history/metadata
        const binary = this._wasmChronicle.save();
        this._doc = A.load<CloutState>(new Uint8Array(binary));

        this.emit("state:changed", { doc: this._doc, source });
      } catch (error) {
        console.error("❌ WASM Chronicle change failed, falling back to TypeScript:", error);
        // Fallback to TypeScript
        const newDoc = A.change(this._doc, message, callback);
        this._doc = newDoc;
        this.emit("state:changed", { doc: newDoc, source });
      }
    } else {
      // Use TypeScript Automerge
      const newDoc = A.change(this._doc, message, callback);
      this._doc = newDoc;
      this.emit("state:changed", { doc: newDoc, source });
    }
  }

  update(newDoc: A.Doc<CloutState>, source: string = "local"): void {
    this._doc = newDoc;

    // Sync to WASM if enabled
    if (this._useWasm && this._wasmChronicle) {
      try {
        this._wasmChronicle.setState(JSON.stringify(newDoc));
      } catch (error) {
        console.error("❌ Failed to sync state to WASM Chronicle:", error);
      }
    }

    this.emit("state:changed", { doc: this._doc, source });
  }

  merge(remoteDoc: A.Doc<CloutState>): void {
    if (this._useWasm && this._wasmChronicle) {
      try {
        // Save remote doc to binary
        const remoteBinary = A.save(remoteDoc);

        // Merge in WASM
        this._wasmChronicle.merge(remoteBinary);

        // Use binary sync to preserve CRDT history/metadata
        const binary = this._wasmChronicle.save();
        this._doc = A.load<CloutState>(new Uint8Array(binary));

        this.emit("state:changed", { doc: this._doc, source: "merge" });
      } catch (error) {
        console.error("❌ WASM Chronicle merge failed, falling back to TypeScript:", error);
        // Fallback to TypeScript merge
        this._doc = A.merge(this._doc, remoteDoc);
        this.emit("state:changed", { doc: this._doc, source: "merge" });
      }
    } else {
      // Use TypeScript Automerge
      this._doc = A.merge(this._doc, remoteDoc);
      this.emit("state:changed", { doc: this._doc, source: "merge" });
    }
  }

  save(): Uint8Array {
    if (this._useWasm && this._wasmChronicle) {
      try {
        const binary = this._wasmChronicle.save();
        return new Uint8Array(binary);
      } catch (error) {
        console.error("❌ WASM Chronicle save failed, falling back to TypeScript:", error);
        return A.save(this._doc);
      }
    }

    return A.save(this._doc);
  }

  load(binary: Uint8Array): void {
    if (this._useWasm && this._wasmChronicle) {
      try {
        this._wasmChronicle.load(binary);

        // Use binary sync to preserve CRDT history/metadata
        const savedBinary = this._wasmChronicle.save();
        this._doc = A.load<CloutState>(new Uint8Array(savedBinary));

        this.emit("state:changed", { doc: this._doc, source: "load" });
      } catch (error) {
        console.error("❌ WASM Chronicle load failed, falling back to TypeScript:", error);
        this._doc = A.load(binary);
        this.emit("state:changed", { doc: this._doc, source: "load" });
      }
    } else {
      this._doc = A.load(binary);
      this.emit("state:changed", { doc: this._doc, source: "load" });
    }
  }

  saveToBase64(): string {
    if (this._useWasm && this._wasmChronicle) {
      try {
        // Use WASM base64 encoding
        return this._wasmChronicle.saveToBase64();
      } catch (error) {
        console.error("❌ WASM Chronicle saveToBase64 failed, falling back to TypeScript:", error);
        const bytes = this.save();
        return Buffer.from(bytes).toString('base64');
      }
    }

    const bytes = this.save();
    return Buffer.from(bytes).toString('base64');
  }

  loadFromBase64(base64: string): void {
    if (this._useWasm && this._wasmChronicle) {
      try {
        // Use WASM base64 decoding
        this._wasmChronicle.loadFromBase64(base64);

        // Use binary sync to preserve CRDT history/metadata
        const binary = this._wasmChronicle.save();
        this._doc = A.load<CloutState>(new Uint8Array(binary));

        this.emit("state:changed", { doc: this._doc, source: "load" });
      } catch (error) {
        console.error("❌ WASM Chronicle loadFromBase64 failed, falling back to TypeScript:", error);
        const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
        this.load(bytes);
      }
    } else {
      const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
      this.load(bytes);
    }
  }
}

// Export as default Chronicle replacement
export { ChronicleWasm as Chronicle };
