export type MemoryType = "fact" | "preference" | "event";

export interface MemoryItem {
  id: string;
  type: MemoryType;
  content: string;
  timestamp: number;
}