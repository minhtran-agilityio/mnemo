// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  COPIED_TEXT,
  COPY_RESET_MS,
  createCopyLine,
  FAILED_TEXT,
} from "./copy-line";
import css from "./copy-line.css?raw";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window.navigator, "clipboard");
  window.getSelection()?.removeAllRanges();
});

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function parts(line: HTMLElement) {
  return {
    button: line.querySelector("button") as HTMLButtonElement,
    text: line.querySelector(".copy-line-text") as HTMLElement,
    status: line.querySelector(".copy-line-status") as HTMLElement,
  };
}

test("idle shows the label, the text and a Copy button, with no status", () => {
  const line = createCopyLine(document, { label: "Ubuntu", text: "ls -l" });
  const { button, text, status } = parts(line);
  expect(line.querySelector(".copy-line-label")?.textContent).toBe("Ubuntu");
  expect(text.textContent).toBe("ls -l");
  expect(button.textContent).toBe("Copy");
  expect(status.textContent).toBe("");
  expect(line.dataset.state).toBe("idle");
});

test("the group and the button have accessible names", () => {
  const line = createCopyLine(document, { label: "macOS", text: "x" });
  const labelId = line.getAttribute("aria-labelledby") ?? "";
  expect(line.querySelector(`#${labelId}`)?.textContent).toBe("macOS");
  expect(parts(line).button.getAttribute("aria-label")).toBe("Copy macOS");
});

test("text is set as text, never HTML", () => {
  const line = createCopyLine(document, {
    label: "<i>a</i>",
    text: "<b>x</b> $(date)",
  });
  expect(line.querySelector("b")).toBeNull();
  expect(line.querySelector("i")).toBeNull();
  expect(parts(line).text.textContent).toBe("<b>x</b> $(date)");
});

test("the text is focusable so the keyboard can select it", () => {
  expect(
    parts(createCopyLine(document, { label: "a", text: "b" })).text.tabIndex,
  ).toBe(0);
});

test("a click copies the exact text, shows Copied in words, then returns to idle", async () => {
  const copy = vi.fn().mockResolvedValue(undefined);
  const text = 'cp -a "/home/Nguyễn Văn/dữ liệu" ~/b';
  const line = createCopyLine(document, { label: "Ubuntu", text, copy });
  const { button, status } = parts(line);
  button.click();
  await flush();
  expect(copy).toHaveBeenCalledWith(text);
  expect(line.dataset.state).toBe("copied");
  expect(button.textContent).toBe(COPIED_TEXT);
  expect(status.textContent).toBe(COPIED_TEXT);
  vi.advanceTimersByTime(COPY_RESET_MS);
  expect(line.dataset.state).toBe("idle");
  expect(button.textContent).toBe("Copy");
  expect(status.textContent).toBe("");
});

test("keyboard: Enter or Space on the focused button is a click", async () => {
  const copy = vi.fn().mockResolvedValue(undefined);
  const line = createCopyLine(document, { label: "a", text: "b", copy });
  const { button } = parts(line);
  expect(button.tagName).toBe("BUTTON");
  expect(button.type).toBe("button");
  document.body.append(line);
  button.focus();
  expect(document.activeElement).toBe(button);
  button.click();
  await flush();
  expect(copy).toHaveBeenCalledOnce();
});

test("a rejected clipboard shows the visible fallback line and selects the text", async () => {
  const copy = vi.fn().mockRejectedValue(new Error("denied"));
  const line = createCopyLine(document, { label: "a", text: "abc", copy });
  document.body.append(line);
  parts(line).button.click();
  await flush();
  expect(line.dataset.state).toBe("failed");
  expect(parts(line).status.textContent).toBe(FAILED_TEXT);
  expect(window.getSelection()?.toString()).toBe("abc");
  expect(parts(line).button.textContent).toBe("Copy");
  vi.advanceTimersByTime(COPY_RESET_MS * 3);
  expect(line.dataset.state).toBe("failed");
  line.remove();
});

test("a writer that throws, or a missing clipboard, also fails visibly", async () => {
  const throwing = createCopyLine(document, {
    label: "a",
    text: "b",
    copy: () => {
      throw new Error("boom");
    },
  });
  parts(throwing).button.click();
  await flush();
  expect(throwing.dataset.state).toBe("failed");

  Object.defineProperty(window.navigator, "clipboard", {
    value: undefined,
    configurable: true,
  });
  const missing = createCopyLine(document, { label: "a", text: "b" });
  parts(missing).button.click();
  await flush();
  expect(missing.dataset.state).toBe("failed");
  expect(parts(missing).status.textContent).toBe(FAILED_TEXT);
});

test("the default writer uses navigator.clipboard when present", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window.navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  const line = createCopyLine(document, { label: "a", text: "hello" });
  parts(line).button.click();
  await flush();
  expect(writeText).toHaveBeenCalledWith("hello");
  expect(line.dataset.state).toBe("copied");
});

test("a second click after a failure can succeed and clears the failure line", async () => {
  const copy = vi
    .fn()
    .mockRejectedValueOnce(new Error("no"))
    .mockResolvedValueOnce(undefined);
  const line = createCopyLine(document, { label: "a", text: "b", copy });
  parts(line).button.click();
  await flush();
  parts(line).button.click();
  await flush();
  expect(line.dataset.state).toBe("copied");
  expect(parts(line).status.textContent).toBe(COPIED_TEXT);
});

test("a fixed starting state shows copied or failed without a click", () => {
  const copied = createCopyLine(document, {
    label: "a",
    text: "b",
    state: "copied",
  });
  expect(parts(copied).status.textContent).toBe(COPIED_TEXT);
  const failed = createCopyLine(document, {
    label: "a",
    text: "b",
    state: "failed",
  });
  expect(parts(failed).status.textContent).toBe(FAILED_TEXT);
});

test("very long content stays in the text element, which wraps", () => {
  const long = `/home/owner/${"very-long-folder-".repeat(40)}`;
  const line = createCopyLine(document, { label: "Path", text: long });
  expect(parts(line).text.textContent).toBe(long);
  expect(line.querySelectorAll("code")).toHaveLength(1);
});

test("the text box is named by the label", () => {
  const line = createCopyLine(document, { label: "Ubuntu", text: "x" });
  const labelId = line.querySelector(".copy-line-label")?.id;
  expect(parts(line).text.getAttribute("aria-labelledby")).toBe(labelId);
  expect(parts(line).text.getAttribute("role")).toBe("textbox");
  expect(parts(line).text.getAttribute("aria-readonly")).toBe("true");
});

test("the status line is a live region that exists while empty and is never hidden", () => {
  const line = createCopyLine(document, { label: "a", text: "b" });
  const { status } = parts(line);
  expect(status.getAttribute("role")).toBe("status");
  expect(status.textContent).toBe("");
  expect(status.hidden).toBe(false);
  expect(css).not.toMatch(/display:\s*none/);
});

test("a second failure clears the line first so it is announced again", async () => {
  let reject: (e: Error) => void = () => {};
  const copy = vi
    .fn()
    .mockRejectedValueOnce(new Error("no"))
    .mockImplementationOnce(
      () =>
        new Promise<void>((_, r) => {
          reject = r;
        }),
    );
  const line = createCopyLine(document, { label: "a", text: "b", copy });
  parts(line).button.click();
  await flush();
  expect(parts(line).status.textContent).toBe(FAILED_TEXT);
  parts(line).button.click();
  expect(parts(line).status.textContent).toBe("");
  reject(new Error("again"));
  await flush();
  expect(parts(line).status.textContent).toBe(FAILED_TEXT);
});
