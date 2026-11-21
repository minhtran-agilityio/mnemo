// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Theme } from "../../frame/theme";
import type { AiHealth, AiMode, TestPromptResult } from "../../shared/api";
import { renderSettings, type SettingsDeps } from "./settings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

let container: HTMLElement;
let current: Theme;
let saves: Theme[];
let applied: Theme[];
let release: Array<() => void>;
let failWith: unknown;
let detached: Array<string | null>;
let firstHealth: Array<AiHealth | null | Error>;
let rechecks: Array<AiHealth | Error>;
let checks: number;
let aiMode: AiMode | Error;
let prompts: Array<(result: TestPromptResult | unknown) => void>;
let promptRejects: Array<(error: unknown) => void>;

const READY: AiHealth = { state: "ready", message: "Claude Code is ready." };
const SIGNED_OUT: AiHealth = {
  state: "not_signed_in",
  message: "Open a terminal and run `claude`.",
};

function deps(): SettingsDeps {
  return {
    getTheme: () => current,
    applyTheme: (theme) => {
      current = theme;
      applied.push(theme);
    },
    saveTheme: (theme) => {
      saves.push(theme);
      if (failWith) return Promise.reject(failWith);
      return new Promise<void>((done) => release.push(done));
    },
    getAiHealth: async () => {
      const next =
        firstHealth.length > 1 ? firstHealth.shift() : firstHealth[0];
      if (next instanceof Error) throw next;
      return next ?? null;
    },
    getAiMode: async () => {
      if (aiMode instanceof Error) throw aiMode;
      return aiMode;
    },
    checkAiHealth: async () => {
      checks += 1;
      const next = rechecks.shift() ?? READY;
      if (next instanceof Error) throw next;
      return next;
    },
    runTestPrompt: () =>
      new Promise<TestPromptResult>((done, fail) => {
        prompts.push(done as (r: unknown) => void);
        promptRejects.push(fail);
      }),
  };
}

