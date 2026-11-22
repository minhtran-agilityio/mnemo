import { Pause, ShieldAlert, TriangleAlert } from "lucide";
import { createIcon } from "../../icon";
import "./usage-meter.css";

/** Share of the usage window at which Mnemo warns. */
export const USAGE_WARN_AT = 60;
/** Share of the usage window at which background jobs pause. */
export const USAGE_PAUSE_AT = 95;

export type UsageTone = "normal" | "warn" | "pause";

/** The tone of a share. The lines default to 60 and 95; the owner can set them. */
export function usageTone(
  percent: number,
  warnAt: number = USAGE_WARN_AT,
  pauseAt: number = USAGE_PAUSE_AT,
): UsageTone {
  if (percent >= pauseAt) return "pause";
  if (percent >= warnAt) return "warn";
  return "normal";
}

/** The lines the owner sets. Both are optional. */
export interface UsageLines {
  /** Share at which Mnemo warns. Default 60. */
  readonly warnAt?: number;
  /** Share at which background jobs pause. Default 95. */
  readonly pauseAt?: number;
}

export interface UsageMeterOptions extends UsageLines {
  readonly label: string;
  /** Share of the current usage window, 0 to 100. Values outside are clamped. */
  readonly percent: number;
  /** When the window resets, for example "14:00". */
  readonly resetsAt?: string;
  /** Show the percent as "Unverified" in words: the scale is not confirmed. */
  readonly unverified?: boolean;
  /** How old the stored percent is, for example "2 h ago". Shown as "Read 2 h ago." */
  readonly readAgo?: string;
}

export interface UsageWindow {
  /** For example "5-hour window". */
  readonly label: string;
  readonly percent: number;
  readonly resetsAt?: string;
  readonly unverified?: boolean;
}

export interface UsageWindowsOptions extends UsageLines {
  readonly windows: readonly UsageWindow[];
  readonly readAgo?: string;
}

function clamp(percent: number): number {
  return Math.round(Math.min(100, Math.max(0, percent)));
}

function lineValue(value: number | undefined, fallback: number): number {
  if (value === undefined || Number.isNaN(value)) return fallback;
  return Math.min(100, Math.max(0, value));
}

/** Both lines clamped to 0 to 100 (NaN falls back to the default); pause is never below warn. */
function resolveLines(lines: UsageLines): { warnAt: number; pauseAt: number } {
  const warnAt = lineValue(lines.warnAt, USAGE_WARN_AT);
  const pauseAt = Math.max(warnAt, lineValue(lines.pauseAt, USAGE_PAUSE_AT));
  return { warnAt, pauseAt };
}

let noteCount = 0;

/** An id that does not collide with another meter, even in another root. */
function noteId(): string {
  noteCount += 1;
  return `meter-note-${noteCount}-${Math.random().toString(36).slice(2, 8)}`;
}

function note(
  tone: UsageTone,
  lines: { warnAt: number; pauseAt: number },
  resetsAt?: string,
  unverified = false,
): HTMLElement {
  const box = document.createElement("div");
  box.className = "meter-note";
  box.id = noteId();
  const line = document.createElement("span");
  if (tone === "warn") {
    box.append(createIcon(TriangleAlert, "sm"));
    line.textContent = `Over ${lines.warnAt}%. Background jobs pause at ${lines.pauseAt}%.${unverified ? " The figure is unverified." : ""}`;
  } else if (tone === "pause") {
    box.append(createIcon(Pause, "sm"));
    line.textContent = `Background jobs paused. Links still save, with no summary.${unverified ? " The figure is unverified." : ""}`;
  } else {
    line.textContent = resetsAt ? `Resets at ${resetsAt}.` : "";
  }
  box.append(line);
  return box;
}

function ageLine(readAgo: string): HTMLElement {
  const age = document.createElement("div");
  age.className = "meter-age";
  age.textContent = `Read ${readAgo}.`;
  return age;
}

/** Label, value and the track with its two ticks. Returns the pieces of one bar. */
function bar(
  label: string,
  rawPercent: number,
  lines: { warnAt: number; pauseAt: number },
  unverified: boolean,
  resetsAt?: string,
): { top: HTMLElement; track: HTMLElement; percent: number; known: boolean } {
  const known = Number.isFinite(rawPercent);
  const percent = known ? clamp(rawPercent) : 0;
  const top = document.createElement("div");
  top.className = "meter-top";
  const name = document.createElement("b");
  name.className = "meter-label";
  name.textContent = label;
  const value = document.createElement("span");
  value.className = "meter-value";
  value.textContent = !known
    ? "No reading"
    : unverified
      ? `${percent}% (Unverified)`
      : `${percent}% used`;
  top.append(name, value);
  if (resetsAt) {
    const reset = document.createElement("span");
    reset.className = "meter-reset";
    reset.textContent = `resets ${resetsAt}`;
    top.append(reset);
  }

  const track = document.createElement("div");
  track.className = "meter-track";
  track.setAttribute("role", "meter");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  if (known) track.setAttribute("aria-valuenow", String(percent));
  track.setAttribute(
    "aria-label",
    known
      ? `${label} ${percent}%${unverified ? " (Unverified)" : ""}`
      : `${label}: no reading`,
  );
  const fill = document.createElement("span");
  const own = usageTone(percent, lines.warnAt, lines.pauseAt);
  fill.className =
    own === "normal" ? "meter-fill" : `meter-fill meter-fill-${own}`;
  fill.style.width = `${percent}%`;
  track.append(fill);
  for (const at of [lines.warnAt, lines.pauseAt]) {
    const tick = document.createElement("span");
    tick.className = "meter-tick";
    tick.style.left = `${at}%`;
    track.append(tick);
  }
  return { top, track, percent, known };
}

