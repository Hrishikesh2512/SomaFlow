import fs from "node:fs";
import path from "node:path";
import os from "node:os";

interface CacheEntry {
  url: string;
  markdown: string;
  fetchedAt: string; // ISO string
  title?: string;
}

const CACHE_DIR = path.join(os.homedir(), ".somaflow", "doc-cache");
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

class DocCache {
  private mem = new Map<string, CacheEntry>();

  private keyFor(url: string): string {
    return url.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 120) + ".json";
  }

  get(url: string): CacheEntry | null {
    // Check memory first
    if (this.mem.has(url)) {
      const entry = this.mem.get(url)!;
      if (Date.now() - new Date(entry.fetchedAt).getTime() < MAX_AGE_MS) return entry;
    }
    // Check disk
    const filePath = path.join(CACHE_DIR, this.keyFor(url));
    try {
      if (fs.existsSync(filePath)) {
        const entry = JSON.parse(fs.readFileSync(filePath, "utf8")) as CacheEntry;
        if (Date.now() - new Date(entry.fetchedAt).getTime() < MAX_AGE_MS) {
          this.mem.set(url, entry);
          return entry;
        }
      }
    } catch {
      // corrupt cache entry — ignore
    }
    return null;
  }

  set(url: string, markdown: string, title?: string): void {
    const entry: CacheEntry = { url, markdown, fetchedAt: new Date().toISOString(), title };
    this.mem.set(url, entry);
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const filePath = path.join(CACHE_DIR, this.keyFor(url));
      fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), "utf8");
    } catch {
      // non-fatal
    }
  }

  stats(): string {
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const files = fs.readdirSync(CACHE_DIR);
      return `${files.length} cached documents in ${CACHE_DIR}`;
    } catch {
      return "Cache unavailable";
    }
  }
}

export const docCache = new DocCache();
