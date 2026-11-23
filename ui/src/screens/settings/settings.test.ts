// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Theme } from "../../frame/theme";
import type {
  AiControlView,
  AiHealth,
  AiMode,
  AiModelTable,
  DataFolderInfo,
  ExportSummary,
  TestPromptResult,
} from "../../shared/api";
import {
  RESET_RESTART_MS,
  renderSettings,
  resetTestPromptForTests,
  type SettingsDeps,
} from "./settings";

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
let control: AiControlView;
let controlReads: number;

const CONTROL_ON: AiControlView = {
  enabled: true,
  warnAt: 60,
  pauseAt: 95,
  pause: null,
  backgroundGate: { kind: "allow" },
  warn: false,
  usage: { kind: "runs", today: 2, week: 7 },
};

let pickResult: string | null;
let picks: number;
let exportCalls: string[];
let exportResult: Array<(value: ExportSummary | Error) => void>;
let resetCalls: string[];
let resetFails: Error | null;
let opens: number;
let afterResets: number;
let afterResetFlags: boolean[];

const INFO: DataFolderInfo = {
  path: "/home/ana/.local/share/io.mnemo.desktop",
  macosCommand: 'cp -Rp "/home/ana/x" ~/mnemo-backup-$(date +%Y-%m-%d)',
  ubuntuCommand: 'cp -a "/home/ana/x" ~/mnemo-backup-$(date +%Y-%m-%d)',
};
const SUMMARY: ExportSummary = {
  folder: "/home/ana/Out/mnemo-export-20261121-120000",
  counts: {
    notes: 3,
    bookmarks: 2,
    ideas: 0,
    projects: 0,
    tasks: 0,
    events: 0,
    runs: 0,
    memories: 0,
    labels: 1,
    links: 0,
    files: 0,
  },
  filesMissing: 0,
};

const READY: AiHealth = { state: "ready", message: "Claude Code is ready." };
const SIGNED_OUT: AiHealth = {
  state: "not_signed_in",
  message: "Open a terminal and run `claude`.",
};

