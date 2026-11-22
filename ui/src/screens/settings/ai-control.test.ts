// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import type { AiControlView, DayBounds } from "../../shared/api";
import {
  type AiControlDeps,
  type AiControlSection,
  checkThresholds,
  dayBounds,
  NOT_A_LINE,
  READING_LABEL,
  RUNS_LABEL,
  readAgo,
  resetPhrase,
  startAiControl,
  WARN_NOT_BELOW,
} from "./ai-control";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

// Monday 23 November 2026, 10:30 local time.
const NOW = new Date(2026, 10, 23, 10, 30, 0);
const NOW_S = Math.floor(NOW.getTime() / 1000);
const HOUR = 3600;

function view(over: Partial<AiControlView> = {}): AiControlView {
  return {
    enabled: true,
    warnAt: 60,
    pauseAt: 95,
    pause: null,
    backgroundGate: { kind: "allow" },
    warn: false,
    usage: { kind: "runs", today: 4, week: 19 },
    ...over,
  };
}

function reading(five: number | null, seven: number | null) {
  const w = (p: number | null) =>
    p === null
      ? null
      : { percent: p, resetsAt: NOW_S + 3 * HOUR, status: "allowed" };
  return {
    kind: "reading" as const,
    readAt: NOW_S - 2 * HOUR,
    fiveHour: w(five),
    sevenDay: w(seven),
  };
}

let host: HTMLElement;
let current: AiControlView;
let calls: Array<{ cmd: string; args: unknown[] }>;
let fail: Error | null;
let hold: Array<() => void>;
let fire: (() => void) | null;
let unlistened: number;
let section: AiControlSection;

function deps(): AiControlDeps {
  const answer = (
    cmd: string,
    args: unknown[],
    next?: Partial<AiControlView>,
  ) =>
    new Promise<AiControlView>((done, bad) => {
      calls.push({ cmd, args });
      const finish = () => {
        if (fail) bad({ code: "storage_error", message: fail.message });
        else {
          current = { ...current, ...next };
          done(current);
        }
      };
      if (hold.length === 0) finish();
      else hold.push(finish);
    });
  return {
    getAiControl: (b: DayBounds) => answer("get", [b]),
    setAiEnabled: (on, b) => answer("enabled", [on, b], { enabled: on }),
    setAiThresholds: (w, p, b) =>
      answer("thresholds", [w, p, b], { warnAt: w, pauseAt: p }),
    pauseBackground: (b) =>
      answer("pause", [b], {
        pause: { reason: "owner", until: null },
        backgroundGate: { kind: "deny", reason: "owner_pause" },
      }),
    resumeAi: (b) =>
      answer("resume", [b], { pause: null, backgroundGate: { kind: "allow" } }),
    onAiControl: async (handler) => {
      fire = handler;
      return () => {
        unlistened += 1;
      };
    },
    now: () => NOW,
  };
}

const tick = () => new Promise((done) => setTimeout(done, 0));

async function open(start: AiControlView): Promise<void> {
  current = start;
  section = startAiControl(
    deps(),
    () => host.replaceChildren(...section.render(document)),
    () => host.isConnected,
  );
  await tick();
  await tick();
}

const text = () => (host.textContent ?? "").replace(/\s+/g, " ").trim();
const theSwitch = () =>
  host.querySelector<HTMLButtonElement>("button[role=switch]");
const buttons = (label: string) =>
  [...host.querySelectorAll("button")].filter(
    (b) => b.textContent?.trim() === label,
  );
