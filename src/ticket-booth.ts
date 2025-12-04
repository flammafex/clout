import { Crypto } from './crypto.js';
import type { KeyPair, FreebirdClient, WitnessClient, Attestation } from './types.js';

export interface CloutTicket {
  owner: string;          // User's Public Key (Hex)
  expiry: number;         // Timestamp (e.g., Now + 24 hours)
  proof: Uint8Array;      // The consumed Freebird Token
  signature: Attestation; // Witness proof that this ticket was minted now
}

export class TicketBooth {
  private freebird: FreebirdClient;
  private witness: WitnessClient;

  constructor(freebird: FreebirdClient, witness: WitnessClient) {
    this.freebird = freebird;
    this.witness = witness;
  }

  /**
   * Exchange a Freebird Token for a 24-hour Clout Ticket
   */
  async mintTicket(user: KeyPair, freebirdToken: Uint8Array): Promise<CloutTicket> {
    // 1. Verify the Sybil Token (Proof of Work / Invite / etc)
    const isValid = await this.freebird.verifyToken(freebirdToken);
    if (!isValid) {
      throw new Error("Invalid Freebird Token - Access Denied");
    }

    // 2. Define the Window (24 Hours)
    const now = Date.now();
    const expiry = now + (24 * 60 * 60 * 1000);

    // 3. Create the Ticket Payload
    const ticketPayload = {
      owner: Crypto.toHex(user.publicKey.bytes),
      expiry: expiry,
      proof: Crypto.toHex(freebirdToken)
    };

    // 4. Timestamp it with Witness (The "Notary")
    const payloadHash = Crypto.hashString(JSON.stringify(ticketPayload));
    const signature = await this.witness.timestamp(payloadHash);

    console.log(`[TicketBooth] 🎟️ Minted ticket for ${ticketPayload.owner.slice(0, 8)}`);

    return {
      owner: ticketPayload.owner,
      expiry: ticketPayload.expiry,
      proof: freebirdToken,
      signature: signature
    };
  }

  /**
   * Verify a ticket is valid and owned by the user
   */
  async verifyTicket(ticket: CloutTicket, userPublicKey: string): Promise<boolean> {
    // 1. Check Ownership
    if (ticket.owner !== userPublicKey) {
      console.warn(`[TicketBooth] Ticket theft: ${ticket.owner} !== ${userPublicKey}`);
      return false;
    }

    // 2. Check Expiry
    if (Date.now() > ticket.expiry) {
      console.warn(`[TicketBooth] Ticket expired at ${new Date(ticket.expiry).toISOString()}`);
      return false;
    }

    // 3. Verify Witness Signature
    const isValidSignature = await this.witness.verify(ticket.signature);
    if (!isValidSignature) {
      console.warn(`[TicketBooth] Invalid Witness signature on ticket`);
      return false;
    }

    return true;
  }
}