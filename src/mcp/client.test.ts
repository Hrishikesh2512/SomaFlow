import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadMcpConfig, mcpToolsFromClient } from "./client";

describe("mcpToolsFromClient", () => {
  test("wraps a live MCP server's tools as namespaced AI-SDK tools that call through", async () => {
    const server = new McpServer({ name: "calc", version: "1.0.0" });
    server.registerTool(
      "add",
      { description: "Add two numbers", inputSchema: { a: z.number(), b: z.number() } },
      async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientTransport);

    const tools = await mcpToolsFromClient(client, "calc");
    expect(Object.keys(tools)).toContain("mcp__calc__add");

    const addTool = tools["mcp__calc__add"]!;
    expect(addTool.description).toContain("Add two numbers");

    const result = await addTool.execute!({ a: 2, b: 3 }, { toolCallId: "t1", messages: [] });
    expect(result).toBe("5");

    await client.close();
    await server.close();
  });
});

describe("loadMcpConfig", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-cfg-"));
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.SOMAFLOW_MCP_CONFIG;
  });

  test("returns null when no config exists", () => {
    delete process.env.SOMAFLOW_MCP_CONFIG;
    expect(loadMcpConfig(path.join(dir, "nope"))).toBeNull();
  });

  test("parses a config pointed at by SOMAFLOW_MCP_CONFIG", () => {
    const cfgPath = path.join(dir, "mcp.json");
    fs.writeFileSync(cfgPath, JSON.stringify({ mcpServers: { fs: { command: "node", args: ["server.js"] } } }));
    process.env.SOMAFLOW_MCP_CONFIG = cfgPath;
    const cfg = loadMcpConfig();
    expect(cfg?.mcpServers.fs?.command).toBe("node");
    expect(cfg?.mcpServers.fs?.args).toEqual(["server.js"]);
  });
});