function rowText(name: string): string {
  const row = [...container.querySelectorAll("button.section-list-row")].find(
    (b) => b.querySelector(".section-list-name")?.textContent === name,
  );
  return (row?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function pick(label: string): void {
  const radio = container.querySelector<HTMLInputElement>(
    `#theme-${label.toLowerCase()}`,
  );
  if (!radio) throw new Error(`no ${label} choice`);
  radio.click();
}

const tick = () => new Promise((done) => setTimeout(done, 0));

// The save queue outlives a screen, so every save a test left open is finished before the next test.
afterEach(async () => {
  for (const done of release) done();
  await tick();
  await tick();
});

beforeEach(() => {
  container = document.createElement("main");
  document.body.replaceChildren(container);
  current = "system";
  saves = [];
  applied = [];
  release = [];
  detached = [];
  failWith = undefined;
  firstHealth = [READY];
  rechecks = [];
  checks = 0;
  aiMode = "real";
  prompts = [];
  promptRejects = [];
  renderSettings(container, deps());
});

test("it shows the title, the note and a section list with the current value of each row", () => {
  expect(container.querySelector("h1")?.textContent).toBe("Settings");
  expect(container.querySelector(".settings-head .text")?.textContent).toBe(
    "Changes are saved at once.",
  );
  expect(rowText("Appearance")).toBe("Appearance System");
  expect(rowText("AI")).toMatch(/^AI \S/);
  expect(rowText("Data")).toMatch(/^Data \S/);
});

test("Appearance offers System, Light and Dark, and no other theme", () => {
  const labels = [...container.querySelectorAll(".choice-list-row label")].map(
    (l) => l.textContent,
  );
  expect(labels).toEqual(["System", "Light", "Dark"]);
  const checked = container.querySelector<HTMLInputElement>("input:checked");
  expect(checked?.value).toBe("system");
});

test("the Data section opens and has no controls", () => {
  openSection("Data");
  expect(container.querySelector(".settings-body h2")?.textContent).toBe(
    "Data",
  );
  expect(container.querySelectorAll(".settings-body input").length).toBe(0);
  expect(container.querySelectorAll(".settings-body button").length).toBe(0);
});

function openSection(name: string): void {
  const row = [...container.querySelectorAll("button.section-list-row")].find(
    (b) => b.querySelector(".section-list-name")?.textContent === name,
  ) as HTMLButtonElement;
  row.click();
}

function aiBody(): string {
  return (container.querySelector(".settings-body")?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function checkAgainButton(): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Check again"),
  );
  if (!button) throw new Error("no Check again button");
  return button as HTMLButtonElement;
}

test("the AI row shows the state of the first check without opening the section", async () => {
  renderSettings(container, deps());
  expect(rowText("AI")).toBe("AI Checking");
  await tick();
  expect(rowText("AI")).toBe("AI Ready");
});

test("the AI section shows the state, the fix message and a Check again button", async () => {
  firstHealth = [SIGNED_OUT];
  document.body.replaceChildren(container);
  renderSettings(container, deps());
  await tick();
  openSection("AI");
  expect(aiBody()).toContain("Not signed in");
  expect(aiBody()).toContain("Open a terminal and run `claude`.");
  expect(container.querySelectorAll(".settings-body .pill").length).toBe(1);
  expect(container.querySelectorAll(".settings-body button").length).toBe(1);
  expect(checkAgainButton().type).toBe("button");
});

test("every state has its own plain word on the row", async () => {
  const words = {
    ready: "Ready",
    not_installed: "Not installed",
    not_signed_in: "Not signed in",
    version_problem: "Version problem",
  } as const;
  for (const [state, word] of Object.entries(words)) {
    firstHealth = [{ state: state as AiHealth["state"], message: "m" }];
    renderSettings(container, deps());
    await tick();
    expect(rowText("AI")).toBe(`AI ${word}`);
  }
});

test("a first check that is still running shows Checking, then the result", async () => {
  vi.useFakeTimers();
  try {
    firstHealth = [null, null, SIGNED_OUT];
    renderSettings(container, deps());
    openSection("AI");
    await vi.advanceTimersByTimeAsync(0);
    expect(aiBody()).toContain("Mnemo is checking Claude Code.");
    expect(rowText("AI")).toBe("AI Checking");
    await vi.advanceTimersByTimeAsync(2000);
    expect(rowText("AI")).toBe("AI Not signed in");
    expect(aiBody()).toContain("Open a terminal");
  } finally {
    vi.useRealTimers();
  }
});

test("a first check that never ends stops at a plain line with Check again, not Checking", async () => {
  vi.useFakeTimers();
  try {
    firstHealth = [null];
    renderSettings(container, deps());
    openSection("AI");
    await vi.advanceTimersByTimeAsync(40_000);
    expect(rowText("AI")).toBe("AI Unknown");
    expect(aiBody()).toContain("still waiting for the Claude Code check");
    expect(aiBody()).not.toContain("Mnemo is checking Claude Code.");
    expect(checkAgainButton()).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});

test("Check again asks once, shows the new state and does not double submit", async () => {
  openSection("AI");
  await tick();
  rechecks = [SIGNED_OUT];
  const button = checkAgainButton();
  button.click();
  button.click();
  await tick();
  await tick();
  expect(checks).toBe(1);
  expect(rowText("AI")).toBe("AI Not signed in");
  expect(aiBody()).toContain("Open a terminal");
});

test("a check that cannot be asked for shows a plain line and keeps the button", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  openSection("AI");
  await tick();
  rechecks = [Object.assign(new Error("x"), { code: "boom", message: "No." })];
  checkAgainButton().click();
  await tick();
  await tick();
  expect(aiBody()).toContain("Mnemo could not check Claude Code.");
  expect(rowText("AI")).toBe("AI Unknown");
  expect(checkAgainButton().getAttribute("aria-busy")).toBeNull();
});

test("a first read that fails shows a plain line, never a Ready state", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  firstHealth = [new Error("x")];
  renderSettings(container, deps());
  openSection("AI");
  await tick();
  expect(aiBody()).toContain("Mnemo could not read the Claude Code check.");
  expect(aiBody()).not.toContain("Ready");
});

test("choosing a theme applies it at once, updates the row and saves it", async () => {
  pick("Dark");
  expect(applied).toEqual(["dark"]);
  expect(rowText("Appearance")).toBe("Appearance Dark");
  await tick();
  expect(saves).toEqual(["dark"]);
});

test("saves run one at a time, in the order of the choices", async () => {
  pick("Dark");
  pick("Light");
  pick("System");
  await tick();
  expect(saves).toEqual(["dark"]);
  release[0]?.();
  await tick();
  expect(saves).toEqual(["dark", "light"]);
  release[1]?.();
  await tick();
  expect(saves).toEqual(["dark", "light", "system"]);
  release[2]?.();
  await tick();
});

test("a failed save shows a plain line, keeps the theme applied and keeps the choices", async () => {
  failWith = {
    code: "storage",
    message: "The data file could not be written.",
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
  pick("Dark");
  await tick();
  await tick();
  const status = container.querySelector<HTMLElement>(".choice-list-error");
  expect(status?.hidden).toBe(false);
  expect(status?.textContent).toContain("could not save the theme");
  expect(status?.textContent).toContain("The data file could not be written.");
  expect(rowText("Appearance")).toBe("Appearance Dark");
  expect(container.querySelectorAll("input").length).toBe(3);
});

test("a later save that works clears the line", async () => {
  failWith = { code: "storage", message: "nope" };
  vi.spyOn(console, "error").mockImplementation(() => {});
  pick("Dark");
  await tick();
  await tick();
  failWith = undefined;
  pick("Light");
  await tick();
  release[0]?.();
  await tick();
  await tick();
  expect(
    container.querySelector<HTMLElement>(".choice-list-error")?.hidden,
  ).toBe(true);
});

test("a failed save after the owner left Settings is still reported", async () => {
  renderSettings(container, {
    ...deps(),
    onDetachedSave: (f) => detached.push(f),
  });
  failWith = { code: "storage", message: "disk full" };
  pick("Dark");
  container.replaceChildren();
  await tick();
  await tick();
  expect(detached).toHaveLength(1);
  expect(detached[0]).toContain("could not save the theme");
  expect(detached[0]).toContain("disk full");
});

test("clicking a section row keeps keyboard focus on that row", () => {
  renderSettings(container, deps());
  const row = [
    ...container.querySelectorAll<HTMLButtonElement>("button.section-list-row"),
  ].find((b) => b.querySelector(".section-list-name")?.textContent === "AI");
  if (!row) throw new Error("no AI row");
  row.focus();
  row.click();
  expect(document.activeElement).toBe(row);
  expect(row.getAttribute("aria-current")).toBe("true");
});

test("a good save while Settings is open clears an earlier detached failure", async () => {
  renderSettings(container, {
    ...deps(),
    onDetachedSave: (f) => detached.push(f),
  });
  await tick();
  detached.length = 0;
  pick("Light");
  await tick();
  release[0]?.();
  await tick();
  await tick();
  expect(detached).toEqual([null]);
});

test("the AI section shows the Fake AI banner first when the mode is fake", async () => {
  aiMode = "fake";
  document.body.replaceChildren(container);
  renderSettings(container, deps());
  await tick();
  openSection("AI");
  const banner = container.querySelector(".settings-body .banner");
  expect(banner?.textContent).toContain("Fake AI");
  expect(banner?.textContent).toContain(
    "answers are fixed test data, no Claude usage",
  );
  expect(banner?.classList.contains("banner-warn")).toBe(true);
  expect(
    container.querySelector(".settings-body .settings-card")?.children[1],
  ).toBe(banner);
});

test("the Fake AI banner shows up when the mode is read after the section opened", async () => {
  aiMode = "fake";
  document.body.replaceChildren(container);
  renderSettings(container, deps());
  openSection("AI");
  expect(container.querySelector(".settings-body .banner")).toBeNull();
  await tick();
  expect(container.querySelector(".settings-body .banner")).not.toBeNull();
});

test("the AI section shows no banner when the mode is real", async () => {
  document.body.replaceChildren(container);
  renderSettings(container, deps());
  await tick();
  openSection("AI");
  expect(container.querySelector(".settings-body .banner")).toBeNull();
});

test("the AI section shows no banner, and the failure is logged, when the mode cannot be read", async () => {
  aiMode = new Error("no mode");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  document.body.replaceChildren(container);
  renderSettings(container, deps());
  await tick();
  openSection("AI");
  expect(container.querySelector(".settings-body .banner")).toBeNull();
  expect(log).toHaveBeenCalled();
  log.mockRestore();
});

// ---- The developer test prompt ----

function sendButton(): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Send test prompt",
  );
}

