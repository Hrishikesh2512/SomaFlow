import { tool, generateText } from "ai";
import { z } from "zod";
import type { MemoryStore } from "./store";
import { randomUUID } from "crypto";

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

    summarize_memory: tool({
      description: "Compress all stored memories into a single compact summary. Use when memory count is high (>15 items) to save context. This is irreversible — old items are replaced.",
      inputSchema: z.object({}),
      execute: async () => {
        const all = memory.getAll();
        if (all.length < 5) return `Only ${all.length} memories — no need to summarize yet.`;
        const raw = all.map(m => `[${m.type}] ${m.content}`).join("\n");
        const { default: getModel } = await import("../ai/ai.config.ts") as any;
        const { generateText: gen } = await import("ai");
        const result = await gen({
          model: getModel.getAgentModel(),
          system: "You are a memory summarizer. Compress the following memory entries into a single dense paragraph preserving all important facts, user preferences, and decisions. Be concise.",
          prompt: raw,
        });
        const summary = result.text.trim();
        memory.replaceAll([{
          id: randomUUID(),
          type: "fact",
          content: `[SUMMARY of ${all.length} memories] ${summary}`,
          timestamp: Date.now(),
        }]);
        return `Compressed ${all.length} memories into 1 summary.`;
      },
    }),
  };
}
