import { isCancel, text } from "@clack/prompts";
import chalk from "chalk";
import { defaultAgentConfig } from "./types";
import { MemoryStore } from "../../src/memory/store";
import { Session } from "./adaptive-loop";
import { initMcp } from "../../src/mcp/client";

const memory = new MemoryStore();

export async function runAgentMode() {
  console.log(chalk.bold("\n Agent Mode ") + chalk.dim("— a continuing conversation; submit empty to exit\n"));

  const mcp = await initMcp();
  const session = new Session({
    config: defaultAgentConfig(),
    memory,
    context: memory.getAll(),
    extraTools: mcp.tools,
  });

  try {
    while (true) {
      const isFirst = session.turnCount === 0;
      const goal = await text({
        message: isFirst ? "What would you like the agent to do?" : "Anything else? (follow-up, correction, or new task)",
        placeholder: isFirst ? "Concrete task for this codebase..." : "Submit empty to exit",
      });

      if (isCancel(goal) || !goal.trim()) {
        console.log(chalk.dim("\nLeaving Agent Mode.\n"));
        return;
      }

      await session.runTurn(goal.trim());
    }
  } finally {
    await mcp.close();
  }
}
