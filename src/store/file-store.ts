import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { CloutStore, PostPackage, SlidePackage } from '../clout-types.js';

interface LocalData {
  version: string;
  posts: { [id: string]: PostPackage };
  slides: { [id: string]: SlidePackage };
}

export class FileSystemStore implements CloutStore {
  private path: string;
  private data: LocalData;

  constructor(customPath?: string) {
    this.path = customPath || join(homedir(), '.clout', 'local-data.json');
    this.data = { version: '1.0', posts: {}, slides: {} };
  }

  async init(): Promise<void> {
    this.ensureDir();
    this.load();
  }

  private ensureDir(): void {
    const dir = join(homedir(), '.clout');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private load(): void {
    if (!existsSync(this.path)) {
      return;
    }
    try {
      const raw = readFileSync(this.path, 'utf-8');
      this.data = JSON.parse(raw);
    } catch (e) {
      console.warn('Failed to load local store, starting fresh');
    }
  }

  private save(): void {
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  async addPost(post: PostPackage): Promise<void> {
    if (!this.data.posts[post.id]) {
      this.data.posts[post.id] = post;
      this.save();
    }
  }

  async getFeed(): Promise<PostPackage[]> {
    return Object.values(this.data.posts)
      .sort((a, b) => b.proof.timestamp - a.proof.timestamp);
  }

  async addSlide(slide: SlidePackage): Promise<void> {
    if (!this.data.slides[slide.id]) {
      this.data.slides[slide.id] = slide;
      this.save();
    }
  }

  async getInbox(): Promise<SlidePackage[]> {
    return Object.values(this.data.slides)
      .sort((a, b) => b.proof.timestamp - a.proof.timestamp);
  }
}