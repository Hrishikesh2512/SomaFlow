import { Command } from "commander";
import chalk from "chalk";

/**
 * Base interface for all SomaFlow plugins.
 */
export interface SomaPlugin {
    name: string;
    version: string;
    description?: string;
    
    /**
     * Called when the plugin is loaded into the engine.
     */
    onInit?: (context: PluginContext) => Promise<void> | void;

    /**
     * Register CLI commands.
     */
    registerCommands?: (program: Command) => void;
}

export interface PluginContext {
    engineVersion: string;
    // We can add global memory store, config access, etc. here later
}

export class PluginManager {
    private plugins: Map<string, SomaPlugin> = new Map();

    constructor(private program: Command) {}

    /**
     * Register a new plugin manually
     */
    public async register(plugin: SomaPlugin) {
        if (this.plugins.has(plugin.name)) {
            return;
        }

        try {
            if (plugin.onInit) {
                await plugin.onInit({ engineVersion: "1.0.0" });
            }

            if (plugin.registerCommands) {
                plugin.registerCommands(this.program);
            }

            this.plugins.set(plugin.name, plugin);
        } catch (error) {
            console.error(chalk.red(`Failed to initialize plugin ${plugin.name}:`), error);
        }
    }

    /**
     * Discover and load local plugins from a directory (e.g., ./plugins)
     */
    public async discoverLocalPlugins(pluginsDir: string) {
        const fs = await import("fs/promises");
        const path = await import("path");

        try {
            const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const pluginPath = path.join(pluginsDir, entry.name, "index.ts");
                    try {
                        await fs.access(pluginPath);
                        // Dynamic import of the plugin module
                        const module = await import(path.resolve(pluginPath));
                        if (module.default && module.default.name) {
                            await this.register(module.default as SomaPlugin);
                        } else {
                            console.warn(chalk.yellow(`Plugin at ${pluginPath} must export a default SomaPlugin object.`));
                        }
                    } catch (_e) {
                        // Not a valid plugin directory, ignore
                    }
                }
            }
        } catch (error) {
            // Plugins dir might not exist yet
            if ((error as any).code !== 'ENOENT') {
                console.error(chalk.red(`Error discovering plugins: ${error}`));
            }
        }
    }

    public getPlugins(): SomaPlugin[] {
        return Array.from(this.plugins.values());
    }
}
