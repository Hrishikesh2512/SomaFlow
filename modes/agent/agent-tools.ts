import { tool } from "ai";
import { z } from "zod";
import type { ToolExecutor } from "./tool-executor";
import type { MemoryStore } from "../../memory/store";
import { createMemoryTools } from "../../memory/tools";

export function createAgentTools(executor: ToolExecutor, memory: MemoryStore) {
  return {
    ...createMemoryTools(memory),
    read_file: tool({
      description:
        "Read a text file from the workspace. Use a path relative to the project root.",
      inputSchema: z.object({
        path: z.string().describe("Relative file path"),
      }),
      execute: async ({ path: p }) => executor.readFile(p),
    }),

    read_file_lines: tool({
      description:
        "Read specific lines from a file. Returns numbered lines. Much cheaper than reading the whole file for large files.",
      inputSchema: z.object({
        path: z.string().describe("Relative file path"),
        startLine: z.number().int().min(1).describe("First line to read (1-indexed)"),
        endLine: z.number().int().min(1).describe("Last line to read (inclusive)"),
      }),
      execute: async ({ path: p, startLine, endLine }) =>
        executor.readFileLines(p, startLine, endLine),
    }),

    create_file: tool({
      description:
        "Stage creation of a new file (not written until the user approves).",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
      }),
      execute: async ({ path: p, content }) => executor.createFile(p, content),
    }),

    modify_file: tool({
      description:
        "Stage a full-file replacement for an existing file (pending approval).",
      inputSchema: z.object({
        path: z.string(),
        content: z.string().describe("Complete new file contents"),
      }),
      execute: async ({ path: p, content }) => executor.modifyFile(p, content),
    }),

    replace_in_file: tool({
      description:
        "Stage a partial replacement in an existing file (pending approval). Target content must match exactly once.",
      inputSchema: z.object({
        path: z.string(),
        targetContent: z.string().describe("Exact string to be replaced"),
        replacementContent: z.string().describe("New content to replace with"),
      }),
      execute: async ({ path: p, targetContent, replacementContent }) =>
        executor.replaceInFile(p, targetContent, replacementContent),
    }),

    delete_file: tool({
      description: "Stage deletion of a file (pending approval).",
      inputSchema: z.object({
        path: z.string(),
      }),
      execute: async ({ path: p }) => executor.deleteFile(p),
    }),

    create_folder: tool({
      description:
        "Stage creation of a directory tree (pending approval). Uses mkdir -p on apply.",
      inputSchema: z.object({
        path: z.string().describe("Relative directory path"),
      }),
      execute: async ({ path: p }) => executor.createFolder(p),
    }),

    list_files: tool({
      description: "List files and directories under a path.",
      inputSchema: z.object({
        path: z.string(),
        recursive: z.boolean().optional().default(false),
      }),
      execute: async ({ path: p, recursive }) =>
        executor.listFiles(p, recursive),
    }),

    search_files: tool({
      description:
        'Find files matching a glob pattern (e.g. "*.ts", "**/*.md"). Optional content substring filter.',
      inputSchema: z.object({
        root: z.string().describe("Directory to search, relative to root"),
        pattern: z
          .string()
          .describe("Glob-like pattern using * and ** (forward slashes)"),
        content_contains: z.string().optional(),
      }),
      execute: async ({ root, pattern, content_contains }) =>
        executor.searchFiles(root, pattern, content_contains),
    }),

    grep_content: tool({
      description:
        "Search for a text string across all files in the workspace, returning matching lines with surrounding context (like ripgrep). Use this for debugging errors or finding usages.",
      inputSchema: z.object({
        query: z.string().describe("The exact text to search for"),
        root: z.string().optional().default(".").describe("Directory to search in"),
        contextLines: z.number().int().optional().default(3).describe("Number of context lines above and below each match"),
      }),
      execute: async ({ query, root, contextLines }) =>
        executor.grepContent(query, root, contextLines),
    }),

    analyze_codebase: tool({
      description:
        "Summarize structure: file counts, size, extensions. Read-only.",
      inputSchema: z.object({
        path: z.string().default("."),
      }),
      execute: async ({ path: p }) => executor.analyzeCodebase(p),
    }),

    execute_shell: tool({
      description:
        "Queue a shell command to run in the workspace after user approval. Use with care.",
      inputSchema: z.object({
        command: z.string().describe("Single command; runs with shell: true"),
      }),
      execute: async ({ command }) => executor.queueShell(command),
    }),

    ask_user: tool({
      description:
        "Pause agent execution to ask the user a clarifying question. Useful when stuck or ambiguous.",
      inputSchema: z.object({
        question: z.string().describe("The question to ask the user"),
      }),
      execute: async ({ question }) => executor.askUser(question),
    }),

    web_search: tool({
      description: "Search the web for information (e.g., documentation, errors, general queries).",
      inputSchema: z.object({
        query: z.string(),
      }),
      execute: async ({ query }) => executor.webSearch(query),
    }),

    fetch_url: tool({
      description: "Fetch the content of a URL (HTTP GET or POST). Use this to read documentation pages, test API endpoints, or download text content.",
      inputSchema: z.object({
        url: z.string().describe("The full URL to fetch"),
        method: z.string().optional().default("GET").describe("HTTP method (GET or POST)"),
      }),
      execute: async ({ url, method }) => executor.fetchUrl(url, method),
    }),

    git_execute: tool({
      description: "Execute a Git command. Use for read-only commands (status, log, diff, branch) to get immediate output, and mutating commands (commit, checkout, push) to queue for approval.",
      inputSchema: z.object({
        command: z.string().describe("The git command to run (e.g., 'git status', 'git commit -m \"msg\"')"),
      }),
      execute: async ({ command }) => {
        if (!command.startsWith("git ")) throw new Error("Only git commands allowed.");
        const isReadOnly = /^(git status|git log|git diff|git show|git branch)/.test(command);
        if (isReadOnly) {
          return executor.runImmediateShell(command);
        } else {
          return executor.queueShell(command);
        }
      },
    }),

    run_typecheck: tool({
      description: "Run the TypeScript compiler (tsc --noEmit) to check for errors immediately. Use this to verify code before finishing.",
      inputSchema: z.object({}),
      execute: async () => executor.runImmediateShell("bunx tsc --noEmit"),
    }),

    run_tests: tool({
      description: "Run the project test suite (bun test) immediately and return the results. Use this to verify code changes don't break tests.",
      inputSchema: z.object({
        filter: z.string().optional().describe("Optional test file or pattern to filter"),
      }),
      execute: async ({ filter }) => {
        const cmd = filter ? `bun test ${filter}` : "bun test";
        return executor.runImmediateShell(cmd);
      },
    }),

    run_formatter: tool({
      description: "Run a code formatter (prettier) on a specific file or directory. Executes immediately.",
      inputSchema: z.object({
        path: z.string().describe("File or directory to format"),
      }),
      execute: async ({ path: p }) =>
        executor.runImmediateShell(`bunx prettier --write "${p}"`),
    }),

    install_dependency: tool({
      description: "Queue installation of an npm/bun package (pending user approval). Example: 'zod', 'chalk@5'.",
      inputSchema: z.object({
        packageName: z.string().describe("Package name, optionally with version (e.g. 'zod', 'chalk@5')"),
        dev: z.boolean().optional().default(false).describe("Install as devDependency"),
      }),
      execute: async ({ packageName, dev }) => {
        const flag = dev ? " --dev" : "";
        return executor.queueShell(`bun add ${packageName}${flag}`);
      },
    }),

    search_symbol: tool({
      description: "Search the codebase for the definition of a specific symbol (class, function, variable, interface).",
      inputSchema: z.object({
        symbolName: z.string(),
      }),
      execute: async ({ symbolName }) => executor.searchSymbol(symbolName),
    }),

    list_skills: tool({
      description:
        "List absolute paths to SKILL.md files under configured skill directories (Cursor / Claude).",
      inputSchema: z.object({}),
      execute: async () => executor.listSkills(),
    }),

    read_skill: tool({
      description:
        "Read a SKILL.md file. Path must be absolute and under skill roots, or use a path returned by list_skills.",
      inputSchema: z.object({
        path: z.string(),
      }),
      execute: async ({ path: p }) => executor.readSkill(p),
    }),
  };
}