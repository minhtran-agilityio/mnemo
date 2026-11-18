import { expect, test } from "vitest";
import { versionErrorText, versionText } from "./version-text";

test("versionText prefixes the version", () => {
  expect(versionText("0.1.0")).toBe("Version 0.1.0");
});

test("versionErrorText is non-empty and includes the error", () => {
  expect(versionErrorText(new Error("boom"))).toBe(
    "Version unknown: Error: boom",
  );
});
