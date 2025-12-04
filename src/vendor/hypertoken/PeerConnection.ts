/*
 * network/PeerConnection.ts
 * Robust handling for both Node (ws) and Browser (WebSocket) environments.
 *
 * Renamed from NetworkInterface to avoid confusion with UI adapters.
 * This is network transport infrastructure for P2P engine synchronization.
 *
 * Vendored from hypertoken-monorepo for Scarcity integration.
 */
import { Emitter } from "./events.js";
import * as Ws from "ws";

// Message Types
export interface NetworkMessage {
  type: string;
  payload?: any;
  targetPeerId?: string;
  fromPeerId?: string;
}

export class PeerConnection extends Emitter {
  url: string;
  engine: any | null;
  socket: WebSocket | null;
  connected: boolean;

  peerId: string | null = null;
  peers: Set<string> = new Set();

  constructor(url: string, engine: any | null = null) {
    super();
    this.url = url;
    this.engine = engine;
    this.socket = null;
    this.connected = false;
  }

   connect(): void {
    // FIX 2: Check for Node's 'ws' constructor (Ws.WebSocket) first, otherwise fall back to browser global
    const WS = typeof Ws.WebSocket !== 'undefined' ? Ws.WebSocket : (global as any).WebSocket;

    this.socket = new WS(this.url);

    if (!this.socket) return;

// Use standard 'on' pattern if available (Node/ws), fall back to addEventListener (Browser)
    // FIX: Use type assertion to silence the TypeScript error while keeping runtime check
    if (typeof (this.socket as any).on === 'function') {
      (this.socket as any).on('open', () => this._onOpen());
      (this.socket as any).on('message', (data: any) => this._handleMessageData(data));
      (this.socket as any).on('close', () => this._onClose());
      (this.socket as any).on('error', (err: any) => this._onError(err));
    } else {
      this.socket.addEventListener("open", () => this._onOpen());
      this.socket.addEventListener("message", (ev: any) => this._handleMessageEvent(ev));
      this.socket.addEventListener("close", () => this._onClose());
      this.socket.addEventListener("error", (err: any) => this._onError(err));
    }
  }

  disconnect(): void {
    if (this.socket) this.socket.close();
  }

  sendToPeer(targetPeerId: string, payload: any): void {
    this._send({ type: "p2p", targetPeerId, payload });
  }

  broadcast(type: string, payload: any = {}): void {
    this._send({ type, payload });
  }

  private _send(msg: Partial<NetworkMessage>): void {
    if (!this.socket || this.socket.readyState !== 1) return;
    this.socket.send(JSON.stringify(msg));
  }

  // --- Event Handlers ---

  private _onOpen() {
    this.connected = true;
    this.emit("net:connected");
  }

  private _onClose() {
    this.connected = false;
    this.peers.clear();
    this.emit("net:disconnected");
  }

  private _onError(err: any) {
    this.emit("net:error", { payload: { error: err } });
  }

  // Browser-style event wrapper
  private _handleMessageEvent(ev: any) {
    this._handleMessageData(ev.data);
  }

  // Core logic handling raw data string/buffer
  private _handleMessageData(data: any) {
    try {
      const str = data.toString(); // Convert buffer to string if necessary
      const msg = JSON.parse(str);

      // DEBUG LOG: Uncomment if needed to trace raw traffic
      // if (msg.type !== 'p2p') console.log(`[Net In] ${msg.type}`);

      switch (msg.type) {
        case "welcome":
          this.peerId = msg.peerId;
          this.emit("net:ready", { peerId: this.peerId });
          break;

        case "peer:joined":
          if (msg.peerId !== this.peerId) {
            this.peers.add(msg.peerId);
            this.emit("net:peer:connected", { peerId: msg.peerId });
          }
          break;

        case "peer:left":
          this.peers.delete(msg.peerId);
          this.emit("net:peer:disconnected", { peerId: msg.peerId });
          break;

        case "p2p":
          this.emit("net:message", {
            ...msg.payload,
            fromPeerId: msg.fromPeerId
          });
          break;

        case "error":
          this.emit("net:error", msg);
          break;

        default:
          this.emit("net:message", msg);
          break;
      }
    } catch (err) {
      console.error("Network parse error", err);
    }
  }
}

// DEPRECATED: Backward compatibility alias
// TODO: Remove in next major version
export const NetworkInterface = PeerConnection;
