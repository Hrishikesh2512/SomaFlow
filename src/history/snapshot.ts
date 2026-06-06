import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

export interface Snapshot {
  id: string;
  timestamp: Date;
  /** relative path in the workspace */
  filePath: string;
  /** content before the change (undefined = file didn't exist) */
  before: string | undefined;
  /** content after the change (undefined = file was deleted) */
  after: string | undefined;
  /** human-readable description of what Arthur did */
  description: string;
}

const HISTORY_DIR = path.join(os.homedir(), ".somaflow", "history");
const HISTORY_FILE = path.join(HISTORY_DIR, "snapshots.json");

class SnapshotStore {
  private snapshots: Snapshot[] = [];
  private loaded = false;

  private load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) as Snapshot[];
        this.snapshots = raw.map((s) => ({ ...s, timestamp: new Date(s.timestamp) }));
      }
    } catch {
      this.snapshots = [];
    }
  }

  private persist() {
    try {
      fs.mkdirSync(HISTORY_DIR, { recursive: true });
      // Keep only the last 100 snapshots on disk
      const toSave = this.snapshots.slice(-100);
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(toSave, null, 2), "utf8");
    } catch {
      // Non-fatal — history is still in-memory
    }
  }

  take(
    filePath: string,
    before: string | undefined,
    after: string | undefined,
    description: string,
  ): Snapshot {
    this.load();
    const snap: Snapshot = {
      id: randomUUID(),
      timestamp: new Date(),
      filePath,
      before,
      after,
      description,
    };
    this.snapshots.push(snap);
    this.persist();
    return snap;
  }

  getAll(): Snapshot[] {
    this.load();
    return [...this.snapshots];
  }

  getLast(n = 10): Snapshot[] {
    this.load();
    return this.snapshots.slice(-n).reverse();
  }

  getById(id: string): Snapshot | undefined {
    this.load();
    return this.snapshots.find((s) => s.id === id);
  }

  /** Returns the most recent snapshot where the file was changed */
  getLastForFile(filePath: string): Snapshot | undefined {
    this.load();
    const matches = this.snapshots.filter((s) => s.filePath === filePath);
    return matches.at(-1);
  }

  /** Returns the last N unique-file snapshots */
  popLast(): Snapshot | undefined {
    this.load();
    const snap = this.snapshots.pop();
    if (snap) this.persist();
    return snap;
  }

  clear() {
    this.snapshots = [];
    this.persist();
  }
}

// Singleton
export const snapshotStore = new SnapshotStore();