async function openAi(): Promise<void> {
  await tick();
  openSection("AI");
}

test("the test prompt button is offered when AI is Ready", async () => {
  await openAi();
  expect(sendButton()).toBeDefined();
  expect(aiBody()).toContain("uses Claude usage");
});

test.each([
  ["not installed", { state: "not_installed", message: "Install it." }],
  ["not signed in", SIGNED_OUT],
] as const)(
  "with AI %s the button is hidden and the AI-off state shows",
  async (_name, health) => {
    firstHealth = [health];
    renderSettings(container, deps());
    await openAi();
    expect(sendButton()).toBeUndefined();
    expect(aiBody()).toContain("AI is off");
    expect(aiBody()).toContain("Links still save");
  },
);

test("with the fake AI the button is offered even when Claude Code is not Ready", async () => {
  aiMode = "fake";
  firstHealth = [SIGNED_OUT];
  renderSettings(container, deps());
  await openAi();
  expect(sendButton()).toBeDefined();
  expect(aiBody()).not.toContain("AI is off");
});

test("while the test prompt runs, the button is busy, the busy line shows and a second click is ignored", async () => {
  await openAi();
  sendButton()?.click();
  sendButton()?.click();
  expect(prompts.length).toBe(1);
  expect(sendButton()?.getAttribute("aria-busy")).toBe("true");
  expect(
    container.querySelector(".settings-body [role=status].busy-line")
      ?.textContent,
  ).toBe("Waiting for Claude…");
});

