// Settings > AI control (#23): the master switch, the usage (the last reading, marked Unverified,
// or Mnemo's own run count, with a line that says which), the warn and pause lines, and one
// Pause/Resume control. Every part comes from ui/src/ds; the screen adds no style. The core is the
// source of truth: every command returns the new view, and the `ai-control` event asks for it
// again. Time words (how old the reading is, when a window resets, local midnight and Monday) are
// worked out here, in the UI.

import {
  buildAiOffState,
  buildBanner,
  buildRunCount,
  buildText,
  buildUsageWindows,
  createButton,
  createField,
  createTextInput,
  createToggle,
  setButtonBusy,
  setFieldError,
  type UsageWindow,
} from "../../ds";
import {
  type AiControlView,
  type AiDenyReason,
  type AiGate,
  type AiUsageWindow,
  type DayBounds,
  errorMessage,
  getAiControl,
  onAiControl,
  pauseBackground,
  resumeAi,
  setAiEnabled,
  setAiThresholds,
} from "../../shared/api";

/** The AI control commands the section calls. Tests pass fakes. */
export interface AiControlDeps {
  getAiControl(bounds: DayBounds): Promise<AiControlView>;
  setAiEnabled(on: boolean, bounds: DayBounds): Promise<AiControlView>;
  setAiThresholds(
    warn: number,
    pause: number,
    bounds: DayBounds,
  ): Promise<AiControlView>;
  pauseBackground(bounds: DayBounds): Promise<AiControlView>;
  resumeAi(bounds: DayBounds): Promise<AiControlView>;
  /** Calls `handler` after each change in the core; resolves to the unsubscribe call. */
  onAiControl?(handler: () => void): Promise<() => void>;
  /** The time now. Tests pass a fixed one. */
  now?(): Date;
}

/** The real commands. */
export const AI_CONTROL_COMMANDS: AiControlDeps = {
  getAiControl,
  setAiEnabled,
  setAiThresholds,
  pauseBackground,
  resumeAi,
  onAiControl,
};

/** The switch's hint, under it. */
export const SWITCH_HINT =
  "When off, nothing new starts. Runs already going finish; waiting runs are cancelled.";
/** The line that says which number is shown. */
export const READING_LABEL =
  "Shown: Claude usage percent from the last run (Unverified).";
export const RUNS_LABEL =
  "Shown: Mnemo runs, because the Claude usage percent was not read yet.";
export const PAUSE_LABEL = "Pause background work";
export const RESUME_LABEL = "Resume";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Local midnight today and local Monday 00:00 of this week, as Unix seconds. */
export function dayBounds(now: Date): DayBounds {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // getDay: 0 is Sunday. The week starts on Monday.
  const back = (today.getDay() + 6) % 7;
  const monday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - back,
  );
  return {
    todayStart: Math.floor(today.getTime() / 1000),
    weekStart: Math.floor(monday.getTime() / 1000),
  };
}

const two = (n: number): string => String(n).padStart(2, "0");

/**
 * A verified reset time as a full phrase in local time: "14:30 today", "14:30 tomorrow",
 * "Thursday 14:30", or with the date when it is a week or more away.
 */
export function resetPhrase(unixSeconds: number, now: Date): string {
  const at = new Date(unixSeconds * 1000);
  const clock = `${two(at.getHours())}:${two(at.getMinutes())}`;
  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(at) - startOf(now)) / 86_400_000);
  if (days === 0) return `${clock} today`;
  if (days === 1) return `${clock} tomorrow`;
  const weekday = WEEKDAYS[at.getDay()];
  if (days > 1 && days < 7) return `${weekday} ${clock}`;
  return `${weekday} ${at.getDate()} ${MONTHS[at.getMonth()]} ${clock}`;
}

