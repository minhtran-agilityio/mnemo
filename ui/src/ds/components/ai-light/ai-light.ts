import { CircleX, type IconNode, Pause, Power, TriangleAlert } from "lucide";
import { buildDot } from "../dot/dot";
import { createFeedbackIcon } from "../feedback-icon/feedback-icon";
import "./ai-light.css";

export type AiLightState =
  | "idle"
  | "running"
  | "off"
  | "not-installed"
  | "signed-out"
  | "at-limit";

export interface AiLightOptions {
  readonly state: AiLightState;
  /** Running: how many jobs are going. */
  readonly jobs?: number;
  /** At limit: when AI resumes, for example "14:00". */
  readonly resumesAt?: string;
  /** Not installed: runs when the owner picks "check again". */
  readonly onCheckAgain?: () => void;
}

function glyph(icon: IconNode, tone: "off" | "bad" | "warn"): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = `ai-light-glyph ai-light-glyph-${tone}`;
  wrap.append(createFeedbackIcon(icon, "sm"));
  return wrap;
}

function strong(text: string): HTMLElement {
  const b = document.createElement("b");
  b.textContent = text;
  return b;
}

const text = (value: string) => document.createTextNode(value);

/**
 * The AI status light: one plain line that says what is wrong and the fix. It is a status
 * region, so a change is read out politely. Mnemo never asks for credentials here: a signed-out
 * Claude is fixed in a terminal.
 */
export function buildAiLight(options: AiLightOptions): HTMLSpanElement {
  const light = document.createElement("span");
  light.className = "ai-light";
  light.setAttribute("role", "status");
  light.dataset.state = options.state;
  switch (options.state) {
    case "idle":
      light.append(buildDot({ tone: "good" }), strong("AI ready"));
      break;
    case "running": {
      const jobs = options.jobs;
      light.append(
        buildDot({ tone: "accent", pulse: true }),
        strong("AI working"),
      );
      if (jobs !== undefined)
        light.append(text(` · ${jobs} ${jobs === 1 ? "job" : "jobs"}`));
      break;
    }
    case "off":
      light.append(
        glyph(Power, "off"),
        strong("AI off"),
        text(" · saving still works"),
      );
      break;
    case "not-installed": {
      const again = document.createElement("button");
      again.type = "button";
      again.className = "ai-light-action";
      again.textContent = "check again";
      if (options.onCheckAgain)
        again.addEventListener("click", options.onCheckAgain);
      light.append(
        glyph(CircleX, "bad"),
        strong("Claude Code not found"),
        text(" · install it, then "),
        again,
      );
      break;
    }
    case "signed-out": {
      const code = document.createElement("code");
      code.textContent = "claude";
      light.append(
        glyph(TriangleAlert, "warn"),
        strong("Claude is signed out"),
        text(" · run "),
        code,
        text(" in a terminal to get back in"),
      );
      break;
    }
    case "at-limit":
      light.append(
        glyph(Pause, "bad"),
        strong("At usage limit"),
        text(
          options.resumesAt
            ? ` · AI resumes at ${options.resumesAt}`
            : " · AI resumes when the limit resets",
        ),
      );
      break;
  }
  return light;
}
