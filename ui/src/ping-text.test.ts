import { expect, test } from "vitest";
import { pingErrorText } from "./ping-text";

test("pingErrorText names the Rust core and includes the error", () => {
  expect(pingErrorText(new Error("boom"))).toBe(
    "Could not reach the Rust core: Error: boom",
  );
});
