import type { RepoIndex, RepoFileEntry } from "./indexer";
import { repoMapStore } from "./store";

/**
 * Produces a compact string injected into every Arthur system prompt.
 * Designed to be token-efficient — only key files and their exports.
 */
export function formatCompactRepoMap(): string {
  const index = repoMapStore.getIndex();
  if (!index) return "";

  const lines: string[] = [
    `## Project Index (${index.totalFiles} files, ${index.totalSymbols} symbols, built ${index.builtAt.toLocaleTimeString()})`,
  ];

  // Group by top-level directory
  const grouped = new Map<string, RepoFileEntry[]>();
  for (const file of index.files) {
    const parts = file.path.split("/");
    const group = parts.length > 1 ? parts[0]! : "(root)";
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group)!.push(file);
  }

  for (const [group, files] of grouped) {
    lines.push(`\n### ${group}/`);
    for (const file of files) {
      const exported = file.symbols.filter((s) => s.kind !== "class" || file.path.includes(s.name.toLowerCase()));
      const symbolList = exported.slice(0, 6).map((s) => `${s.name}(${s.kind})`).join(", ");
      lines.push(`  ${file.path}${symbolList ? ` — ${symbolList}` : ""}`);
    }
  }

  return lines.join("\n");
}

/**
 * Produces a detailed string for the `get_repo_map` tool call.
 * Includes full symbol list per file.
 */
export function formatDetailedRepoMap(filePaths?: string[]): string {
  const index = repoMapStore.getIndex();
  if (!index) return "Repo map not yet built. Refresh in progress.";

  const files = filePaths
    ? index.files.filter((f) => filePaths.some((p) => f.path.includes(p)))
    : index.files;

  if (files.length === 0) return "No matching files found.";

  const lines: string[] = [];
  for (const file of files) {
    lines.push(`\n## ${file.path} (${(file.sizeBytes / 1024).toFixed(1)}KB)`);
    if (file.symbols.length > 0) {
      lines.push("### Symbols");
      for (const s of file.symbols) {
        lines.push(`  - [${s.kind}] ${s.name} (line ${s.line})`);
      }
    }
    if (file.imports.length > 0) {
      lines.push(`### Imports: ${file.imports.slice(0, 8).join(", ")}`);
    }
  }
  return lines.join("\n");
}
