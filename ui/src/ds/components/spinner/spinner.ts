import "./spinner.css";

/** The ring. Decorative: pair it with words (see buildBusyLine). It takes the text colour. */
export function buildSpinner(size: "sm" | "lg" = "sm"): HTMLSpanElement {
  const ring = document.createElement("span");
  ring.className = size === "lg" ? "spinner spinner-lg" : "spinner";
  ring.setAttribute("aria-hidden", "true");
  return ring;
}

/** A spinner and words, as a status region: "Reading the page…". */
export function buildBusyLine(text: string): HTMLSpanElement {
  const line = document.createElement("span");
  line.className = "busy-line";
  line.setAttribute("role", "status");
  const words = document.createElement("span");
  words.textContent = text;
  line.append(buildSpinner(), words);
  return line;
}