const banners = () =>
  [...host.querySelectorAll("[role=status]")].map((b) =>
    (b.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
const numberInputs = () =>
  [...host.querySelectorAll<HTMLInputElement>("input")].filter(
    (i) => i.inputMode === "numeric",
  );
const errorOf = (input: HTMLInputElement): string | null => {
  if (input.getAttribute("aria-invalid") !== "true") return null;
  const id = input.getAttribute("aria-describedby") ?? "";
  return document.getElementById(id)?.textContent?.trim() ?? null;
};
const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const commit = (input: HTMLInputElement) =>
  input.dispatchEvent(new Event("change", { bubbles: true }));

beforeEach(() => {
  host = document.createElement("main");
  document.body.replaceChildren(host);
  calls = [];
  fail = null;
  hold = [];
  fire = null;
  unlistened = 0;
});

test("the switch named AI shows the core's value and turning it off asks the core once", async () => {
  await open(view());
  const sw = theSwitch();
  expect(sw?.getAttribute("aria-label")).toBe("AI");
  expect(sw?.getAttribute("aria-checked")).toBe("true");
  expect(text()).toContain("When off, nothing new starts.");
  sw?.click();
  await tick();
  expect(calls.filter((c) => c.cmd === "enabled")).toEqual([
    { cmd: "enabled", args: [false, dayBounds(NOW)] },
  ]);
  expect(theSwitch()?.getAttribute("aria-checked")).toBe("false");
  expect(text()).toContain("AI is off");
});

test("a switch save that fails re-creates the switch with the old value and shows the error in place", async () => {
  await open(view());
  fail = new Error("Mnemo could not save the AI setting. Nothing changed.");
  theSwitch()?.click();
  await tick();
  const sw = theSwitch();
  expect(sw?.getAttribute("aria-checked")).toBe("true");
  expect(sw?.getAttribute("aria-invalid")).toBe("true");
  expect(text()).toContain("Mnemo could not turn AI off.");
  expect(text()).not.toContain("AI is off");
});

test("the switch is disabled while its save runs, so a second click does nothing", async () => {
  await open(view());
  // A non-empty hold list keeps the next answer pending.
  hold = [() => {}];
  theSwitch()?.click();
  await tick();
  expect(theSwitch()?.disabled).toBe(true);
  theSwitch()?.click();
  expect(calls.filter((c) => c.cmd === "enabled")).toHaveLength(1);
});

test("with a reading, the usage meter shows both windows marked Unverified and the label says which number", async () => {
  await open(view({ usage: reading(64, 41), warn: true }));
  expect(text()).toContain(READING_LABEL);
  expect(text()).toContain("5-hour window");
  expect(text()).toContain("7-day window");
  expect(text()).toContain("64% (Unverified)");
  expect(text()).toContain("41% (Unverified)");
  expect(text()).toContain("Read 2 h ago.");
  expect(text()).toContain("13:30 today");
  expect(text()).not.toContain(RUNS_LABEL);
  expect(host.querySelectorAll("[role=meter]")).toHaveLength(2);
});

test("with no reading, the run count shows Mnemo runs today and this week and the label says which number", async () => {
  await open(view());
  expect(text()).toContain(RUNS_LABEL);
  expect(text()).toContain("4 today, 19 this week");
  expect(text()).not.toContain(READING_LABEL);
  expect(host.querySelectorAll("[role=meter]")).toHaveLength(0);
});

test("a usage window that has reset shows No reading, never an old percent", async () => {
  const usage = reading(97, 30);
  if (usage.fiveHour) usage.fiveHour.percent = null as unknown as number;
  await open(view({ usage }));
  expect(text()).toContain("No reading");
  expect(text()).not.toContain("97");
});

test("at the warn line a warn banner shows the usage and the owner's warn line; below it no banner shows", async () => {
  await open(
    view({ warnAt: 50, pauseAt: 90, warn: true, usage: reading(64, 41) }),
  );
  expect(banners()).toEqual([
    "Usage is at 64% (Unverified), at or above your warn line of 50%.",
  ]);
  host.replaceChildren();
  await open(view({ warnAt: 50, pauseAt: 90, usage: reading(30, 20) }));
  expect(banners()).toEqual([]);
});

test("at the pause line the threshold pause banner shows, owner tasks still run, and the button offers to pause", async () => {
  await open(
    view({
      warn: true,
      usage: reading(96, 40),
      backgroundGate: { kind: "deny", reason: "threshold" },
    }),
  );
  expect(banners()).toEqual([
    "Background work is paused: usage is at or above your pause line of 95%. Your own tasks still run.",
  ]);
  expect(buttons("Pause background work")).toHaveLength(1);
  expect(buttons("Resume")).toHaveLength(0);
});

test("pause background work asks the core, shows the owner pause banner and one Resume control", async () => {
  await open(view());
  expect(buttons("Resume")).toHaveLength(0);
  buttons("Pause background work")[0]?.click();
  await tick();
  expect(calls.map((c) => c.cmd)).toContain("pause");
  expect(banners()).toEqual([
    "Background work is paused by you. Your own tasks still run.",
  ]);
  expect(buttons("Resume")).toHaveLength(1);
  buttons("Resume")[0]?.click();
  await tick();
  expect(calls.map((c) => c.cmd)).toContain("resume");
  expect(banners()).toEqual([]);
  expect(buttons("Pause background work")).toHaveLength(1);
});

test("the pause control is busy while its command runs and ignores a second click", async () => {
  await open(view());
  hold = [() => {}];
  buttons("Pause background work")[0]?.click();
  await tick();
  const busy = host.querySelector<HTMLButtonElement>("button[aria-busy=true]");
  expect(busy).not.toBeNull();
  busy?.click();
  expect(calls.filter((c) => c.cmd === "pause")).toHaveLength(1);
});

test("after a limit error with a stored reset time the limit pause state shows that time and holds owner tasks too", async () => {
  await open(
    view({
      pause: { reason: "limit", until: NOW_S + 3 * HOUR },
      backgroundGate: { kind: "deny", reason: "limit" },
    }),
  );
  expect(text()).toContain("At usage limit");
  expect(text()).toContain("until 13:30 today");
  expect(text()).toContain("Your own AI tasks are held too.");
  expect(buttons("Resume")).toHaveLength(1);
  expect(buttons("Pause background work")).toHaveLength(0);
});

test("after a limit error with no reset time the limit pause state shows no time and says only Resume lifts it", async () => {
  await open(
    view({
      pause: { reason: "limit", until: null },
      backgroundGate: { kind: "deny", reason: "limit" },
    }),
  );
  const box = host.querySelector(".state-box")?.textContent ?? "";
  expect(box).toContain("At usage limit");
  expect(box).not.toMatch(/\d{1,2}[:.]\d{2}/);
  expect(text()).toContain("AI stays paused until you choose Resume");
  buttons("Resume")[0]?.click();
  await tick();
  expect(calls.map((c) => c.cmd)).toContain("resume");
});

test("with the switch off the AI is off state shows and no pause control", async () => {
  await open(
    view({ enabled: false, backgroundGate: { kind: "deny", reason: "off" } }),
  );
  expect(text()).toContain("AI is off");
  expect(theSwitch()?.getAttribute("aria-checked")).toBe("false");
  expect(buttons("Pause background work")).toHaveLength(0);
});

test("threshold field errors show in place on every input, clear when fixed, and a bad value is never saved", async () => {
  await open(view());
  const [warn, pause] = numberInputs();
  if (!warn || !pause) throw new Error("no threshold fields");
  expect([warn.value, pause.value]).toEqual(["60", "95"]);
  for (const bad of ["0", "101", "12.5", "abc", "95"]) {
    type(warn, bad);
    expect(errorOf(warn)).toBe(bad === "95" ? WARN_NOT_BELOW : NOT_A_LINE);
    commit(warn);
    await tick();
  }
  expect(calls.filter((c) => c.cmd === "thresholds")).toEqual([]);
  type(warn, "70");
  expect(errorOf(warn)).toBeNull();
  type(pause, "");
  expect(errorOf(pause)).toBe(NOT_A_LINE);
  type(pause, "95");
  expect(errorOf(pause)).toBeNull();
});

test("a good threshold change is saved when the field is left; a core rejection shows in place", async () => {
  await open(view());
  let [warn] = numberInputs();
  if (!warn) throw new Error("no warn field");
  type(warn, "50");
  commit(warn);
  await tick();
  expect(calls.filter((c) => c.cmd === "thresholds")).toEqual([
    { cmd: "thresholds", args: [50, 95, dayBounds(NOW)] },
  ]);
  expect(numberInputs()[0]?.value).toBe("50");
  fail = new Error("Warn and pause must be whole numbers from 1 to 100.");
  [warn] = numberInputs();
  if (!warn) throw new Error("no warn field");
  type(warn, "40");
  commit(warn);
  await tick();
  const shown = numberInputs()[0];
  if (!shown) throw new Error("no warn field");
  expect(shown.value).toBe("40");
  expect(errorOf(shown)).toContain("Warn and pause must be whole numbers");
});

test("the core's ai-control event reads the view again, and a closed screen stops listening", async () => {
  await open(view());
  current = { ...current, enabled: false };
  fire?.();
  await tick();
  expect(text()).toContain("AI is off");
  host.remove();
  fire?.();
  expect(unlistened).toBe(1);
});

test("a view that cannot be read shows a plain line instead of the controls", async () => {
  fail = new Error("Mnemo could not read its settings.");
  await open(view());
  expect(text()).toContain("Mnemo could not read the AI settings.");
  expect(theSwitch()).toBeNull();
});

test("dayBounds gives local midnight and local Monday; on a Sunday the week began six days before", () => {
  expect(dayBounds(NOW)).toEqual({
    todayStart: new Date(2026, 10, 23).getTime() / 1000,
    weekStart: new Date(2026, 10, 23).getTime() / 1000,
  });
  const sunday = new Date(2026, 10, 29, 22, 0);
  expect(dayBounds(sunday)).toEqual({
    todayStart: new Date(2026, 10, 29).getTime() / 1000,
    weekStart: new Date(2026, 10, 23).getTime() / 1000,
  });
});

test("reset times and reading ages are plain local words, never a guess", () => {
  const at = (d: Date) => Math.floor(d.getTime() / 1000);
  expect(resetPhrase(at(new Date(2026, 10, 23, 14, 5)), NOW)).toBe(
    "14:05 today",
  );
  expect(resetPhrase(at(new Date(2026, 10, 24, 9, 0)), NOW)).toBe(
    "09:00 tomorrow",
  );
  expect(resetPhrase(at(new Date(2026, 10, 26, 18, 0)), NOW)).toBe(
    "Thursday 18:00",
  );
  expect(resetPhrase(at(new Date(2026, 10, 30, 8, 0)), NOW)).toBe(
    "Monday 30 November 08:00",
  );
  expect(readAgo(NOW_S - 20, NOW)).toBe("just now");
  expect(readAgo(NOW_S - 300, NOW)).toBe("5 min ago");
  expect(readAgo(NOW_S - 2 * HOUR, NOW)).toBe("2 h ago");
  expect(readAgo(NOW_S - 50 * HOUR, NOW)).toBe("2 days ago");
});

test("the threshold rule matches the core: whole numbers 1 to 100, warn lower than pause", () => {
  expect(checkThresholds("60", "95")).toEqual({ warn: null, pause: null });
  expect(checkThresholds("1", "100")).toEqual({ warn: null, pause: null });
  expect(checkThresholds("95", "60").warn).toBe(WARN_NOT_BELOW);
  expect(checkThresholds("60", "60").warn).toBe(WARN_NOT_BELOW);
  expect(checkThresholds("0", "95").warn).toBe(NOT_A_LINE);
  expect(checkThresholds("60", "101").pause).toBe(NOT_A_LINE);
  expect(checkThresholds(" 7 ", "8")).toEqual({ warn: null, pause: null });
  expect(checkThresholds("1e2", "95").warn).toBe(NOT_A_LINE);
});