test("a good answer shows the text, the Written by AI label and the time", async () => {
  await openAi();
  sendButton()?.click();
  prompts[0]?.({ answer: "Hello there.", durationMs: 1234 });
  await tick();
  expect(aiBody()).toContain("Hello there.");
  expect(aiBody()).toContain("Written by AI");
  expect(aiBody()).toContain("Answered in 1.2 s.");
  expect(aiBody()).not.toContain("Waiting for Claude");
  // The button is back for another try.
  expect(sendButton()?.getAttribute("aria-busy")).not.toBe("true");
});

test("a failure shows the bad banner with what happened, that nothing changed, the next step and a Guess label", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await openAi();
  sendButton()?.click();
  promptRejects[0]?.({
    code: "exit_error",
    message: "Claude Code stopped with an error.",
  });
  await tick();
  const alert = container.querySelector(".settings-body [role=alert]");
  expect(alert?.textContent).toContain("Test prompt failed.");
  expect(alert?.textContent).toContain("Claude Code stopped with an error.");
  expect(alert?.textContent).toContain("Nothing changed.");
  expect(alert?.textContent).toContain("Check again");
  expect(aiBody()).toContain("Guess");
  log.mockRestore();
});

test("a failure that is not from the core still gives a plain banner", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await openAi();
  sendButton()?.click();
  promptRejects[0]?.(new Error("boom"));
  await tick();
  expect(container.querySelector(".settings-body [role=alert]")).not.toBeNull();
  expect(aiBody()).not.toContain("boom");
  log.mockRestore();
});

test("the usage limit shows the limit state instead of the button, and Check again brings the button back", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await openAi();
  sendButton()?.click();
  promptRejects[0]?.({ code: "usage_limit", message: "At the limit." });
  await tick();
  expect(sendButton()).toBeUndefined();
  expect(aiBody()).toContain("At usage limit");
  expect(aiBody()).toContain("Links still save");
  checkAgainButton().click();
  await tick();
  await tick();
  expect(sendButton()).toBeDefined();
  log.mockRestore();
});
