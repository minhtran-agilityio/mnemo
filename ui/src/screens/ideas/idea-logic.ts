// Plain rules of the Ideas screen (#34), kept apart from the DOM so they are easy to test.
// The core sets the stage; these functions only turn records into words and form values into
// the input the core expects.
import type {
  Idea,
  IdeaChecks,
  IdeaInput,
  IdeaSource,
  IdeaStage,
} from "../../shared/api";

/** The four stages in order, with the names the owner sees. */
export const STAGES: readonly { id: IdeaStage; label: string }[] = [
  { id: "spark", label: "Spark" },
  { id: "shape", label: "Shape" },
  { id: "ready", label: "Ready" },
  { id: "project", label: "Project" },
];

export function stageLabel(stage: IdeaStage): string {
  return STAGES.find((s) => s.id === stage)?.label ?? stage;
}

/** One line per check: the words say passed or not, so colour is never the only signal. */
export function checkLines(
  checks: IdeaChecks,
): { ok: boolean; text: string }[] {
  return [
    {
      ok: checks.hasTag,
      text: checks.hasTag ? "It has a tag." : "No tag yet.",
    },
    {
      ok: checks.hasSource,
      text: checks.hasSource
        ? "It has a source."
        : "No source yet. Pick a saved item or add a link.",
    },
    {
      ok: checks.hasWhy,
      text: checks.hasWhy
        ? "You wrote why you want it."
        : "Write one sentence: why do you want this?",
    },
    {
      ok: checks.hasOutline,
      text: checks.hasOutline ? "It has an outline." : "No outline yet.",
    },
  ];
}

export function passedCount(checks: IdeaChecks): number {
  return checkLines(checks).filter((c) => c.ok).length;
}

/** Advice under the checks (the words of the prototype v71). It never blocks anything. */
export function adviceText(checks: IdeaChecks): string {
  const n = passedCount(checks);
  if (n === 4) return "Ready. Everything a project needs is here.";
  if (n >= 2) return "You can start now. It is easier after the open points.";
  return "Still a spark. Shape it a bit more first, or start anyway.";
}

/** The values of the editor form, as typed. */
export interface IdeaForm {
  title: string;
  text: string;
  why: string;
  outline: string;
  tags: readonly string[];
  sourceMode: "none" | "item" | "link";
  /** The chosen saved item, as "<kind>:<id>". */
  sourceItem: string;
  sourceUrl: string;
}

/** Blank text is unknown: the core stores null, never an empty string. */
function orNull(v: string): string | null {
  return v.trim() === "" ? null : v;
}

/** A tag as the owner means it: no leading "#", trimmed. The core cleans it fully. */
export function tidyTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim().replace(/^#+/, "").trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function sourceOf(form: IdeaForm): IdeaSource | null {
  if (form.sourceMode === "link" && form.sourceUrl.trim())
    return { type: "link", url: form.sourceUrl.trim() };
  if (form.sourceMode === "item" && form.sourceItem) {
    const at = form.sourceItem.indexOf(":");
    const kind = form.sourceItem.slice(0, at);
    const id = form.sourceItem.slice(at + 1);
    if ((kind === "bookmark" || kind === "note") && id)
      return { type: "item", item: { kind, id } };
  }
  return null;
}

/** The input the core expects. Every field is sent, null for unknown. */
export function toInput(form: IdeaForm): IdeaInput {
  return {
    title: form.title.trim(),
    text: orNull(form.text),
    source: sourceOf(form),
    why: orNull(form.why.trim()),
    outline: orNull(form.outline),
    tags: tidyTags(form.tags),
  };
}

/** The form values of a saved idea, or of a new one. */
export function formOf(idea: Idea | null): IdeaForm {
  const source = idea?.source ?? null;
  return {
    title: idea?.title ?? "",
    text: idea?.text ?? "",
    why: idea?.why ?? "",
    outline: idea?.outline ?? "",
    tags: idea?.tags ?? [],
    sourceMode:
      source === null ? "none" : source.type === "item" ? "item" : "link",
    sourceItem:
      source?.type === "item" ? `${source.item.kind}:${source.item.id}` : "",
    sourceUrl: source?.type === "link" ? source.url : "",
  };
}

/** The ideas of each stage, in the order given. */
export function groupByStage(
  ideas: readonly Idea[],
): Record<IdeaStage, Idea[]> {
  const out: Record<IdeaStage, Idea[]> = {
    spark: [],
    shape: [],
    ready: [],
    project: [],
  };
  for (const idea of ideas) out[idea.stage].push(idea);
  return out;
}

/** The meta line of an idea card: "3 of 4 checks · 2 tags". */
export function cardMeta(idea: Idea): string {
  const n = idea.tags.length;
  return `${passedCount(idea.checks)} of 4 checks · ${n} ${n === 1 ? "tag" : "tags"}`;
}

/** The checks of the form as typed, so the panel follows the owner before a save. */
export function formChecks(form: IdeaForm): IdeaChecks {
  const input = toInput(form);
  return {
    hasTag: input.tags.length > 0,
    hasSource: input.source !== null,
    hasWhy: input.why !== null,
    hasOutline: input.outline !== null,
  };
}

/** A link must be a web address; the core checks it again. */
export function linkError(form: IdeaForm): string | null {
  if (form.sourceMode !== "link" || !form.sourceUrl.trim()) return null;
  return /^https?:\/\/\S+$/i.test(form.sourceUrl.trim())
    ? null
    : "Enter an address that starts with http:// or https://";
}

/** Which field a refused-save message is about, so the error shows next to it. */
export type FieldName = "title" | "text" | "why" | "outline" | "tags" | "link";
export function fieldOfError(message: string): FieldName {
  const m = message.toLowerCase();
  if (m.includes("tag")) return "tags";
  if (m.includes("why")) return "why";
  if (m.includes("outline")) return "outline";
  if (m.includes("link") || m.includes("source")) return "link";
  if (m.includes("text")) return "text";
  return "title";
}
