interface CloutTicket {
  owner: string;          // User's Public Key
  expiry: number;         // Timestamp (e.g., Now + 24 hours)
  proof: Uint8Array;      // Freebird Token (consumed to create this)
  signature: Uint8Array;  // Witness signature proving WHEN it was minted
}