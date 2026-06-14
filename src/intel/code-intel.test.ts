import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodeIntel } from "./code-intel";
import type { OverlayAccess } from "./code-intel";

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "intel-test-"));
  fs.writeFileSync(
    path.join(dir, "a.ts"),
    `export function greet(name: string): string {\n  return "hi " + name;\n}\n`,
  );
  fs.writeFileSync(
    path.join(dir, "b.ts"),
    `import { greet } from "./a";\nconsole.log(greet("world"));\nconsole.log(greet(123));\n`,
  );
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("CodeIntel — semantic queries", () => {
  test("searchSymbol finds the declaration", () => {
    const out = new CodeIntel(dir).searchSymbol("greet");
    expect(out).toContain("a.ts:1");
    expect(out).toContain("[function] greet");
  });

  test("findDefinition points to the declaration line", () => {
    const out = new CodeIntel(dir).findDefinition("greet");
    expect(out).toMatch(/a\.ts:1:\d+/);
  });

  test("findReferences finds the declaration plus both call sites and the import", () => {
    const out = new CodeIntel(dir).findReferences("greet");
    expect(out).toContain("a.ts:1");
    expect(out).toContain("b.ts:2");
    expect(out).toContain("b.ts:3");
    // declaration + import + 2 calls = 4
    expect(out).toContain("4 reference(s)");
  });

  test("getType returns the resolved signature", () => {
    const out = new CodeIntel(dir).getType("greet");
    expect(out).toContain("function greet(name: string): string");
  });

  test("getDiagnostics reports the real type error", () => {
    const out = new CodeIntel(dir).getDiagnostics();
    expect(out).toContain("TS2345");
    expect(out).toContain("b.ts:3");
  });
});

describe("CodeIntel — overlay (staged edits)", () => {
  test("diagnostics reflect a staged fix without touching disk", () => {
    const bAbs = path.join(dir, "b.ts");
    const staged = new Map<string, string>([
      [bAbs, `import { greet } from "./a";\nconsole.log(greet("world"));\nconsole.log(greet("123"));\n`],
    ]);
    const overlay: OverlayAccess = {
      get: (p) => staged.get(path.resolve(p)),
      isDeleted: () => false,
      list: () => [...staged.keys()],
    };
    const out = new CodeIntel(dir, overlay).getDiagnostics();
    expect(out).toBe("No diagnostics — clean.");
    // disk is untouched — a fresh intel without the overlay still sees the error
    expect(new CodeIntel(dir).getDiagnostics()).toContain("TS2345");
  });
});