/**
 * The usage meter. The fill changes colour at the warning and the pause, and a note with an
 * icon says so in words. Two ticks on the track mark where those lines are.
 */
export function buildUsageMeter(options: UsageMeterOptions): HTMLElement {
  const lines = resolveLines(options);
  const { top, track, percent } = bar(
    options.label,
    options.percent,
    lines,
    options.unverified ?? false,
    // The reset time shows once: in the note when the tone is normal, else next to the value.
    usageTone(clamp(options.percent), lines.warnAt, lines.pauseAt) === "normal"
      ? undefined
      : options.resetsAt,
  );
  const tone = usageTone(percent, lines.warnAt, lines.pauseAt);
  const meter = document.createElement("div");
  meter.className = tone === "normal" ? "meter" : `meter meter-${tone}`;
  const noteBox = note(tone, lines, options.resetsAt, options.unverified);
  track.setAttribute("aria-describedby", noteBox.id);
  meter.append(top, track, noteBox);
  if (options.readAgo) meter.append(ageLine(options.readAgo));
  return meter;
}

/**
 * Two windows together, for example the 5-hour and the 7-day window. Each has its own bar;
 * the higher share drives the tone and the one note.
 */
export function buildUsageWindows(options: UsageWindowsOptions): HTMLElement {
  const lines = resolveLines(options);
  if (options.windows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "meter meter-windows";
    const none = document.createElement("div");
    none.className = "meter-note";
    const text = document.createElement("span");
    text.textContent = "No usage reading yet.";
    none.append(createIcon(ShieldAlert, "sm"), text);
    empty.append(none);
    return empty;
  }
  const bars = options.windows.map((w) =>
    bar(w.label, w.percent, lines, w.unverified ?? false, w.resetsAt),
  );
  const highest = bars.reduce(
    (max, b) => (b.known ? Math.max(max, b.percent) : max),
    0,
  );
  // The window that drives the tone decides the "unverified" note. On a tie, one verified
  // window is enough to stand behind the tone.
  const drivers = options.windows.filter(
    (_w, i) => bars[i]?.known && bars[i]?.percent === highest,
  );
  const drivenUnverified =
    drivers.length > 0 && drivers.every((w) => w.unverified);
  const tone = usageTone(highest, lines.warnAt, lines.pauseAt);
  const meter = document.createElement("div");
  meter.className =
    tone === "normal"
      ? "meter meter-windows"
      : `meter meter-windows meter-${tone}`;
  for (const b of bars) {
    const group = document.createElement("div");
    group.className = "meter-window";
    group.append(b.top, b.track);
    meter.append(group);
  }
  // Each window's reset time is in its own row; the note does not repeat it.
  const noteBox = note(tone, lines, undefined, drivenUnverified);
  for (const b of bars) b.track.setAttribute("aria-describedby", noteBox.id);
  meter.append(noteBox);
  if (options.readAgo) meter.append(ageLine(options.readAgo));
  return meter;
}

/** Either one number (the old fixed note) or runs today and this week together. */
export type RunCountOptions =
  | {
      readonly label: string;
      readonly count: number;
      readonly today?: never;
      readonly week?: never;
    }
  | {
      readonly label: string;
      /** Runs today and this week, shown as "N today, M this week". */
      readonly today: number;
      readonly week: number;
      readonly count?: never;
    };

/**
 * The meter when only Mnemo's own runs are known: a count and a plain note, no bar. The
 * owner's full Claude usage is not shown, because Mnemo cannot read it.
 */
export function buildRunCount(options: RunCountOptions): HTMLElement {
  for (const n of [options.count, options.today, options.week]) {
    if (n !== undefined && !(Number.isFinite(n) && n >= 0)) {
      throw new RangeError("A run count is a number of 0 or more.");
    }
  }
  const meter = document.createElement("div");
  meter.className = "meter";
  const top = document.createElement("div");
  top.className = "meter-top";
  const label = document.createElement("b");
  label.textContent = options.label;
  const value = document.createElement("span");
  value.className = "meter-value";
  const split = options.count === undefined;
  value.textContent =
    options.count === undefined
      ? `${options.today} today, ${options.week} this week`
      : String(options.count);
  top.append(label, value);
  const box = document.createElement("div");
  box.className = "meter-note";
  const line = document.createElement("span");
  line.textContent = split
    ? "This is a run count. The real usage share is not known yet."
    : "Only Mnemo's own runs are known. Your full Claude usage is not shown.";
  box.append(createIcon(ShieldAlert, "sm"), line);
  meter.append(top, box);
  return meter;
}
