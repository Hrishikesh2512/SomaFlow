import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildIndex, type RepoIndex, type RepoFileEntry } from "./indexer";

const CACHE_DIR = path.join(os.homedir(), ".somaflow");
const CACHE_FILE = path.join(CACHE_DIR, "repomap.json");

class RepoMapStore {
  private index: RepoIndex | null = null;
  private workspacePath: string | null = null;

  /** Build or rebuild the index for a given workspace */
  async refresh(rootPath: string): Promise<void> {
    this.workspacePath = rootPath;
    this.index = buildIndex(rootPath);
    this.persist();
  }

  /** Lazy-load: try cache first */
  getIndex(): RepoIndex | null {
    if (this.index) return this.index;
    // Try loading from disk cache
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as RepoIndex;
        this.index = { ...raw, builtAt: new Date(raw.builtAt) };
      }
    } catch {
      // ignore
    }
    return this.index;
  }

  getFiles(): RepoFileEntry[] {
    return this.getIndex()?.files ?? [];
  }

  /** Find files/symbols matching a query string */
  query(q: string): RepoFileEntry[] {
    const lower = q.toLowerCase();
    const files = this.getFiles();
    return files.filter(
      (f) =>
        f.path.toLowerCase().includes(lower) ||
        f.symbols.some((s) => s.name.toLowerCase().includes(lower))
    );
  }

  private persist() {
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(this.index, null, 2), "utf8");
    } catch {
      // non-fatal
    }
  }
}

export const repoMapStore = new RepoMapStore();
