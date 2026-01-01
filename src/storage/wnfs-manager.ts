/**
 * StorageManager - WNFS-based media storage for Clout
 *
 * Implements the "Offload-and-Link" pattern:
 * - Heavy file data resides in a local WNFS blockstore
 * - Posts only contain lightweight CID references
 *
 * Uses content-addressed storage: file CID changes if content changes.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { sha256 as multiformatsSha256 } from 'multiformats/hashes/sha2';

/**
 * Get Clout data directory from environment or default
 */
function getCloutDataDir(): string {
  return process.env.CLOUT_DATA_DIR || join(homedir(), '.clout');
}

/**
 * Media metadata stored alongside the CID reference in posts
 */
export interface MediaMetadata {
  /** Content Identifier - content-addressed hash */
  readonly cid: string;
  /** MIME type (e.g., 'image/png', 'video/mp4') */
  readonly mimeType: string;
  /** Original filename (optional) */
  readonly filename?: string;
  /** File size in bytes */
  readonly size: number;
  /** Timestamp when media was stored */
  readonly storedAt: number;
}

/**
 * Block storage interface for WNFS-style content-addressed storage
 */
export interface BlockStore {
  /** Store a block and return its CID */
  put(data: Uint8Array): Promise<string>;
  /** Retrieve a block by CID */
  get(cid: string): Promise<Uint8Array | null>;
  /** Check if a block exists */
  has(cid: string): Promise<boolean>;
  /** Delete a block */
  delete(cid: string): Promise<void>;
  /** List all CIDs in the store */
  list(): Promise<string[]>;
}

/**
 * File-based block storage implementation
 * Each block is stored as a separate file named by its CID
 */
export class FileBlockStore implements BlockStore {
  private readonly blocksDir: string;
  private readonly metadataPath: string;
  private metadata: Map<string, { storedAt: number; size: number }>;

  constructor(customPath?: string) {
    const baseDir = customPath || join(getCloutDataDir(), 'wnfs');
    this.blocksDir = join(baseDir, 'blocks');
    this.metadataPath = join(baseDir, 'block-metadata.json');
    this.metadata = new Map();
  }

  /**
   * Initialize the block store
   */
  async init(): Promise<void> {
    // Ensure directories exist
    if (!existsSync(this.blocksDir)) {
      mkdirSync(this.blocksDir, { recursive: true });
    }

    // Load metadata
    if (existsSync(this.metadataPath)) {
      try {
        const raw = readFileSync(this.metadataPath, 'utf-8');
        const data = JSON.parse(raw);
        this.metadata = new Map(Object.entries(data));
      } catch (e) {
        console.warn('[FileBlockStore] Failed to load metadata, starting fresh');
        this.metadata = new Map();
      }
    }
  }

  /**
   * Store a block and return its CID (content-addressed)
   */
  async put(data: Uint8Array): Promise<string> {
    // Generate CID using multiformats (IPFS-compatible)
    const hash = await multiformatsSha256.digest(data);
    const cid = CID.create(1, raw.code, hash);
    const cidString = cid.toString();

    // Store block
    const blockPath = join(this.blocksDir, cidString);
    writeFileSync(blockPath, data);

    // Update metadata
    this.metadata.set(cidString, {
      storedAt: Date.now(),
      size: data.length
    });
    this.saveMetadata();

    return cidString;
  }

  /**
   * Retrieve a block by CID
   */
  async get(cid: string): Promise<Uint8Array | null> {
    const blockPath = join(this.blocksDir, cid);

    if (!existsSync(blockPath)) {
      return null;
    }

    try {
      const data = readFileSync(blockPath);
      return new Uint8Array(data);
    } catch (e) {
      console.error(`[FileBlockStore] Failed to read block ${cid}:`, e);
      return null;
    }
  }

  /**
   * Check if a block exists
   */
  async has(cid: string): Promise<boolean> {
    const blockPath = join(this.blocksDir, cid);
    return existsSync(blockPath);
  }

  /**
   * Delete a block
   */
  async delete(cid: string): Promise<void> {
    const blockPath = join(this.blocksDir, cid);

    if (existsSync(blockPath)) {
      unlinkSync(blockPath);
      this.metadata.delete(cid);
      this.saveMetadata();
    }
  }

