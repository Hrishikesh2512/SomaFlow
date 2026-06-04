import { tool } from "ai";
import { z } from "zod";
import type { MemoryStore } from "./store";

export function createMemoryTools(memory: MemoryStore) {
  return {
    add_memory: tool({
      description: "Remember a fact, preference, or event so it can be recalled later in this codebase.",
      inputSchema: z.object({
        content: z.string().describe("The information to remember"),
        type: z.enum(["fact", "preference", "event"]).optional().default("fact"),
      }),
      execute: async ({ content, type }) => {
        const item = memory.add(content, type);
        return `Added memory [ID: ${item.id}]`;
      },
    }),

    search_memory: tool({
      description: "Search for previously stored memories.",
      inputSchema: z.object({
        query: z.string().describe("Text to search for in memories"),
      }),
      execute: async ({ query }) => {
        const results = memory.search(query);
        if (results.length === 0) return "No matching memories found.";
        return results.map(r => `[${r.type}] ${r.content} (ID: ${r.id})`).join("\n");
      },
    }),

    remove_memory: tool({
      description: "Remove an outdated or incorrect memory by ID.",
      inputSchema: z.object({
        id: z.string().describe("The ID of the memory to remove"),
      }),
      execute: async ({ id }) => {
        const removed = memory.remove(id);
        return removed ? `Memory ${id} removed.` : `Memory ${id} not found.`;
      },
    }),
  };
}
