#!/usr/bin/env bun

import { Command } from "commander";
import { PluginManager } from "./src/core/plugin-manager";
import { runOnboardingIfNeeded } from "./src/core/config/onboarding";
import path from "path";
import chalk from "chalk";

async function main() {
    const program = new Command();

    program
        .name("somaflow")
        .description("SomaFlow — The Extensible AI Coding Platform")
        .version("0.1.0");

    // 1. Run onboarding / load config (sets env vars from saved config)
    const config = await runOnboardingIfNeeded();

    // 2. Initialize the Plugin Engine
    const manager = new PluginManager(program);

    // 3. Load enabled plugins
    for (const pluginName of config.enabledPlugins) {
        try {
            const pluginModule = await import(path.join(__dirname, "plugins", pluginName, "index.ts"));
            if (pluginModule.default) {
                await manager.register(pluginModule.default);
            }
        } catch (err) {
            console.error(chalk.yellow(`Warning: Could not load plugin '${pluginName}'`), err);
        }
    }

    // 4. Discover any other community plugins
    await manager.discoverLocalPlugins(path.join(__dirname, "plugins"));

    // 5. If no CLI arguments — run the wakeup + Arthur flow directly
    if (process.argv.length === 2) {
        const { runWakeup } = await import("./src/tui/wakeup");
        await runWakeup({ savedModel: config.model, displayName: config.displayName, agentName: config.agentName });

        // Auto-start Telegram if configured
        if (config.telegram?.autoStart && config.telegram.botToken) {
            const { startTelegramBot } = await import("./plugins/telegram/bot");
            await startTelegramBot(config.telegram.botToken, config.telegram.ownerId);
        }

        // Launch Arthur CLI loop
        const { runArthurCli } = await import("./plugins/cli/arthur");
        await runArthurCli();
        return;
    }

    // 6. Otherwise, parse CLI sub-commands (e.g. somaflow wakeup, somaflow chat)
    await program.parseAsync(process.argv);
}

main().catch(console.error);
