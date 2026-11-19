import { Pause, ShieldAlert, TriangleAlert } from "lucide";
import { createFeedbackIcon } from "../feedback-icon/feedback-icon";
import "./usage-meter.css";

/** Share of the usage window at which Mnemo warns. */
export const USAGE_WARN_AT = 60;
/** Share of the usage window at which background jobs pause. */
export const USAGE_PAUSE_AT = 95;

export type UsageTone = "normal" | "warn" | "pause";

export function usageTone(percent: number): UsageTone {
  if (percent >= USAGE_PAUSE_AT) return "pause";
  if (percent >= USAGE_WARN_AT) return "warn";
  return "normal";
}

export interface UsageMeterOptions {
  readonly label: string;
  /** Share of the current usage window, 0 to 100. Values outside are clamped. */
  readonly percent: number;
  /** When the window resets, for example "14:00". */
  readonly resetsAt?: string;
}

function note(tone: UsageTone, resetsAt?: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "meter-note";
  const line = document.createElement("span");
  if (tone === "warn") {
    box.append(createFeedbackIcon(TriangleAlert, "sm"));
    line.textContent = `Over ${USAGE_WARN_AT}%. Background jobs pause at ${USAGE_PAUSE_AT}%.`;
  } else if (tone === "pause") {
    box.append(createFeedbackIcon(Pause, "sm"));
    line.textContent =
      "Background jobs paused. Links still save, with no summary.";
  } else {
    line.textContent = resetsAt ? `Resets at ${resetsAt}.` : "";
  }
  box.append(line);
  return box;
}

/**
 * The usage meter. The fill changes colour at the warning and the pause, and a note with an
 * icon says so in words. Two ticks on the track mark where those lines are.
 */
export function buildUsageMeter(options: UsageMeterOptions): HTMLElement {
  const percent = Math.round(Math.min(100, Math.max(0, options.percent)));
  const tone = usageTone(percent);
  const meter = document.createElement("div");
  meter.className = tone === "normal" ? "meter" : `meter meter-${tone}`;

  const top = document.createElement("div");
  top.className = "meter-top";
  const label = document.createElement("b");
  label.textContent = options.label;
  const value = document.createElement("span");
  value.className = "meter-value";
  value.textContent = `${percent}% used`;
  top.append(label, value);

  const track = document.createElement("div");
  track.className = "meter-track";
  track.setAttribute("role", "meter");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  track.setAttribute("aria-valuenow", String(percent));
  track.setAttribute("aria-label", `${options.label} ${percent}%`);
  const fill = document.createElement("span");
  fill.className = "meter-fill";
  fill.style.width = `${percent}%`;
  track.append(fill);
  for (const at of [USAGE_WARN_AT, USAGE_PAUSE_AT]) {
    const tick = document.createElement("span");
    tick.className = "meter-tick";
    tick.style.left = `${at}%`;
    track.append(tick);
  }

  meter.append(top, track, note(tone, options.resetsAt));
  return meter;
}

export interface RunCountOptions {
  readonly label: string;
  readonly count: number;
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
  value.textContent = String(options.count);
  top.append(label, value);
  const box = document.createElement("div");
  box.className = "meter-note";
  const line = document.createElement("span");
  line.textContent =
    "Only Mnemo's own runs are known. Your full Claude usage is not shown.";
  box.append(createFeedbackIcon(ShieldAlert, "sm"), line);
  meter.append(top, box);
  return meter;
}
