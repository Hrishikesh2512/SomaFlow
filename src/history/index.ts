import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { snapshotStore, type Snapshot } from "./snapshot";

export { snapshotStore, type Snapshot };

/**
 * Take a snapshot of a file BEFORE Arthur modifies it.
 * Call this inside ToolExecutor before any mutation.
 */
export function takeSnapshot(
  workspacePath: string,
  relPath: string,
  after: string | undefined,
  description: string,
): Snapshot {
  const absPath = path.resolve(workspacePath, relPath);
  let before: string | undefined;
  try {
    before = fs.readFileSync(absPath, "utf8");
  } catch {
    before = undefined; // file didn't exist yet
  }
  return snapshotStore.take(relPath, before, after, description);
}

/**
 * Undo the last snapshot — restores the file to its before state.
 * Returns a human-readable result message.
 */
export function undoLast(workspacePath: string): string {
  const snap = snapshotStore.popLast();
  if (!snap) {
    return chalk.yellow("  Nothing to undo — history is empty.");
  }

  const absPath = path.resolve(workspacePath, snap.filePath);

  try {
    if (snap.before === undefined) {
      // File was created by Arthur — delete it
      if (fs.existsSync(absPath)) {
        fs.rmSync(absPath, { force: true });
      }
      return chalk.green(`  ✓ Undid creation of ${snap.filePath}`);
    } else {
      // Restore previous content
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, snap.before, "utf8");
      return chalk.green(`  ✓ Reverted ${snap.filePath} to its previous state`);
    }
  } catch (e: any) {
    return chalk.red(`  ✗ Undo failed: ${e.message}`);
  }
}

/**
 * Format the last N snapshots as a human-readable history list.
 */
export function getHistory(n = 10): string {
  const snaps = snapshotStore.getLast(n);
  if (snaps.length === 0) {
    return chalk.dim("  No history yet.");
  }
  const lines = snaps.map((s, i) => {
    const ts = s.timestamp.toLocaleTimeString();
    const action = s.before === undefined ? "created" : s.after === undefined ? "deleted" : "modified";
    return `  ${chalk.dim(`${i + 1}.`)} [${ts}] ${chalk.cyan(action)} ${chalk.bold(s.filePath)}\n     ${chalk.dim(s.description)}`;
  });
  return `\n${chalk.bold("Arthur's Action History:")}\n${lines.join("\n")}\n`;
}
