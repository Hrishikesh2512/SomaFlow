import fs from "fs";
import { randomUUID } from "crypto";
import { type MemoryItem, type MemoryType } from "./memory";

const FILE = "./memory.json";

export class MemoryStore {
  private memory: MemoryItem[] = [];

  constructor() {
    if (fs.existsSync(FILE)) {
      try {
        this.memory = JSON.parse(fs.readFileSync(FILE, "utf-8"));
      } catch (e) {
        this.memory = [];
      }
    }
  }

  private save() {
    fs.writeFileSync(FILE, JSON.stringify(this.memory, null, 2));
  }

  add(content: string, type: MemoryType = "fact"): MemoryItem {
    const item: MemoryItem = {
      id: randomUUID(),
      type,
      content,
      timestamp: Date.now(),
    };
    this.memory.push(item);
    this.save();
    return item;
  }

  remove(id: string): boolean {
    const initialLength = this.memory.length;
    this.memory = this.memory.filter(m => m.id !== id);
    if (this.memory.length !== initialLength) {
      this.save();
      return true;
    }
    return false;
  }

  search(query: string): MemoryItem[] {
    const lowerQuery = query.toLowerCase();
    return this.memory.filter(m => m.content.toLowerCase().includes(lowerQuery));
  }

  getAll(): MemoryItem[] {
    return this.memory;
  }
}