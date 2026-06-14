import { describe, expect, test } from "bun:test";
import { applyEdits } from "./edit-engine";

describe("applyEdits — exact matching", () => {
  test("replaces a unique exact match", () => {
    const r = applyEdits("const a = 1;\nconst b = 2;\n", [
      { oldText: "const a = 1;", newText: "const a = 42;" },
    ]);
    expect(r.ok).toBe(true);
    expect(r.content).toBe("const a = 42;\nconst b = 2;\n");
    expect(r.strategies).toEqual(["exact"]);
  });

  test("errors on an ambiguous match without replaceAll", () => {
    const r = applyEdits("x;\nx;\n", [{ oldText: "x;", newText: "y;" }]);
    expect(r.ok).toBe(false);
    expect(r.failedIndex).toBe(0);
    expect(r.error).toContain("2 places");
  });

  test("replaceAll replaces every exact occurrence", () => {
    const r = applyEdits("x;\nx;\nx;\n", [{ oldText: "x;", newText: "y;", replaceAll: true }]);
    expect(r.ok).toBe(true);
    expect(r.content).toBe("y;\ny;\ny;\n");
  });

  test("uses replacement text literally (no $ special-casing)", () => {
    const r = applyEdits("price = OLD;", [{ oldText: "OLD", newText: "$1.50" }]);
    expect(r.content).toBe("price = $1.50;");
  });
});

describe("applyEdits — whitespace / indentation fallback", () => {
  test("matches despite differing indentation and re-indents the replacement", () => {
    // Source is tab-indented; the model supplies space indentation, so this can
    // only match via the whitespace tier, and the replacement must come back as tabs.
    const src = "function f() {\n\t\treturn 1;\n}\n";
    const r = applyEdits(src, [
      { oldText: "    return 1;", newText: "    return 2;" },
    ]);
    expect(r.ok).toBe(true);
    expect(r.strategies).toEqual(["whitespace"]);
    expect(r.content).toBe("function f() {\n\t\treturn 2;\n}\n");
  });

  test("preserves relative indentation inside a multi-line replacement", () => {
    const src = "class C {\n    m() {\n        a();\n    }\n}\n";
    const r = applyEdits(src, [
      {
        oldText: "m() {\n    a();\n}",
        newText: "m() {\n    a();\n    b();\n}",
      },
    ]);
    expect(r.ok).toBe(true);
    // The block is at 4-space indent in source; b() should land at 8 spaces.
    expect(r.content).toBe("class C {\n    m() {\n        a();\n        b();\n    }\n}\n");
  });

  test("errors when text is genuinely absent", () => {
    const r = applyEdits("hello\n", [{ oldText: "goodbye", newText: "x" }]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("not found");
  });
});

describe("applyEdits — multi-edit semantics", () => {
  test("applies edits sequentially, each seeing the previous result", () => {
    const r = applyEdits("a\nb\nc\n", [
      { oldText: "a", newText: "1" },
      { oldText: "b", newText: "2" },
      { oldText: "c", newText: "3" },
    ]);
    expect(r.ok).toBe(true);
    expect(r.content).toBe("1\n2\n3\n");
  });

  test("is atomic: a later failure rejects the whole batch", () => {
    const r = applyEdits("a\nb\n", [
      { oldText: "a", newText: "1" },
      { oldText: "nonexistent", newText: "x" },
    ]);
    expect(r.ok).toBe(false);
    expect(r.failedIndex).toBe(1);
    expect(r.content).toBeUndefined();
  });

  test("rejects empty oldText and no-op edits", () => {
    expect(applyEdits("x", [{ oldText: "", newText: "y" }]).ok).toBe(false);
    expect(applyEdits("x", [{ oldText: "x", newText: "x" }]).ok).toBe(false);
    expect(applyEdits("x", []).ok).toBe(false);
  });
});