  /**
   * List all CIDs in the store
   */
  async list(): Promise<string[]> {
    if (!existsSync(this.blocksDir)) {
      return [];
    }

    return readdirSync(this.blocksDir);
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{ blockCount: number; totalSize: number }> {
    let totalSize = 0;
    for (const meta of this.metadata.values()) {
      totalSize += meta.size;
    }
    return {
      blockCount: this.metadata.size,
      totalSize
    };
  }

  private saveMetadata(): void {
    const data: Record<string, { storedAt: number; size: number }> = {};
    for (const [cid, meta] of this.metadata.entries()) {
      data[cid] = meta;
    }
    writeFileSync(this.metadataPath, JSON.stringify(data, null, 2), 'utf-8');
  }
}

/**
 * Storage configuration options
 */
export interface StorageManagerConfig {
  /** Custom path for block storage (default: ~/.clout/wnfs) */
  storagePath?: string;
  /** Maximum file size in bytes (default: 100MB) */
  maxFileSize?: number;
  /** Allowed MIME types (default: images and videos) */
  allowedMimeTypes?: string[];
}

/**
 * Default allowed MIME types for media
 */
const DEFAULT_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'video/mp4',
  'video/webm',
  'video/ogg',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'application/pdf'
];

/**
 * Default max file size: 100MB
 */
const DEFAULT_MAX_FILE_SIZE = 100 * 1024 * 1024;

/**
 * StorageManager - High-level API for WNFS-based media storage
 *
 * Provides the "Offload-and-Link" pattern:
 * 1. Offload: Store media files in content-addressed blockstore
 * 2. Address: Get immutable CID that changes if content changes
 * 3. Link: Return CID for embedding in lightweight post metadata
 * 4. Retrieve: Fetch file content by CID
 */
export class StorageManager {
  private readonly blockStore: FileBlockStore;
  private readonly maxFileSize: number;
  private readonly allowedMimeTypes: Set<string>;
  private readonly mediaIndexPath: string;
  private mediaIndex: Map<string, MediaMetadata>;
  private initialized: boolean = false;

  constructor(config: StorageManagerConfig = {}) {
    const baseDir = config.storagePath || join(getCloutDataDir(), 'wnfs');
    this.blockStore = new FileBlockStore(baseDir);
    this.maxFileSize = config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    this.allowedMimeTypes = new Set(config.allowedMimeTypes ?? DEFAULT_ALLOWED_MIME_TYPES);
    this.mediaIndexPath = join(baseDir, 'media-index.json');
    this.mediaIndex = new Map();
  }

  /**
   * Initialize the storage manager
   * Must be called before using any other methods
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    await this.blockStore.init();

    // Load media index
    if (existsSync(this.mediaIndexPath)) {
      try {
        const raw = readFileSync(this.mediaIndexPath, 'utf-8');
        const data = JSON.parse(raw);
        this.mediaIndex = new Map(Object.entries(data));
      } catch (e) {
        console.warn('[StorageManager] Failed to load media index, starting fresh');
        this.mediaIndex = new Map();
      }
    }

    this.initialized = true;
    console.log('[StorageManager] Initialized WNFS media storage');
  }

  /**
   * Store a media file and return its metadata with CID
   *
   * @param data - File data as Uint8Array or Buffer
   * @param mimeType - MIME type of the file
   * @param filename - Optional original filename
   * @returns MediaMetadata containing the CID
   */
  async store(
    data: Uint8Array | Buffer,
    mimeType: string,
    filename?: string
  ): Promise<MediaMetadata> {
    this.ensureInitialized();

    // Convert Buffer to Uint8Array if needed
    const fileData = data instanceof Buffer ? new Uint8Array(data) : data;

    // Validate file size
    if (fileData.length > this.maxFileSize) {
      throw new Error(
        `File size (${fileData.length} bytes) exceeds maximum allowed (${this.maxFileSize} bytes)`
      );
    }

    // Validate MIME type
    if (!this.allowedMimeTypes.has(mimeType)) {
      throw new Error(
        `MIME type '${mimeType}' is not allowed. Allowed types: ${Array.from(this.allowedMimeTypes).join(', ')}`
      );
    }

    // Store in blockstore - returns content-addressed CID
    const cid = await this.blockStore.put(fileData);

    // Create metadata
    const metadata: MediaMetadata = {
      cid,
      mimeType,
      filename,
      size: fileData.length,
      storedAt: Date.now()
    };

    // Index the media
    this.mediaIndex.set(cid, metadata);
    this.saveMediaIndex();

    console.log(`[StorageManager] Stored media: ${cid.slice(0, 12)}... (${mimeType}, ${fileData.length} bytes)`);

    return metadata;
  }

