import { Crypto } from './crypto.js';

export interface PostSignatureFields {
  readonly content: string;
  readonly author: string;
  readonly timestamp: number;
  readonly replyTo?: unknown;
  readonly mediaCid?: unknown;
  readonly link?: unknown;
  readonly nsfw?: unknown;
  readonly contentWarning?: unknown;
}

export function buildPostSignaturePayload(data: PostSignatureFields): Record<string, unknown> {
  return {
    content: data.content,
    author: data.author,
    timestamp: data.timestamp,
    replyTo: typeof data.replyTo === 'string' ? data.replyTo : null,
    mediaCid: typeof data.mediaCid === 'string' ? data.mediaCid : null,
    link: data.link ?? null,
    nsfw: data.nsfw === true,
    contentWarning: typeof data.contentWarning === 'string' ? data.contentWarning : null
  };
}

export function buildPostSignatureMessage(data: PostSignatureFields): string {
  return `CLOUT_POST_V2:${Crypto.hashObject(buildPostSignaturePayload(data))}`;
}

export interface PostAttestationFields {
  readonly id: string;
  readonly content: string;
  readonly author: string;
  readonly signature: Uint8Array;
  readonly signatureTimestamp?: number;
  readonly replyTo?: string;
  readonly contentType?: string;
  readonly ephemeralPublicKey?: Uint8Array;
  readonly ephemeralKeyProof?: Uint8Array;
  readonly media?: { cid: string } | null;
  readonly link?: unknown;
  readonly nsfw?: boolean;
  readonly contentWarning?: string;
  readonly mentions?: string[];
  readonly editOf?: string;
  readonly authorDisplayName?: string;
  readonly authorAvatar?: string;
  readonly authorshipProof?: Uint8Array;
}

export function buildPostAttestationPayload(data: PostAttestationFields): Record<string, unknown> {
  return {
    id: data.id,
    content: data.content,
    author: data.author,
    signature: Crypto.toHex(data.signature),
    signatureTimestamp: typeof data.signatureTimestamp === 'number' ? data.signatureTimestamp : null,
    replyTo: data.replyTo ?? null,
    contentType: data.contentType ?? null,
    ephemeralPublicKey: data.ephemeralPublicKey ? Crypto.toHex(data.ephemeralPublicKey) : null,
    ephemeralKeyProof: data.ephemeralKeyProof ? Crypto.toHex(data.ephemeralKeyProof) : null,
    mediaCid: data.media?.cid ?? null,
    link: data.link ?? null,
    nsfw: data.nsfw === true,
    contentWarning: data.contentWarning ?? null,
    mentions: data.mentions ?? null,
    editOf: data.editOf ?? null,
    authorDisplayName: data.authorDisplayName ?? null,
    authorAvatar: data.authorAvatar ?? null,
    authorshipProof: data.authorshipProof ? Crypto.toHex(data.authorshipProof) : null
  };
}

export function hashPostAttestationPayload(data: PostAttestationFields): string {
  return Crypto.hashObject(buildPostAttestationPayload(data));
}
