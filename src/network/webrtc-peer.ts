/**
 * WebRTC Peer implementation for Clout
 *
 * Wraps HyperToken's WebRTC connection to implement NetworkPeer interface.
 */

import type { NetworkPeer, PeerMetadata, ContentGossipMessage } from '../network-types.js';
import { PeerState } from '../network-types.js';

export interface WebRTCPeerConfig {
  readonly publicKey: string;
  readonly metadata: PeerMetadata;
  readonly iceServers?: RTCIceServer[];
  readonly onMessage?: (message: ContentGossipMessage) => void;
  readonly onStateChange?: (state: PeerState) => void;
}

/**
 * WebRTC peer connection implementing NetworkPeer
 *
 * TODO: Integrate with HyperToken's WebRTCConnection from vendor/hypertoken/
 */
export class WebRTCPeer implements NetworkPeer {
  readonly id: string;
  readonly publicKey: string;
  readonly metadata: PeerMetadata;

  private connection?: RTCPeerConnection;
  private dataChannel?: RTCDataChannel;
  private messageHandler?: (message: ContentGossipMessage) => void;
  private state: PeerState = PeerState.DISCONNECTED;

  constructor(config: WebRTCPeerConfig) {
    this.id = config.publicKey;
    this.publicKey = config.publicKey;
    this.metadata = config.metadata;
    this.messageHandler = config.onMessage;
  }

  /**
   * Initiate connection as offerer
   */
  async connect(iceServers?: RTCIceServer[]): Promise<RTCSessionDescriptionInit> {
    this.state = PeerState.CONNECTING;

    // Create peer connection
    this.connection = new RTCPeerConnection({
      iceServers: iceServers || [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    });

    // Create data channel
    this.dataChannel = this.connection.createDataChannel('clout', {
      ordered: true
    });

    this.setupDataChannel(this.dataChannel);
    this.setupConnectionHandlers();

    // Create offer
    const offer = await this.connection.createOffer();
    await this.connection.setLocalDescription(offer);

    return offer;
  }

  /**
   * Accept connection as answerer
   */
  async acceptOffer(
    offer: RTCSessionDescriptionInit,
    iceServers?: RTCIceServer[]
  ): Promise<RTCSessionDescriptionInit> {
    this.state = PeerState.CONNECTING;

    // Create peer connection
    this.connection = new RTCPeerConnection({
      iceServers: iceServers || [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    });

    this.setupConnectionHandlers();

    // Handle incoming data channel
    this.connection.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.setupDataChannel(this.dataChannel);
    };

    // Set remote description (offer)
    await this.connection.setRemoteDescription(offer);

    // Create answer
    const answer = await this.connection.createAnswer();
    await this.connection.setLocalDescription(answer);

    return answer;
  }

  /**
   * Complete connection with remote answer
   */
  async completeConnection(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.connection) {
      throw new Error('Connection not initialized');
    }

    await this.connection.setRemoteDescription(answer);
  }

  /**
   * Add ICE candidate
   */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.connection) {
      throw new Error('Connection not initialized');
    }

    await this.connection.addIceCandidate(candidate);
  }

  /**
   * Setup connection event handlers
   */
  private setupConnectionHandlers(): void {
    if (!this.connection) return;

    this.connection.oniceconnectionstatechange = () => {
      const iceState = this.connection?.iceConnectionState;
      console.log(`[WebRTCPeer] ICE state: ${iceState}`);

      if (iceState === 'connected' || iceState === 'completed') {
        this.state = PeerState.CONNECTED;
        this.updateMetrics();
      } else if (iceState === 'failed' || iceState === 'disconnected') {
        this.state = PeerState.FAILED;
      }
    };

    this.connection.onicecandidate = (event) => {
      // ICE candidates would be sent via relay for signaling
      // For now, just log
      if (event.candidate) {
        console.log(`[WebRTCPeer] ICE candidate: ${event.candidate.candidate.slice(0, 50)}...`);
      }
    };
  }

  /**
   * Setup data channel handlers
   */
  private setupDataChannel(channel: RTCDataChannel): void {
    channel.onopen = () => {
      console.log(`[WebRTCPeer] Data channel opened to ${this.publicKey.slice(0, 8)}`);
      this.state = PeerState.CONNECTED;
    };

    channel.onclose = () => {
      console.log(`[WebRTCPeer] Data channel closed to ${this.publicKey.slice(0, 8)}`);
      this.state = PeerState.DISCONNECTED;
    };

    channel.onerror = (error) => {
      console.warn(`[WebRTCPeer] Data channel error:`, error);
      this.state = PeerState.FAILED;
    };

    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ContentGossipMessage;
        this.updateMetrics();

        if (this.messageHandler) {
          this.messageHandler(message);
        }
      } catch (error) {
        console.warn('[WebRTCPeer] Invalid message:', error);
      }
    };
  }

  /**
   * Send message to peer
   */
  async send(message: ContentGossipMessage): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error(`Peer ${this.publicKey.slice(0, 8)} not connected`);
    }

    const data = JSON.stringify(message);
    this.dataChannel.send(data);
    this.updateMetrics();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === PeerState.CONNECTED &&
           this.dataChannel?.readyState === 'open';
  }

  /**
   * Set message handler
   */
  setMessageHandler(handler: (message: ContentGossipMessage) => void): void {
    this.messageHandler = handler;
  }

  /**
   * Disconnect from peer
   */
  disconnect(): void {
    if (this.dataChannel) {
      this.dataChannel.close();
    }

    if (this.connection) {
      this.connection.close();
    }

    this.state = PeerState.DISCONNECTED;
    console.log(`[WebRTCPeer] Disconnected from ${this.publicKey.slice(0, 8)}`);
  }

  /**
   * Update connection metrics
   */
  private updateMetrics(): void {
    if (!this.metadata.metrics) {
      (this.metadata as any).metrics = {
        latency: 0,
        messagesSent: 0,
        messagesReceived: 0,
        bytesTransferred: 0
      };
    }

    // Update metrics (simplified)
    this.metadata.metrics!.messagesSent++;
    this.metadata.lastSeen = Date.now();
  }

  /**
   * Get connection state
   */
  getState(): PeerState {
    return this.state;
  }
}
