// Inspect mode of the UI Catalog: point at an example, or focus it, and a card shows what it is
// made of: the text and ground tokens, the contrast ratio, the border contrast, the target size
// against 24 and 44 px, the font and the radius. The numbers are computed from the page as it is
// drawn now, in the theme on screen, so they follow Light and Dark. Escape leaves the mode.
// All text goes in as text.

import { tokensOfKind } from "../../ds/catalog";
import {
  blend,
  contrastOf,
  parseColour,
  type Rgba,
  targetVerdict,
  textVerdict,
} from "./colour";
import { el } from "./parts";

/** The classes of the parts a hover can land on. The closest one inside an example is shown. */
const PART = [
  ".btn",
  ".input",
  ".textarea",
  ".select",
  ".selwrap",
  ".chip",
  ".toggle",
  ".seg",
  ".pill",
  ".trust",
  ".ai-light",
  ".meter",
  ".banner",
  ".toast",
  ".lcard",
  ".kcard",
  ".kcol",
  ".row",
  ".navb",
  ".rail",
  ".statusbar",
  ".pagehead",
  ".card",
  ".panel",
  ".cite",
  ".tag",
  ".tnode",
  ".dlg",
  ".dlg-static",
  ".menu",
  ".popover",
  ".app",
  ".state-box",
  ".tags",
  ".check",
  ".progress",
  ".spinner",
  ".skeleton",
  ".tip",
  ".mtabs button",
  "kbd",
  "th button",
].join(", ");

const INTERACTIVE =
  'button, a[href], input, select, textarea, [role="switch"], [role="tab"], [role="option"], [role="radio"], [tabindex="0"]';

export interface Inspector {
  isOn(): boolean;
  setOn(on: boolean): void;
}

/** The first ancestor (or the node) with a mostly opaque background, and that colour. */
function groundOf(node: Element | null): { node: Element; colour: Rgba } {
  const doc = (node ?? document.body).ownerDocument;
  for (let n = node; n; n = n.parentElement) {
    const c = parseColour(getComputedStyle(n).backgroundColor);
    if (c && c[3] > 0.5)
      return { node: n, colour: blend(c, [255, 255, 255, 1]) };
  }
  const body = doc.body;
  const c = parseColour(getComputedStyle(body).backgroundColor);
  return {
    node: body,
    colour: c ? blend(c, [255, 255, 255, 1]) : [255, 255, 255, 1],
  };
}

/** The colour token whose value in the theme on screen equals `colour`, or null. */
function tokenOf(
  node: Element,
  colour: Rgba,
  names: readonly string[],
): string | null {
  const style = getComputedStyle(node);
  for (const name of names) {
    const v = parseColour(style.getPropertyValue(name));
    if (!v) continue;
    if (
      Math.abs(v[0] - colour[0]) <= 1 &&
      Math.abs(v[1] - colour[1]) <= 1 &&
      Math.abs(v[2] - colour[2]) <= 1 &&
      Math.abs(v[3] - colour[3]) <= 0.02
    )
      return name;
  }
  return null;
}

/**
 * Adds the highlight box and the card to `wrap` and listens on the document until `signal`
 * aborts. `onChange` runs each time the mode turns on or off, so a switch can follow it.
 */
