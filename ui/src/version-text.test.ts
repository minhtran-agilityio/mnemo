import { expect, test } from "vitest";
import { versionErrorText, versionText } from "./version-text";

test("versionText prefixes the version", () => {
  expect(versionText("0.1.0")).toBe("Version 0.1.0");
});

test("versionErrorText shows a fixed message, not the raw error", () => {
  expect(versionErrorText()).toBe(
    "Version unknown: could not read the app version.",
  );
});
