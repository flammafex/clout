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

import * as A from "@automerge/automerge";
import { Emitter } from "./events.js";
import { CloutState } from "../../clout-types.js";
import { Buffer } from "node:buffer";

/**
 * Chronicle: TypeScript Automerge-backed CRDT implementation.
 *
 * Stores the entire CloutState within an Automerge document,
 * maintaining all conflict-free merge semantics.
 */
export class ChronicleWasm extends Emitter {
  private _doc: A.Doc<CloutState>;

  constructor(initialState?: CloutState) {
    super();
    this._doc = initialState ? A.from<CloutState>(initialState) : A.init<CloutState>();
  }

  get state(): A.Doc<CloutState> {
    return this._doc;
  }

  change(message: string, callback: (doc: CloutState) => void, source: string = "local"): void {
    const newDoc = A.change(this._doc, message, callback);
    this._doc = newDoc;
    this.emit("state:changed", { doc: newDoc, source });
  }

  update(newDoc: A.Doc<CloutState>, source: string = "local"): void {
    this._doc = newDoc;
    this.emit("state:changed", { doc: this._doc, source });
  }

  merge(remoteDoc: A.Doc<CloutState>): void {
    this._doc = A.merge(this._doc, remoteDoc);
    this.emit("state:changed", { doc: this._doc, source: "merge" });
  }

  save(): Uint8Array {
    return A.save(this._doc);
  }

  load(binary: Uint8Array): void {
    this._doc = A.load<CloutState>(binary);
    this.emit("state:changed", { doc: this._doc, source: "load" });
  }

  saveToBase64(): string {
    const bytes = this.save();
    return Buffer.from(bytes).toString('base64');
  }

  loadFromBase64(base64: string): void {
    const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
    this.load(bytes);
  }
}

// Export as default Chronicle replacement
export { ChronicleWasm as Chronicle };
