// Test helper: the declarations of one CSS rule in a stylesheet next to the test. happy-dom has no
// layout, so a part's layout fix is held by its markup (the class on the text element) and by this
// contract on the rule that class selects. The layout itself is proved in a real browser by
// tests/acceptance/ds-09-limits.test.mjs.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The declarations of the rules whose selector list holds `selector` exactly, as a property to
 * value map (values with their spaces collapsed). Only top-level rules count: a rule inside an
 * @media or @container block applies only in some conditions, so it never stands for the base
 * style. Matching rules merge in file order, the last value of a property wins (as in the cascade).
 * Throws when there is no such rule, so a renamed class fails the test instead of passing on nothing.
 */
export function cssRule(
  dir: string,
  file: string,
  selector: string,
): Record<string, string> {
  const css = readFileSync(resolve(dir, file), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const out: Record<string, string> = {};
  let found = false;
  let depth = 0;
  let start = 0;
  let head = "";
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      if (depth === 0) {
        head = css.slice(start, i);
        start = i + 1;
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        // A rule with no nested block: its head is a selector list. An at-rule holds blocks, so
        // its body has braces and is skipped here.
        const body = css.slice(start, i);
        const selectors = head.split(",").map((s) => s.trim());
        if (!head.trim().startsWith("@") && !body.includes("{")) {
          if (selectors.includes(selector)) {
            found = true;
            for (const line of body.split(";")) {
              const at = line.indexOf(":");
              if (at < 0) continue;
              out[line.slice(0, at).trim()] = line
                .slice(at + 1)
                .replace(/\s+/g, " ")
                .trim();
            }
          }
        }
        start = i + 1;
      }
    }
  }
  if (!found) throw new Error(`no rule for ${selector} in ${file}`);
  return out;
}

/** The pair that gives a line room for stacked Vietnamese marks without moving the layout. */
export const MARKS_ROOM = {
  "padding-block": "var(--border-2)",
  "margin-block": "calc(-1 * var(--border-2))",
} as const;
