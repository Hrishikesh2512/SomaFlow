import { Command } from "commander";
import type { SomaPlugin } from "../../src/core/plugin-manager";
import { runWakeup } from "../../src/tui/wakeup";
import { getConfig } from "../../src/core/config/onboarding";

const WakeupPlugin: SomaPlugin = {
    name: "wakeup",
    version: "1.0.0",
    description: "Boot Arthur — print banner, resolve model, and launch the agent.",
    registerCommands: (program: Command) => {
        program
            .command("wakeup")
            .description("Wake Arthur up and start your coding session")
            .action(async () => {
                const config = await getConfig();
                await runWakeup({ savedModel: config?.model, displayName: config?.displayName, agentName: config?.agentName });

                if (config?.telegram?.autoStart && config.telegram.botToken) {
                    const { startTelegramBot } = await import("../../plugins/telegram/bot");
                    await startTelegramBot(config.telegram.botToken, config.telegram.ownerId);
                }

                const { runArthurCli } = await import("../../plugins/cli/arthur");
                await runArthurCli();
            });
    }
};

export default WakeupPlugin;
