import { CircleHelp, ShieldAlert, Sparkles } from "lucide";
import { createFeedbackIcon } from "../feedback-icon/feedback-icon";
import "./trust-label.css";

export type TrustKind = "guess" | "unverified" | "ai";

const LABELS = {
  guess: { text: "Guess", cls: "trust-guess", icon: CircleHelp },
  unverified: { text: "Unverified", cls: "trust-unv", icon: ShieldAlert },
  ai: { text: "Written by AI", cls: "trust-ai", icon: Sparkles },
} as const;

/**
 * A trust label. Guess: a reason Mnemo wrote itself. Unverified: a fact nobody checked.
 * Written by AI: text a model wrote. The word and the icon both say it; the tint only helps.
 */
export function buildTrustLabel(kind: TrustKind): HTMLSpanElement {
  const spec = LABELS[kind];
  const label = document.createElement("span");
  label.className = `trust ${spec.cls}`;
  label.append(
    createFeedbackIcon(spec.icon, "sm"),
    document.createTextNode(spec.text),
  );
  return label;
}
