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

function resolveLines(lines: UsageLines): { warnAt: number; pauseAt: number } {
  return {
    warnAt: lines.warnAt ?? USAGE_WARN_AT,
    pauseAt: lines.pauseAt ?? USAGE_PAUSE_AT,
  };
}

function note(
  tone: UsageTone,
  lines: { warnAt: number; pauseAt: number },
  resetsAt?: string,
): HTMLElement {
  const box = document.createElement("div");
  box.className = "meter-note";
  const line = document.createElement("span");
  if (tone === "warn") {
    box.append(createIcon(TriangleAlert, "sm"));
    line.textContent = `Over ${lines.warnAt}%. Background jobs pause at ${lines.pauseAt}%.`;
  } else if (tone === "pause") {
    box.append(createIcon(Pause, "sm"));
    line.textContent =
      "Background jobs paused. Links still save, with no summary.";
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
): { top: HTMLElement; track: HTMLElement; percent: number } {
  const percent = clamp(rawPercent);
  const top = document.createElement("div");
  top.className = "meter-top";
  const name = document.createElement("b");
  name.className = "meter-label";
  name.textContent = label;
  const value = document.createElement("span");
  value.className = "meter-value";
  value.textContent = unverified
    ? `${percent}% (Unverified)`
    : `${percent}% used`;
  top.append(name, value);
  if (resetsAt && unverified) {
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
  track.setAttribute("aria-valuenow", String(percent));
  track.setAttribute(
    "aria-label",
    `${label} ${percent}%${unverified ? " (Unverified)" : ""}`,
  );
  const fill = document.createElement("span");
  fill.className = "meter-fill";
  fill.style.width = `${percent}%`;
  track.append(fill);
  for (const at of [lines.warnAt, lines.pauseAt]) {
    const tick = document.createElement("span");
    tick.className = "meter-tick";
    tick.style.left = `${at}%`;
    track.append(tick);
  }
  return { top, track, percent };
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
    options.resetsAt,
  );
  const tone = usageTone(percent, lines.warnAt, lines.pauseAt);
  const meter = document.createElement("div");
  meter.className = tone === "normal" ? "meter" : `meter meter-${tone}`;
  meter.append(top, track, note(tone, lines, options.resetsAt));
  if (options.readAgo) meter.append(ageLine(options.readAgo));
  return meter;
}

/**
 * Two windows together, for example the 5-hour and the 7-day window. Each has its own bar;
 * the higher share drives the tone and the one note.
 */
export function buildUsageWindows(options: UsageWindowsOptions): HTMLElement {
  const lines = resolveLines(options);
  const bars = options.windows.map((w) =>
    bar(w.label, w.percent, lines, w.unverified ?? false, w.resetsAt),
  );
  const highest = bars.reduce((max, b) => Math.max(max, b.percent), 0);
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
  const resets = options.windows.find((w) => w.resetsAt && !w.unverified);
  meter.append(note(tone, lines, resets?.resetsAt));
  if (options.readAgo) meter.append(ageLine(options.readAgo));
  return meter;
}

export interface RunCountOptions {
  readonly label: string;
  /** One number. Used alone it keeps the old fixed note. */
  readonly count: number;
  /** Runs today. With this or `week`, the count is shown as "N today, M this week". */
  readonly today?: number;
  /** Runs this week. */
  readonly week?: number;
}

/**
 * The meter when only Mnemo's own runs are known: a count and a plain note, no bar. The
 * owner's full Claude usage is not shown, because Mnemo cannot read it.
 */
export function buildRunCount(options: RunCountOptions): HTMLElement {
  const meter = document.createElement("div");
  meter.className = "meter";
  const top = document.createElement("div");
  top.className = "meter-top";
  const label = document.createElement("b");
  label.textContent = options.label;
  const value = document.createElement("span");
  value.className = "meter-value";
  const split = options.today !== undefined || options.week !== undefined;
  const parts: string[] = [];
  if (options.today !== undefined) parts.push(`${options.today} today`);
  if (options.week !== undefined) parts.push(`${options.week} this week`);
  value.textContent = split ? parts.join(", ") : String(options.count);
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
