import { text, isCancel, intro, outro } from "@clack/prompts";
import chalk from "chalk";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

async function main() {
    intro(chalk.bgCyan.black(" SomaFlow Plugin Installer "));

    const repoUrl = await text({
        message: "Enter the Git repository URL of the plugin to install:",
        placeholder: "https://github.com/username/somaflow-plugin.git",
        validate: (value) => {
            if (!value) return "Please enter a URL.";
            if (!value.endsWith(".git")) return "Must be a valid .git repository URL.";
        }
    });
    if (isCancel(repoUrl)) process.exit(0);

    // Extract repo name to use as folder name
    const match = repoUrl.toString().match(/\/([^/]+)\.git$/);
    if (!match) {
        outro(chalk.red("Could not parse repository name from URL."));
        process.exit(1);
    }

    const pluginName = match[1] as string;
    const pluginDir = path.join(process.cwd(), "plugins", pluginName);

    console.log(chalk.cyan(`\nCloning plugin into ./plugins/${pluginName}...`));

    try {
        await execAsync(`git clone ${repoUrl} ${pluginDir}`);
        outro(chalk.green(`\n✓ Plugin installed successfully at ./plugins/${pluginName}/\nIt will automatically load on the next run!`));
    } catch (error) {
        outro(chalk.red(`\n✗ Failed to install plugin: ${error}`));
    }
}

main().catch(console.error);
