import { expect, test } from "vitest";
import { versionErrorText, versionText } from "./version-text";

test("versionText prefixes the version", () => {
  expect(versionText("0.1.0")).toBe("Version 0.1.0");
});

test("versionErrorText does not show the raw error", () => {
  const text = versionErrorText(new Error("boom /home/me/secret"));
  expect(text).toBe("Version unknown: could not read the app version.");
  expect(text).not.toContain("boom");
});
