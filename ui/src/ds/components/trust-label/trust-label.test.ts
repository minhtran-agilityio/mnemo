// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { buildTrustLabel } from "./trust-label";

test("each kind has its word and class", () => {
  const guess = buildTrustLabel("guess");
  expect(guess.textContent).toBe("Guess");
  expect(guess.classList.contains("trust-guess")).toBe(true);
  const unv = buildTrustLabel("unverified");
  expect(unv.textContent).toBe("Unverified");
  expect(unv.classList.contains("trust-unv")).toBe(true);
  const ai = buildTrustLabel("ai");
  expect(ai.textContent).toBe("Written by AI");
  expect(ai.classList.contains("trust-ai")).toBe(true);
});

test("the icon is decorative, so the word is the signal", () => {
  for (const kind of ["guess", "unverified", "ai"] as const) {
    const icon = buildTrustLabel(kind).querySelector("svg");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  }
});
