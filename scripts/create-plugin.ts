import { text, isCancel, intro, outro } from "@clack/prompts";
import chalk from "chalk";
import fs from "fs/promises";
import path from "path";

async function main() {
    intro(chalk.bgCyan.black(" SomaFlow Plugin Scaffolder "));

    const pluginName = await text({
        message: "What is the name of your new plugin?",
        placeholder: "my-awesome-plugin",
        validate: (value) => {
            if (!value) return "Please enter a name.";
            if (!/^[a-z0-9-]+$/.test(value)) return "Plugin name can only contain lowercase letters, numbers, and dashes.";
        }
    });
    if (isCancel(pluginName)) process.exit(0);

    const description = await text({
        message: "Briefly describe your plugin:",
        placeholder: "Adds an awesome new command"
    });
    if (isCancel(description)) process.exit(0);

    const pluginDir = path.join(process.cwd(), "plugins", pluginName as string);
    const indexTsPath = path.join(pluginDir, "index.ts");

    const template = `import type { SomaPlugin } from "../src/core/plugin-manager";
import chalk from "chalk";

const ${String(pluginName).replace(/-([a-z])/g, (g) => (g[1] || "").toUpperCase())}Plugin: SomaPlugin = {
    name: "${pluginName}",
    version: "1.0.0",
    description: "${description}",
    onInit: async (context) => {
        // Called when the plugin is loaded into the engine
        // console.log(chalk.cyan("Plugin ${pluginName} initialized!"));
    },
    registerCommands: (program) => {
        program
            .command("${pluginName}")
            .description("${description}")
            .action(async () => {
                console.log(chalk.green("Hello from ${pluginName} plugin!"));
            });
    }
};

export default ${String(pluginName).replace(/-([a-z])/g, (g) => (g[1] || "").toUpperCase())}Plugin;
`;

    try {
        await fs.mkdir(pluginDir, { recursive: true });
        await fs.writeFile(indexTsPath, template, "utf-8");
        
        outro(chalk.green(`\n✓ Plugin created successfully at ./plugins/${pluginName}/\nTo run it, restart SomaFlow and execute: somaflow ${pluginName}`));
    } catch (error) {
        outro(chalk.red(`\n✗ Failed to create plugin: ${error}`));
    }
}

main().catch(console.error);