/** How old a reading is, in plain words: "just now", "5 min ago", "2 h ago", "3 days ago". */
export function readAgo(readAt: number, now: Date): string {
  const secs = Math.max(0, Math.floor(now.getTime() / 1000) - readAt);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)} h ago`;
  const days = Math.floor(secs / 86_400);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** The plain errors of the two threshold fields; null when a field is fine. */
export interface ThresholdErrors {
  warn: string | null;
  pause: string | null;
}

export const NOT_A_LINE = "Use a whole number from 1 to 100.";
export const WARN_NOT_BELOW =
  "The warn line must be lower than the pause line.";

/** A whole number 1 to 100 typed as digits, or null. */
function parseLine(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 100 ? n : null;
}

/** The core's rule: whole numbers 1 to 100, warn lower than pause. */
export function checkThresholds(warn: string, pause: string): ThresholdErrors {
  const w = parseLine(warn);
  const p = parseLine(pause);
  return {
    warn:
      w === null ? NOT_A_LINE : p !== null && w >= p ? WARN_NOT_BELOW : null,
    pause: p === null ? NOT_A_LINE : null,
  };
}

/** The reason the gate gives a background task, or null when it allows it. */
export function gateReason(gate: AiGate | unknown): AiDenyReason | null {
  if (typeof gate !== "object" || gate === null) return null;
  const g = gate as { kind?: unknown; reason?: unknown };
  return g.kind === "deny" && typeof g.reason === "string"
    ? (g.reason as AiDenyReason)
    : null;
}

/** The higher percent of the two windows that still count, or null. */
export function usageLevel(view: AiControlView): number | null {
  if (view.usage.kind !== "reading") return null;
  const percents = [view.usage.fiveHour, view.usage.sevenDay]
    .map((w) => w?.percent)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p));
  return percents.length > 0 ? Math.max(...percents) : null;
}

/** True for a value shaped like an AiControlView (the core's answer is checked, not trusted). */
export function isAiControlView(value: unknown): value is AiControlView {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<AiControlView>;
  return (
    typeof v.enabled === "boolean" &&
    typeof v.warnAt === "number" &&
    typeof v.pauseAt === "number" &&
    typeof v.usage === "object" &&
    v.usage !== null
  );
}

/** What the section shows while the view is not known yet. */
type Load =
  | { kind: "loading" }
  | { kind: "ready"; view: AiControlView }
  | { kind: "failed"; text: string };

export interface AiControlSection {
  /** The nodes of the section, built from the current state. */
  render(doc: Document): Node[];
  /** The view from the core, or null while it is not known. */
  view(): AiControlView | null;
  /** Reads the view again. */
  refresh(): Promise<void>;
  /** Stops listening to the core. */
  dispose(): void;
}

/**
 * The AI control section. `redraw` is called whenever the section's nodes must be built again
 * (the caller decides whether the section is on screen).
 */
export function createAiControlSection(
  deps: AiControlDeps,
  redraw: () => void,
): AiControlSection {
  const now = () => deps.now?.() ?? new Date();
  const bounds = () => dayBounds(now());
  let load: Load = { kind: "loading" };
  let busy: "switch" | "pause" | "lines" | null = null;
  let switchError: string | null = null;
  let pauseError: string | null = null;
  // What the owner typed in the threshold fields, kept across redraws until it is saved.
  let draft: { warn: string; pause: string } | null = null;
  let linesError: ThresholdErrors = { warn: null, pause: null };

  function show(view: AiControlView): void {
    if (!isAiControlView(view))
      throw new Error("the core sent an AI control view of the wrong shape");
    load = { kind: "ready", view };
    redraw();
  }

  async function refresh(): Promise<void> {
    try {
      show(await deps.getAiControl(bounds()));
    } catch (error) {
      console.error("could not read the AI control:", error);
      if (load.kind !== "ready") {
        load = {
          kind: "failed",
          text: `Mnemo could not read the AI settings. ${errorMessage(error)}`,
        };
        redraw();
      }
    }
  }

  // One command at a time. The view it returns replaces the old one; a failure keeps the old
  // one and shows a plain line where the owner acted.
  async function act(
    what: "switch" | "pause" | "lines",
    call: () => Promise<AiControlView>,
    fail: (text: string) => void,
  ): Promise<boolean> {
    if (busy) return false;
    busy = what;
    redraw();
    try {
      const view = await call();
      busy = null;
      show(view);
      return true;
    } catch (error) {
      console.error(`could not change the AI control (${what}):`, error);
      busy = null;
      fail(errorMessage(error));
      redraw();
      return false;
    }
  }

  function setSwitch(on: boolean): void {
    void act(
      "switch",
      () => deps.setAiEnabled(on, bounds()),
      (text) => {
        switchError = `Mnemo could not ${on ? "turn AI on" : "turn AI off"}. ${text}`;
      },
    ).then((ok) => {
      if (ok) switchError = null;
    });
  }

  function setPause(pause: boolean): void {
    void act(
      "pause",
      () => (pause ? deps.pauseBackground(bounds()) : deps.resumeAi(bounds())),
      (text) => {
        pauseError = `Mnemo could not ${pause ? "pause background work" : "resume"}. ${text}`;
      },
    ).then((ok) => {
      if (ok) pauseError = null;
    });
  }

  function saveLines(view: AiControlView): void {
    if (!draft) return;
    const errors = checkThresholds(draft.warn, draft.pause);
    linesError = errors;
    if (errors.warn || errors.pause) return;
    const warn = Number(draft.warn.trim());
    const pause = Number(draft.pause.trim());
    if (warn === view.warnAt && pause === view.pauseAt) {
      draft = null;
      return;
    }
    void act(
      "lines",
      () => deps.setAiThresholds(warn, pause, bounds()),
      (text) => {
        linesError = { warn: text, pause: null };
      },
    ).then((ok) => {
      if (ok) {
        draft = null;
        linesError = { warn: null, pause: null };
      }
    });
  }

  function switchField(doc: Document, view: AiControlView): HTMLElement {
    // The toggle has no setter: it is built again from the core's value on every draw, so a
    // failed save shows the old value again.
    const toggle = createToggle(doc, {
      label: "AI",
      on: view.enabled,
      disabled: busy !== null,
      onChange: (on) => setSwitch(on),
    });
    toggle.setAttribute("aria-label", "AI");
    const field = createField(doc, {
      label: "Mnemo AI",
      control: toggle,
      hint: SWITCH_HINT,
    });
    setFieldError(field, switchError);
    return field;
  }

  function meterWindow(
    label: string,
    w: AiUsageWindow | null,
  ): UsageWindow | null {
    if (!w) return null;
    return {
      label,
      // A window that has reset has no percent: the meter shows "No reading".
      percent: typeof w.percent === "number" ? w.percent : Number.NaN,
      resetsAt:
        typeof w.resetsAt === "number"
          ? resetPhrase(w.resetsAt, now())
          : undefined,
      unverified: true,
    };
  }

  function usage(doc: Document, view: AiControlView): Node[] {
    const line = (text: string) =>
      buildText(doc, { tone: "muted", size: "sm", content: text });
    if (view.usage.kind === "reading") {
      const windows = [
        meterWindow("5-hour window", view.usage.fiveHour),
        meterWindow("7-day window", view.usage.sevenDay),
      ].filter((w): w is UsageWindow => w !== null);
      return [
        line(READING_LABEL),
        buildUsageWindows({
          windows,
          warnAt: view.warnAt,
          pauseAt: view.pauseAt,
          readAgo: readAgo(view.usage.readAt, now()),
        }),
      ];
    }
    return [
      line(RUNS_LABEL),
      buildRunCount({
        label: "Mnemo runs",
        today: view.usage.today,
        week: view.usage.week,
      }),
    ];
  }

  /** The banners and the one Pause/Resume control for the pause state. */
  function pauseState(doc: Document, view: AiControlView): Node[] {
    const nodes: Node[] = [];
    const reason = gateReason(view.backgroundGate);
    const level = usageLevel(view);
    if (view.pause?.reason === "limit") {
      const until = view.pause.until;
      nodes.push(
        buildAiOffState({
          reason: "limit",
          resetAt:
            typeof until === "number" ? resetPhrase(until, now()) : undefined,
          action: { label: RESUME_LABEL, onClick: () => setPause(false) },
        }),
        buildText(doc, {
          tone: "muted",
          content:
            typeof until === "number"
              ? "Your own AI tasks are held too."
              : "Claude gave no reset time, so AI stays paused until you choose Resume. Your own AI tasks are held too.",
        }),
      );
    } else {
      if (view.pause?.reason === "owner")
        nodes.push(
          buildBanner({
            tone: "info",
            message:
              "Background work is paused by you. Your own tasks still run.",
          }),
        );
      else if (reason === "threshold")
        nodes.push(
          buildBanner({
            tone: "warn",
            message: `Background work is paused: usage is at or above your pause line of ${view.pauseAt}%. Your own tasks still run.`,
          }),
        );
      else if (view.warn && level !== null)
        nodes.push(
          buildBanner({
            tone: "warn",
            message: `Usage is at ${level}% (Unverified), at or above your warn line of ${view.warnAt}%.`,
          }),
        );
      const paused = view.pause?.reason === "owner";
      const label = paused ? RESUME_LABEL : PAUSE_LABEL;
      const button = createButton(doc, {
        label,
        onClick: () => setPause(!paused),
      });
      if (busy === "pause") setButtonBusy(button, true, { label });
      nodes.push(button);
    }
    if (pauseError)
      nodes.push(buildBanner({ tone: "bad", message: pauseError }));
    return nodes;
  }

  function lines(doc: Document, view: AiControlView): Node[] {
    const values = draft ?? {
      warn: String(view.warnAt),
      pause: String(view.pauseAt),
    };
    const input = (value: string) => {
      const el = createTextInput(doc, { value });
      el.inputMode = "numeric";
      return el;
    };
    const warnInput = input(values.warn);
    const pauseInput = input(values.pause);
    const warnField = createField(doc, {
      label: "Warn at (%)",
      control: warnInput,
      hint: "A banner shows when usage reaches this line.",
    });
    const pauseField = createField(doc, {
      label: "Pause background work at (%)",
      control: pauseInput,
      hint: "Background work waits at this line. Your own tasks still run.",
    });
    const showErrors = () => {
      setFieldError(warnField, linesError.warn);
      setFieldError(pauseField, linesError.pause);
    };
    // Checked on every key, with the core's rule; saved when a field is left.
    const onInput = () => {
      draft = { warn: warnInput.value, pause: pauseInput.value };
      linesError = checkThresholds(draft.warn, draft.pause);
      showErrors();
    };
    for (const el of [warnInput, pauseInput]) {
      el.addEventListener("input", onInput);
      el.addEventListener("change", () => saveLines(view));
    }
    showErrors();
    return [warnField, pauseField];
  }

  return {
    render(doc: Document): Node[] {
      if (load.kind === "loading")
        return [
          buildText(doc, {
            tone: "muted",
            content: "Reading the AI settings…",
          }),
        ];
      if (load.kind === "failed")
        return [buildText(doc, { tone: "muted", content: load.text })];
      const view = load.view;
      const nodes: Node[] = [switchField(doc, view)];
      if (!view.enabled) nodes.push(buildAiOffState({ reason: "off" }));
      else nodes.push(...pauseState(doc, view));
      nodes.push(...usage(doc, view), ...lines(doc, view));
      return nodes;
    },
    view: () => (load.kind === "ready" ? load.view : null),
    refresh,
    // Nothing to stop here: `startAiControl` owns the event listener.
    dispose(): void {},
  };
}

/**
 * Builds the section, reads the view and listens to the core's `ai-control` event until
 * `dispose` (or until `alive` says the screen is gone).
 */
export function startAiControl(
  deps: AiControlDeps,
  redraw: () => void,
  alive: () => boolean,
): AiControlSection {
  const section = createAiControlSection(deps, redraw);
  let stop: (() => void) | null = null;
  let stopped = false;
  void section.refresh();
  deps
    .onAiControl?.(() => {
      if (!alive()) {
        stop?.();
        stop = null;
        return;
      }
      void section.refresh();
    })
    .then((unlisten) => {
      if (stopped) unlisten();
      else stop = unlisten;
    })
    .catch((error: unknown) => {
      console.error("could not listen to the AI control:", error);
    });
  return {
    ...section,
    dispose(): void {
      stopped = true;
      stop?.();
      stop = null;
      section.dispose();
    },
  };
}
