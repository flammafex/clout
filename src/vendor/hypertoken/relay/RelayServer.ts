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
 *
 * Vendored from hypertoken for Clout P2P relay.
 */

/*
 * relay/RelayServer.ts
 * WebSocket relay server for P2P signaling
 *
 * This is a standalone relay server that only handles:
 * - Peer discovery (welcome, peer:joined, peer:left)
 * - Message routing between peers
 * - WebRTC signaling (offer/answer/ICE candidates)
 *
 * No game engine or state management required.
 */

import { Emitter } from "../events.js";
import { WebSocketServer, WebSocket } from "ws";

export interface RelayServerOptions {
  port?: number;
  verbose?: boolean;
}

export class RelayServer extends Emitter {
  port: number;
  verbose: boolean;
  clients: Map<WebSocket, string>;
  wss: WebSocketServer | null = null;

  constructor({ port = 8080, verbose = false }: RelayServerOptions = {}) {
    super();
    this.port = port;
    this.verbose = verbose;
    this.clients = new Map();
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: this.port });
      console.log(`🌐 RelayServer running on ws://0.0.0.0:${this.port}`);

      this.wss.on("listening", () => resolve());

      this.wss.on("connection", (ws: WebSocket) => {
        const peerId = `peer-${Math.random().toString(36).substring(2, 9)}`;
        this.clients.set(ws, peerId);

        if (this.verbose) {
          console.log(`[Relay] Client connected: ${peerId} (${this.clients.size} total)`);
        }

        this._send(ws, { type: "welcome", peerId });
        this._broadcast({ type: "peer:joined", peerId }, ws);

        // Send list of existing peers
        for (const existingId of this.clients.values()) {
          if (existingId !== peerId) {
            this._send(ws, { type: "peer:joined", peerId: existingId });
          }
        }

        ws.on("message", (data: any) => this._handle(ws, peerId, data));

        ws.on("close", () => {
          this.clients.delete(ws);
          this._broadcast({ type: "peer:left", peerId });
          if (this.verbose) {
            console.log(`[Relay] Client disconnected: ${peerId} (${this.clients.size} remaining)`);
          }
        });

        ws.on("error", (err) => {
          console.error(`[Relay] WebSocket error for ${peerId}:`, err.message);
        });
      });

      this.wss.on("error", (err) => {
        console.error("[Relay] Server error:", err);
      });
    });
  }

  stop(): void {
    console.log("[Relay] Shutting down...");
    if (this.wss) {
      for (const [client] of this.clients) {
        client.close();
      }
      this.wss.close();
    }
    this.clients.clear();
  }

  private _send(ws: WebSocket, msg: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private _broadcast(msg: any, excludeWs?: WebSocket): void {
    const str = JSON.stringify(msg);
    for (const [client] of this.clients) {
      if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
        client.send(str);
      }
    }
  }

  private _handle(ws: WebSocket, fromPeerId: string, rawData: any): void {
    try {
      const msg = JSON.parse(rawData.toString());

      // Handle WebRTC signaling messages
      if (this._isWebRTCSignaling(msg)) {
        this._routeWebRTCSignaling(ws, fromPeerId, msg);
        return;
      }

      // Route to specific peer or broadcast
      if (msg.targetPeerId) {
        for (const [client, id] of this.clients) {
          if (id === msg.targetPeerId) {
            this._send(client, { ...msg, fromPeerId });
            return;
          }
        }
        if (this.verbose) {
          console.warn(`[Relay] Target peer ${msg.targetPeerId} not found`);
        }
      } else {
        this._broadcast({ ...msg, fromPeerId }, ws);
      }
    } catch (err: any) {
      console.error("[Relay] Message handling error:", err.message);
    }
  }

  private _isWebRTCSignaling(msg: any): boolean {
    return msg.payload && [
      'webrtc-offer',
      'webrtc-answer',
      'webrtc-ice-candidate'
    ].includes(msg.payload.type);
  }

  private _routeWebRTCSignaling(ws: WebSocket, fromPeerId: string, msg: any): void {
    const targetPeerId = msg.targetPeerId;
    const signalType = msg.payload.type;

    if (!targetPeerId) {
      if (this.verbose) {
        console.warn(`[Relay] WebRTC signaling missing targetPeerId`);
      }
      return;
    }

    if (this.verbose) {
      console.log(`[Relay] Routing WebRTC ${signalType}: ${fromPeerId} -> ${targetPeerId}`);
    }

    for (const [client, id] of this.clients) {
      if (id === targetPeerId) {
        this._send(client, { ...msg, fromPeerId });
        return;
      }
    }

    if (this.verbose) {
      console.warn(`[Relay] WebRTC target peer ${targetPeerId} not found`);
    }
  }

  getStats(): { clients: number; peerIds: string[] } {
    return {
      clients: this.clients.size,
      peerIds: Array.from(this.clients.values())
    };
  }
}
