/**
 * MCP (Model Context Protocol) integration.
 *
 * Connects to external MCP servers declared in config and exposes their tools to
 * the agent as native AI-SDK tools, namespaced `mcp__<server>__<tool>`. This is
 * the ecosystem unlock: any MCP server (filesystem, GitHub, Postgres, browser,
 * custom) becomes available to SomaFlow without bespoke integration code.
 */
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";
import { dynamicTool, jsonSchema } from "ai";
import type { ToolSet } from "ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpClientLike {
  listTools(): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<Record<string, unknown>>;
}

const sanitize = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, "_");

function formatContent(content: unknown): string {
  if (!Array.isArray(content)) return content === undefined ? "(no output)" : JSON.stringify(content);
  const parts = content.map((c) => {
    if (c && typeof c === "object" && (c as { type?: string }).type === "text") {
      return String((c as { text?: unknown }).text ?? "");
    }
    return JSON.stringify(c);
  });
  return parts.join("\n") || "(no output)";
}

/**
 * Convert a connected MCP client's tools into AI-SDK tools. Exported so it can be
 * tested against an in-memory server without spawning a subprocess.
 */
export async function mcpToolsFromClient(client: McpClientLike, serverName: string): Promise<ToolSet> {
  const { tools } = await client.listTools();
  const out: ToolSet = {};
  for (const t of tools) {
    const key = `mcp__${sanitize(serverName)}__${sanitize(t.name)}`;
    out[key] = dynamicTool({
      description: t.description ?? `MCP tool "${t.name}" from server "${serverName}".`,
      inputSchema: jsonSchema((t.inputSchema as object) ?? { type: "object", properties: {} }),
      execute: async (args) => {
        const res = await client.callTool({
          name: t.name,
          arguments: (args ?? {}) as Record<string, unknown>,
        });
        return formatContent(res.content);
      },
    });
  }
  return out;
}

/** Load MCP server config from the first location that exists, or null. */
export function loadMcpConfig(cwd: string = process.cwd()): McpConfig | null {
  const candidates = [
    process.env.SOMAFLOW_MCP_CONFIG,
    path.join(cwd, ".somaflow", "mcp.json"),
    path.join(homedir(), ".somaflow", "mcp.json"),
  ].filter((p): p is string => Boolean(p));

  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as McpConfig;
      if (parsed && typeof parsed === "object" && parsed.mcpServers) return parsed;
    } catch {
      /* malformed config — skip */
    }
  }
  return null;
}

export class McpManager {
  private clients: Client[] = [];
  private _tools: ToolSet = {};

  get tools(): ToolSet {
    return this._tools;
  }

  async connect(config: McpConfig): Promise<{ connected: string[]; failed: { name: string; error: string }[] }> {
    const connected: string[] = [];
    const failed: { name: string; error: string }[] = [];

    for (const [name, conf] of Object.entries(config.mcpServers ?? {})) {
      try {
        const env = conf.env
          ? { ...cleanEnv(), ...conf.env }
          : undefined;
        const transport = new StdioClientTransport({ command: conf.command, args: conf.args, env });
        const client = new Client({ name: "somaflow", version: "1.0.0" }, { capabilities: {} });
        await client.connect(transport);
        Object.assign(this._tools, await mcpToolsFromClient(client, name));
        this.clients.push(client);
        connected.push(name);
      } catch (e) {
        failed.push({ name, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { connected, failed };
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.clients.map((c) => c.close()));
    this.clients = [];
  }
}

function cleanEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
}

/** Connect to all configured MCP servers; returns merged tools and a closer. */
export async function initMcp(): Promise<{ tools: ToolSet; close: () => Promise<void> }> {
  const config = loadMcpConfig();
  if (!config || Object.keys(config.mcpServers ?? {}).length === 0) {
    return { tools: {}, close: async () => {} };
  }
  const manager = new McpManager();
  const { connected, failed } = await manager.connect(config);
  if (connected.length) {
    const count = Object.keys(manager.tools).length;
    console.log(chalk.dim(`  MCP: connected ${connected.join(", ")} (${count} tool${count === 1 ? "" : "s"})`));
  }
  for (const f of failed) console.log(chalk.yellow(`  MCP: failed to connect "${f.name}": ${f.error}`));
  return { tools: manager.tools, close: () => manager.close() };
}
