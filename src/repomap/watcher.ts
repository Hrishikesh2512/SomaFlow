import fs from "node:fs";
import path from "node:path";
import { repoMapStore } from "./store";

const EXCLUDED = new Set(["node_modules", ".git", "dist", "build", "coverage"]);

let watcher: fs.FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Start a file-system watcher on the workspace.
 * Debounced — only rebuilds the index 2s after the last file change.
 */
export function startRepoWatcher(rootPath: string): void {
  if (watcher) return; // already running

  const rebuild = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        await repoMapStore.refresh(rootPath);
      } catch {
        // silent — don't crash if index fails
      }
    }, 2000);
  };

  try {
    watcher = fs.watch(rootPath, { recursive: true }, (_, filename) => {
      if (!filename) return;
      // Ignore excluded directories and non-code files
      const parts = filename.split(/[/\\]/);
      if (parts.some((p) => EXCLUDED.has(p))) return;
      const ext = path.extname(filename).toLowerCase();
      if (![".ts", ".tsx", ".js", ".jsx", ".mjs"].includes(ext)) return;
      rebuild();
    });

    watcher.on("error", () => {
      watcher = null; // reset so it can be restarted
    });
  } catch {
    // fs.watch recursive not supported on all platforms — graceful skip
  }
}

export function stopRepoWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}
