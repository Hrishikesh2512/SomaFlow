import { Command } from "commander";
import type { SomaPlugin } from "../../src/core/plugin-manager";
import { runArthurCli } from "./arthur";

const CliPlugin: SomaPlugin = {
    name: "cli",
    version: "1.0.0",
    description: "Arthur — the autonomous coding agent CLI interface.",
    registerCommands: (program: Command) => {
        program
            .command("chat")
            .description("Start an Arthur coding session")
            .action(async () => {
                await runArthurCli();
            });
    }
};

export default CliPlugin;
