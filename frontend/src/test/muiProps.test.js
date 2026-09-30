import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// MUI v9 removed these props. They don't error: they are silently ignored (or rendered as junk DOM attributes),
// which broke bold headings, grey secondary text, input limits and accessible names before this guard existed.
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const files = walk("src").filter((f) => f.endsWith(".jsx"));

describe("removed MUI v9 props are not used", () => {
  it("no legacy TextField/Select prop names", () => {
    const bad = files.filter((f) => /\b(inputProps|InputProps|SelectProps)=/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });

  it("no system props on Typography/Stack/Link/DialogTitle (use sx)", () => {
    const rx = /<(Typography|Stack|Link|DialogTitle)\b[^>]*?\s(fontWeight|display|justifyContent|alignItems|flexWrap|textAlign|color)=/g;
    const bad = files.flatMap((f) => [...readFileSync(f, "utf8").matchAll(rx)].map((m) => `${f}: <${m[1]} ${m[2]}=`));
    expect(bad).toEqual([]);
  });
});
