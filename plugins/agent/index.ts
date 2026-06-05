import { Command } from "commander";
import type { SomaPlugin } from "../../src/core/plugin-manager";
import { runAgentMode } from "./orchestrator";

const AgentPlugin: SomaPlugin = {
    name: "agent",
    version: "1.0.0",
    description: "Autonomous coding agent for SomaFlow.",
    registerCommands: (program: Command) => {
        program
            .command("agent")
            .description("Run the autonomous coding agent")
            .action(async () => {
                await runAgentMode();
            });
    }
};

export default AgentPlugin;