export function createInspector(
  wrap: HTMLElement,
  signal: AbortSignal,
  onChange: (on: boolean) => void,
): Inspector {
  const doc = wrap.ownerDocument;
  const box = el(doc, "div", "insp-box");
  const card = el(doc, "div", "insp-card");
  card.setAttribute("role", "status");
  box.hidden = true;
  card.hidden = true;
  wrap.append(box, card);

  const colourTokens = tokensOfKind("colour");
  let on = false;
  let target: HTMLElement | null = null;
  let frame = 0;

  const hide = () => {
    box.hidden = true;
    card.hidden = true;
    target = null;
  };

  const row = (
    dl: HTMLElement,
    key: string,
    value: string,
    swatch?: string | null,
  ) => {
    dl.append(el(doc, "dt", undefined, key));
    const dd = el(doc, "dd");
    if (swatch) {
      const s = el(doc, "span", "insp-sw");
      s.style.background = `var(${swatch})`;
      dd.append(s);
    }
    dd.append(doc.createTextNode(value));
    dl.append(dd);
  };

  const describe = (t: HTMLElement) => {
    const rect = t.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      hide();
      return;
    }
    const cs = getComputedStyle(t);
    card.replaceChildren();
    const classes = [...t.classList].filter(
      (c) => !c.startsWith("is-") && c !== "flash",
    );
    card.append(
      el(
        doc,
        "div",
        "nm",
        t.tagName.toLowerCase() +
          (classes.length ? `.${classes.join(".")}` : ""),
      ),
    );
    const dl = el(doc, "dl");
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    row(dl, "Size", `${w} × ${h} px`);
    if (t.matches(INTERACTIVE))
      row(dl, "Target", `${targetVerdict(w, h)} (primary: 44)`);

    const ground = groundOf(t);
    const fgRaw = parseColour(cs.color);
    const fg = fgRaw ? blend(fgRaw, ground.colour) : null;
    const fgToken = fgRaw ? tokenOf(t, fgRaw, colourTokens) : null;
    const gdToken = tokenOf(ground.node, ground.colour, colourTokens);
    row(dl, "Text", fgToken ?? cs.color, fgToken);
    row(dl, "Ground", gdToken ?? "not a token", gdToken);
    if (fg) {
      const exempt =
        t.matches(":disabled, [aria-disabled='true']") ||
        t.closest("[disabled]") !== null;
      const ratio = contrastOf(fg, ground.colour);
      row(
        dl,
        "Contrast",
        `${ratio.toFixed(2)}:1 · ${textVerdict(ratio, exempt)}`,
      );
    }
    if (
      Number.parseFloat(cs.borderTopWidth) > 0 &&
      cs.borderTopStyle !== "none"
    ) {
      const bc = parseColour(cs.borderTopColor);
      if (bc && bc[3] > 0) {
        const bt = tokenOf(t, bc, colourTokens);
        const behind = groundOf(t.parentElement).colour;
        const ratio = contrastOf(blend(bc, behind), behind);
        row(
          dl,
          "Border",
          `${bt ?? cs.borderTopColor} · ${ratio.toFixed(2)}:1`,
          bt,
        );
      }
    }
    row(
      dl,
      "Type",
      `${Number.parseFloat(cs.fontSize)} px · ${cs.fontWeight} · ${cs.fontFamily.split(",")[0].replace(/"/g, "")}`,
    );
    const radius = Number.parseFloat(cs.borderTopLeftRadius);
    if (radius) {
      const rs = getComputedStyle(doc.documentElement);
      const token = tokensOfKind("radius").find(
        (n) => Number.parseFloat(rs.getPropertyValue(n)) === radius,
      );
      row(dl, "Radius", token ?? `${radius} px`);
    }
    card.append(dl);

    const view = doc.defaultView;
    const vw = view?.innerWidth ?? 0;
    const vh = view?.innerHeight ?? 0;
    box.hidden = false;
    card.hidden = false;
    const grow = 3;
    box.style.left = `${rect.left - grow}px`;
    box.style.top = `${rect.top - grow}px`;
    box.style.width = `${rect.width + grow * 2}px`;
    box.style.height = `${rect.height + grow * 2}px`;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const gap = 10;
    const margin = 8;
    const x = Math.max(margin, Math.min(rect.left, vw - cw - margin));
    let y = rect.bottom + gap;
    if (y + ch > vh - margin) y = Math.max(margin, rect.top - ch - gap);
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
  };

  /** The part under `node` inside an example, or null. Never the inspector's own card. */
  const pick = (node: EventTarget | null): HTMLElement | null => {
    if (!(node instanceof Element)) return null;
    const ex = node.closest(".cat-ex");
    if (!ex) return null;
    const part = node.closest<HTMLElement>(PART);
    return part && ex.contains(part) ? part : null;
  };

  const point = (event: Event) => {
    if (!on) return;
    cancelAnimationFrame(frame);
    const at = event.target;
    frame = requestAnimationFrame(() => {
      const t = pick(at);
      if (t === target) return;
      target = t;
      if (t) describe(t);
      else hide();
    });
  };
  doc.addEventListener("pointermove", point, { signal });
  doc.addEventListener(
    "focusin",
    (event) => {
      if (!on) return;
      const t = pick(event.target);
      if (t) {
        target = t;
        describe(t);
      }
    },
    { signal },
  );
  const reposition = () => {
    if (on && target) describe(target);
  };
  doc.addEventListener("scroll", reposition, {
    capture: true,
    passive: true,
    signal,
  });
  doc.defaultView?.addEventListener("resize", reposition, { signal });
  doc.addEventListener(
    "keydown",
    (event) => {
      if (!on || event.key !== "Escape") return;
      if (doc.querySelector("dialog[open]")) return;
      event.preventDefault();
      api.setOn(false);
    },
    { signal },
  );
  signal.addEventListener("abort", () => {
    cancelAnimationFrame(frame);
    wrap.classList.remove("inspecting");
  });

  const api: Inspector = {
    isOn: () => on,
    setOn(next) {
      if (next === on) return;
      on = next;
      wrap.classList.toggle("inspecting", on);
      if (!on) hide();
      onChange(on);
    },
  };
  return api;
}