  /**
   * Store media from a file path
   *
   * @param filePath - Path to the file
   * @param mimeType - MIME type of the file
   * @returns MediaMetadata containing the CID
   */
  async storeFromPath(filePath: string, mimeType: string): Promise<MediaMetadata> {
    const data = readFileSync(filePath);
    const filename = filePath.split('/').pop();
    return this.store(new Uint8Array(data), mimeType, filename);
  }

  /**
   * Retrieve media content by CID
   *
   * @param cid - Content Identifier
   * @returns File data or null if not found
   */
  async retrieve(cid: string): Promise<Uint8Array | null> {
    this.ensureInitialized();
    return this.blockStore.get(cid);
  }

  /**
   * Get metadata for a stored media file
   *
   * @param cid - Content Identifier
   * @returns MediaMetadata or null if not found
   */
  getMetadata(cid: string): MediaMetadata | null {
    this.ensureInitialized();
    return this.mediaIndex.get(cid) || null;
  }

  /**
   * Check if media exists by CID
   *
   * @param cid - Content Identifier
   * @returns true if media exists
   */
  async has(cid: string): Promise<boolean> {
    this.ensureInitialized();
    return this.blockStore.has(cid);
  }

  /**
   * Delete media by CID
   *
   * @param cid - Content Identifier
   */
  async delete(cid: string): Promise<void> {
    this.ensureInitialized();
    await this.blockStore.delete(cid);
    this.mediaIndex.delete(cid);
    this.saveMediaIndex();
    console.log(`[StorageManager] Deleted media: ${cid.slice(0, 12)}...`);
  }

  /**
   * List all stored media CIDs
   *
   * @returns Array of CIDs
   */
  async list(): Promise<string[]> {
    this.ensureInitialized();
    return this.blockStore.list();
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{
    mediaCount: number;
    totalSize: number;
    byMimeType: Record<string, { count: number; size: number }>;
  }> {
    this.ensureInitialized();

    const byMimeType: Record<string, { count: number; size: number }> = {};
    let totalSize = 0;

    for (const meta of this.mediaIndex.values()) {
      totalSize += meta.size;

      if (!byMimeType[meta.mimeType]) {
        byMimeType[meta.mimeType] = { count: 0, size: 0 };
      }
      byMimeType[meta.mimeType].count++;
      byMimeType[meta.mimeType].size += meta.size;
    }

    return {
      mediaCount: this.mediaIndex.size,
      totalSize,
      byMimeType
    };
  }

  /**
   * Format a CID for embedding in post content
   * Uses the format: [clout-media: <CID>]
   *
   * @param cid - Content Identifier
   * @returns Formatted media link string
   */
  static formatMediaLink(cid: string): string {
    return `[clout-media: ${cid}]`;
  }

  /**
   * Extract CID from a formatted media link
   *
   * @param content - Post content potentially containing media link
   * @returns CID or null if no media link found
   */
  static extractMediaCid(content: string): string | null {
    const match = content.match(/\[clout-media:\s*([^\]]+)\]/);
    return match ? match[1].trim() : null;
  }

  /**
   * Check if content contains a media link
   *
   * @param content - Post content to check
   * @returns true if content contains media link
   */
  static hasMediaLink(content: string): boolean {
    return /\[clout-media:\s*[^\]]+\]/.test(content);
  }

  /**
   * Detect MIME type from file extension
   *
   * @param filename - Filename with extension
   * @returns MIME type or 'application/octet-stream' if unknown
   */
  static detectMimeType(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop();

    const mimeTypes: Record<string, string> = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'svg': 'image/svg+xml',
      'mp4': 'video/mp4',
      'webm': 'video/webm',
      'ogg': 'video/ogg',
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'pdf': 'application/pdf'
    };

    return mimeTypes[ext || ''] || 'application/octet-stream';
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('StorageManager not initialized. Call init() first.');
    }
  }

  private saveMediaIndex(): void {
    const data: Record<string, MediaMetadata> = {};
    for (const [cid, meta] of this.mediaIndex.entries()) {
      data[cid] = meta;
    }

    // Ensure directory exists
    const dir = this.mediaIndexPath.split('/').slice(0, -1).join('/');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(this.mediaIndexPath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