const MODEL_TABLE: AiModelTable = {
  rows: [
    { feature: "save", label: "Save a link", model: "haiku", effort: "low" },
  ],
  models: [{ value: "haiku", label: "Haiku 5.5" }],
  efforts: [{ value: "low", label: "Low effort" }],
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
    aiControl: {
      getAiControl: async () => {
        controlReads += 1;
        return control;
      },
      setAiEnabled: async (on) => {
        control = { ...control, enabled: on };
        return control;
      },
      setAiThresholds: async (warnAt, pauseAt) => {
        control = { ...control, warnAt, pauseAt };
        return control;
      },
      pauseBackground: async () => {
        control = {
          ...control,
          pause: { reason: "owner", until: null },
          backgroundGate: { kind: "deny", reason: "owner_pause" },
        };
        return control;
      },
      resumeAi: async () => {
        control = {
          ...control,
          pause: null,
          backgroundGate: { kind: "allow" },
        };
        return control;
      },
    },
    listAiModels: async () => MODEL_TABLE,
    setAiModel: async () => MODEL_TABLE,
    resetAiModels: async () => MODEL_TABLE,
    pickFolder: async () => {
      picks += 1;
      return pickResult;
    },
    exportData: (folder) =>
      new Promise<ExportSummary>((done, fail) => {
        exportCalls.push(folder);
        exportResult.push((v) => (v instanceof Error ? fail(v) : done(v)));
      }),
    resetData: async (word) => {
      resetCalls.push(word);
      if (resetFails) throw resetFails;
    },
    dataFolderInfo: async () => INFO,
    openDataFolder: async () => {
      opens += 1;
    },
    afterReset: (complete) => {
      afterResets += 1;
      afterResetFlags.push(complete);
    },
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
  resetTestPromptForTests();
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
  control = CONTROL_ON;
  controlReads = 0;
  pickResult = "/home/ana/Out";
  picks = 0;
  exportCalls = [];
  exportResult = [];
  resetCalls = [];
  resetFails = null;
  opens = 0;
  afterResets = 0;
  afterResetFlags = [];
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

function dataButton(label: string): HTMLButtonElement {
  const b = [...container.querySelectorAll(".settings-body button")].find(
    (x) => x.textContent?.trim() === label,
  );
  if (!b) throw new Error(`no ${label} button`);
  return b as HTMLButtonElement;
}

function dialogButton(label: string): HTMLButtonElement {
  const b = [...document.querySelectorAll("dialog button")].find(
    (x) => x.textContent?.trim() === label,
  );
  if (!b) throw new Error(`no dialog ${label} button`);
  return b as HTMLButtonElement;
}

function typeWord(word: string): void {
  const input = document
    .querySelector("dialog")
    ?.querySelector("input") as HTMLInputElement;
  input.value = word;
  input.dispatchEvent(new Event("input"));
}

function openReset(): void {
  dataButton("Reset all data").click();
}

test("the Data section shows the path and both commands as text, and no Back up now", async () => {
  openSection("Data");
  await tick();
  const text = aiBody();
  expect(text).toContain(INFO.path);
  expect(text).toContain("Close Mnemo first");
  expect(text).toContain(INFO.macosCommand);
  expect(text).toContain(INFO.ubuntuCommand);
  expect(text).not.toMatch(/back up now/i);
  expect(container.querySelector(".settings-body h2")?.textContent).toBe(
    "Data",
  );
});

test("Reset stays disabled until RESET is typed exactly, and Cancel never resets", async () => {
  openSection("Data");
  await tick();
  openReset();
  const confirm = dialogButton("Reset all data");
  for (const word of ["", "reset", "RESET "]) {
    typeWord(word);
    expect(confirm.disabled).toBe(true);
  }
  typeWord("RESET");
  expect(confirm.disabled).toBe(false);
  dialogButton("Cancel").click();
  await tick();
  expect(resetCalls).toEqual([]);
  expect(afterResets).toBe(0);
});

test("a confirmed reset runs once with RESET, then starts the app over", async () => {
  openSection("Data");
  await tick();
  openReset();
  typeWord("RESET");
  dialogButton("Reset all data").click();
  await tick();
  await tick();
  expect(resetCalls).toEqual(["RESET"]);
  expect(aiBody()).toContain("All data was deleted");
  expect(afterResets).toBe(0);
  await new Promise((done) => setTimeout(done, RESET_RESTART_MS + 50));
  expect(afterResets).toBe(1);
  expect(afterResetFlags).toEqual([true]);
});

test("a failed reset shows a message and does not start the app over", async () => {
  resetFails = new Error("disk is full");
  openSection("Data");
  await tick();
  openReset();
  typeWord("RESET");
  dialogButton("Reset all data").click();
  await tick();
  await tick();
  expect(afterResets).toBe(0);
  expect(aiBody()).toContain("Mnemo could not reset your data");
});

test("a reset that failed part way reloads the app so no stale data stays on screen", async () => {
  resetFails = Object.assign(new Error("x"), {
    code: "reset_failed",
    message: "Mnemo could not delete everything.",
  });
  openSection("Data");
  await tick();
  openReset();
  typeWord("RESET");
  dialogButton("Reset all data").click();
  await tick();
  await tick();
  expect(aiBody()).toContain("Mnemo could not reset your data");
  expect(afterResets).toBe(0);
  await new Promise((done) => setTimeout(done, RESET_RESTART_MS + 50));
  expect(afterResets).toBe(1);
  expect(afterResetFlags).toEqual([false]);
});

test("the Reset dialog says what is deleted, that no backup is made, and points to Export", async () => {
  openSection("Data");
  await tick();
  openReset();
  const text = document.querySelector("dialog")?.textContent ?? "";
  expect(text).toMatch(/deletes the Mnemo database/i);
  expect(text).toMatch(/error log and the AI run output are kept/i);
  expect(text).toMatch(/no backup/i);
  expect(text).toMatch(/Export/);
  expect(text).toMatch(/settings/i);
  expect(resetCalls).toEqual([]);
});

test("Export picks a folder, shows pending, blocks a second click, then names the folder and counts", async () => {
  openSection("Data");
  await tick();
  dataButton("Export").click();
  await tick();
  expect(exportCalls).toEqual(["/home/ana/Out"]);
  expect(aiBody()).toContain("Exporting...");
  const busy = container.querySelector(".settings-body [aria-busy=true]");
  expect(busy).not.toBeNull();
  (busy as HTMLButtonElement).click();
  await tick();
  expect(picks).toBe(1);
  exportResult[0]?.(SUMMARY);
  await tick();
  expect(aiBody()).toContain("Exported.");
  expect(aiBody()).toContain(SUMMARY.folder);
  expect(aiBody()).toContain("3 notes, 2 links, 1 label");
});

test("Export shows an error line when it fails", async () => {
  openSection("Data");
  await tick();
  dataButton("Export").click();
  await tick();
  exportResult[0]?.(new Error("no space"));
  await tick();
  expect(aiBody()).toContain("Mnemo could not export your data");
});

test("cancelling the folder dialog exports nothing and shows nothing", async () => {
  pickResult = null;
  openSection("Data");
  await tick();
  dataButton("Export").click();
  await tick();
  expect(exportCalls).toEqual([]);
  expect(aiBody()).not.toContain("Exporting");
  expect(dataButton("Export").getAttribute("aria-busy")).toBeNull();
});

test("Open data folder asks the core to open it", async () => {
  openSection("Data");
  await tick();
  dataButton("Open data folder").click();
  await tick();
  expect(opens).toBe(1);
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
  // The Claude Code check card (the first card) has one pill and one button; the AI control
  // card and the model table below it have their own controls (#23, #24).
  expect(
    container.querySelectorAll(".settings-body > :first-child .pill").length,
  ).toBe(1);
  expect(
    container.querySelectorAll(".settings-body > :first-child button").length,
  ).toBe(1);
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

test("leaving Settings during a run and coming back shows it still running, and its answer then shows", async () => {
  await openAi();
  sendButton()?.click();
  // The owner goes to another screen and comes back: Settings is drawn again from scratch.
  container = document.createElement("main");
  document.body.replaceChildren(container);
  renderSettings(container, deps());
  await openAi();
  expect(sendButton()?.getAttribute("aria-busy")).toBe("true");
  sendButton()?.click();
  expect(prompts.length).toBe(1);
  prompts[0]?.({ answer: "Hello again.", durationMs: 900 });
  await tick();
  expect(aiBody()).toContain("Hello again.");
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

// ---- AI control (#23) ----

function aiSwitch(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>("button[role=switch]");
}

test("the AI section shows the AI switch, the Mnemo run count and the label of which number is shown", async () => {
  await openAi();
  await tick();
  expect(aiSwitch()?.getAttribute("aria-checked")).toBe("true");
  expect(aiBody()).toContain("AI control");
  expect(aiBody()).toContain("2 today, 7 this week");
  expect(aiBody()).toContain(
    "Shown: Mnemo runs, because the Claude usage percent was not read yet.",
  );
});

test("turning the AI switch off shows AI is off, and the test prompt shows why instead of its button", async () => {
  await openAi();
  await tick();
  expect(sendButton()).toBeDefined();
  expect(aiBody()).not.toContain("AI is off now.");
  aiSwitch()?.click();
  await tick();
  await tick();
  expect(aiSwitch()?.getAttribute("aria-checked")).toBe("false");
  expect(aiBody()).toContain("AI is off");
  expect(aiBody()).toContain("The test prompt does not run while AI is off.");
  expect(sendButton()).toBeUndefined();
  // The model table below agrees: its off note shows too (#24).
  expect(aiBody()).toContain("AI is off now.");
});

test("with background work paused by the owner, the pause banner shows and the test prompt is still offered", async () => {
  control = {
    ...CONTROL_ON,
    pause: { reason: "owner", until: null },
    backgroundGate: { kind: "deny", reason: "owner_pause" },
  };
  renderSettings(container, deps());
  await openAi();
  await tick();
  expect(aiBody()).toContain(
    "Background work is paused by you. Your own tasks still run.",
  );
  expect(sendButton()).toBeDefined();
});

test("at the usage limit pause the test prompt waits and the limit state shows once", async () => {
  control = {
    ...CONTROL_ON,
    pause: { reason: "limit", until: null },
    backgroundGate: { kind: "deny", reason: "limit" },
  };
  renderSettings(container, deps());
  await openAi();
  await tick();
  expect(sendButton()).toBeUndefined();
  expect(aiBody()).toContain(
    "The test prompt waits while Mnemo holds AI work at the usage limit.",
  );
  expect(container.querySelectorAll(".state-box")).toHaveLength(1);
});

test("a test prompt refused because AI is off shows the core's reason and the next step, then reads the AI control again", async () => {
  await openAi();
  await tick();
  const before = controlReads;
  sendButton()?.click();
  promptRejects[0]?.({
    code: "ai_off",
    message: "AI is off, so this did not run. Turn AI on in Settings > AI.",
  });
  await tick();
  await tick();
  expect(aiBody()).toContain("AI is off, so this did not run.");
  expect(aiBody()).toContain("Turn AI on above, then try again.");
  expect(controlReads).toBeGreaterThan(before);
});
