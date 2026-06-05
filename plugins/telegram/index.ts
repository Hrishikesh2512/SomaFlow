import { Command } from "commander";
import type { SomaPlugin } from "../../src/core/plugin-manager";
import { runTelegramMode } from "./bot";

const TelegramPlugin: SomaPlugin = {
    name: "telegram",
    version: "1.0.0",
    description: "Telegram bot interface for SomaFlow.",
    registerCommands: (program: Command) => {
        program
            .command("telegram")
            .description("Start the Telegram bot listener")
            .action(async () => {
                await runTelegramMode();
            });
    }
};

export default TelegramPlugin;
