import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface RepoSymbol {
  kind: "class" | "function" | "interface" | "type" | "const" | "export";
  name: string;
  line: number;
}

export interface RepoFileEntry {
  path: string;
  sizeBytes: number;
  symbols: RepoSymbol[];
  imports: string[];
}

export interface RepoIndex {
  files: RepoFileEntry[];
  builtAt: Date;
  totalFiles: number;
  totalSymbols: number;
}

const TEXT_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const SYMBOL_PATTERNS: { kind: RepoSymbol["kind"]; re: RegExp }[] = [
  { kind: "class",     re: /^export\s+(?:abstract\s+)?class\s+(\w+)/ },
  { kind: "interface", re: /^export\s+interface\s+(\w+)/ },
  { kind: "type",      re: /^export\s+type\s+(\w+)\s*=/ },
  { kind: "function",  re: /^export\s+(?:async\s+)?function\s+(\w+)/ },
  { kind: "const",     re: /^export\s+const\s+(\w+)/ },
  // non-exported class/function for internal reference
  { kind: "class",     re: /^(?:abstract\s+)?class\s+(\w+)/ },
  { kind: "function",  re: /^(?:async\s+)?function\s+(\w+)/ },
];

const IMPORT_RE = /^(?:import|export)\s+.*?from\s+['"]([^'"]+)['"]/;

const EXCLUDED = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  "coverage", ".cache", ".turbo", "out",
]);

export function indexFile(absPath: string, relPath: string): RepoFileEntry {
  const stat = fs.statSync(absPath);
  const text = fs.readFileSync(absPath, "utf8");
  const lines = text.split("\n");

  const symbols: RepoSymbol[] = [];
  const imports: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    for (const { kind, re } of SYMBOL_PATTERNS) {
      const m = line.match(re);
      if (m && m[1]) {
        symbols.push({ kind, name: m[1], line: i + 1 });
        break;
      }
    }
    const im = line.match(IMPORT_RE);
    if (im && im[1]) imports.push(im[1]);
  }

  return {
    path: relPath,
    sizeBytes: stat.size,
    symbols,
    imports: [...new Set(imports)],
  };
}

export function buildIndex(rootPath: string): RepoIndex {
  const files: RepoFileEntry[] = [];

  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (EXCLUDED.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      const rel = path.relative(rootPath, full).split(path.sep).join("/");
      if (ent.isDirectory()) {
        walk(full);
      } else if (TEXT_EXTS.has(path.extname(ent.name).toLowerCase())) {
        try {
          files.push(indexFile(full, rel));
        } catch {
          // skip unreadable files
        }
      }
    }
  };

  walk(rootPath);

  const totalSymbols = files.reduce((s, f) => s + f.symbols.length, 0);
  return { files, builtAt: new Date(), totalFiles: files.length, totalSymbols };
}
