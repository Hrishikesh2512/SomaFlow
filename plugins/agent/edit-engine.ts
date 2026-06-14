/**
 * Tiered edit-application engine.
 *
 * Applies a list of find/replace edits to a source string, atomically (all or
 * nothing). Each edit is matched with a fallback ladder so the model doesn't
 * have to reproduce whitespace/indentation byte-for-byte:
 *
 *   1. exact      — literal substring match
 *   2. whitespace — line-by-line match ignoring leading/trailing whitespace,
 *                   re-indenting the replacement to the matched block's indent
 *
 * Edits are applied in order; each sees the result of the previous one.
 */

export interface FileEdit {
  /** Text to find. Must be non-empty and must differ from newText. */
  oldText: string;
  /** Text to replace it with. */
  newText: string;
  /** Replace every occurrence instead of requiring a single unique match. */
  replaceAll?: boolean;
}

export type MatchStrategy = "exact" | "whitespace";

export interface EditResult {
  ok: boolean;
  content?: string;
  /** Strategy used for each edit, in order (only when ok). */
  strategies?: MatchStrategy[];
  /** Index of the edit that failed (only when !ok). */
  failedIndex?: number;
  error?: string;
}

const leadingWS = (line: string): string => /^[ \t]*/.exec(line)?.[0] ?? "";

/** Drop a single trailing empty line produced by a trailing "\n" in the input. */
function toLines(s: string): string[] {
  const lines = s.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/**
 * Re-indent `newText` so its base indentation matches `targetIndent`, assuming
 * it was authored against `sourceIndent`. Relative indentation inside the block
 * is preserved.
 */
function reindent(newText: string, sourceIndent: string, targetIndent: string): string {
  if (sourceIndent === targetIndent) return newText;
  return newText
    .split("\n")
    .map((line) => {
      if (line.trim() === "") return "";
      const stripped = line.startsWith(sourceIndent)
        ? line.slice(sourceIndent.length)
        : line.replace(/^[ \t]*/, "");
      return targetIndent + stripped;
    })
    .join("\n");
}

/** Find consecutive line spans in `sourceLines` matching `oldLines` after trimming. */
function findTrimmedSpans(
  sourceLines: string[],
  oldLines: string[],
): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  const trimmedOld = oldLines.map((l) => l.trim());
  const n = trimmedOld.length;
  if (n === 0) return spans;

  for (let i = 0; i + n <= sourceLines.length; i++) {
    let match = true;
    for (let j = 0; j < n; j++) {
      if ((sourceLines[i + j] ?? "").trim() !== trimmedOld[j]) {
        match = false;
        break;
      }
    }
    if (match) spans.push({ start: i, end: i + n });
  }
  return spans;
}

function applyOne(
  source: string,
  edit: FileEdit,
): { ok: true; content: string; strategy: MatchStrategy } | { ok: false; error: string } {
  const { oldText, newText, replaceAll } = edit;

  if (oldText === "") return { ok: false, error: "oldText is empty (use create_file to make a new file)" };
  if (oldText === newText) return { ok: false, error: "oldText and newText are identical (no-op)" };

  // ── Tier 1: exact ──────────────────────────────────────────────────────────
  const exactCount = countOccurrences(source, oldText);
  if (exactCount === 1) {
    return { ok: true, content: source.replace(oldText, () => newText), strategy: "exact" };
  }
  if (exactCount > 1) {
    if (replaceAll) {
      return { ok: true, content: source.split(oldText).join(newText), strategy: "exact" };
    }
    return {
      ok: false,
      error: `oldText matches ${exactCount} places. Add surrounding context to make it unique, or set replaceAll: true.`,
    };
  }

  // ── Tier 2: whitespace / indentation-flexible ────────────────────────────────
  const sourceLines = source.split("\n");
  const oldLines = toLines(oldText);
  const spans = findTrimmedSpans(sourceLines, oldLines);

  if (spans.length === 0) {
    return { ok: false, error: "oldText not found in file (even ignoring whitespace)." };
  }
  if (spans.length > 1 && !replaceAll) {
    return {
      ok: false,
      error: `oldText matches ${spans.length} places (ignoring whitespace). Add context to disambiguate, or set replaceAll: true.`,
    };
  }

  // Apply spans back-to-front so earlier indices stay valid.
  const oldBaseIndent = leadingWS(oldLines[0] ?? "");
  const newLines = toLines(newText);
  let lines = sourceLines;
  for (const span of [...spans].reverse()) {
    const targetIndent = leadingWS(lines[span.start] ?? "");
    const replacement = reindent(newLines.join("\n"), oldBaseIndent, targetIndent).split("\n");
    lines = [...lines.slice(0, span.start), ...replacement, ...lines.slice(span.end)];
  }
  return { ok: true, content: lines.join("\n"), strategy: "whitespace" };
}

/** Apply edits sequentially and atomically. */
export function applyEdits(source: string, edits: FileEdit[]): EditResult {
  if (edits.length === 0) return { ok: false, error: "No edits provided." };

  let content = source;
  const strategies: MatchStrategy[] = [];
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    if (!edit) continue;
    const res = applyOne(content, edit);
    if (!res.ok) {
      return { ok: false, failedIndex: i, error: `Edit #${i + 1}: ${res.error}` };
    }
    content = res.content;
    strategies.push(res.strategy);
  }
  return { ok: true, content, strategies };
}
