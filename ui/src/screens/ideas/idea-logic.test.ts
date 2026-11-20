import { describe, expect, test } from "vitest";
import type { Idea, IdeaChecks } from "../../shared/api";
import {
  adviceText,
  cardMeta,
  checkLines,
  fieldOfError,
  formChecks,
  formOf,
  groupByStage,
  linkError,
  passedCount,
  stageLabel,
  tidyTags,
  toInput,
} from "./idea-logic";

const none: IdeaChecks = {
  hasTag: false,
  hasSource: false,
  hasWhy: false,
  hasOutline: false,
};

function idea(over: Partial<Idea> = {}): Idea {
  return {
    id: "i1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    title: "Garden robot",
    text: null,
    source: null,
    why: null,
    outline: null,
    tags: [],
    stage: "spark",
    checks: none,
    projectId: null,
    ...over,
  };
}

describe("checks", () => {
  test("each check says in words whether it passed", () => {
    const lines = checkLines({ ...none, hasTag: true, hasWhy: true });
    expect(lines.map((l) => l.ok)).toEqual([true, false, true, false]);
    expect(lines[0].text).toBe("It has a tag.");
    expect(lines[3].text).toBe("No outline yet.");
  });

  test("advice follows the number of passed checks and never blocks", () => {
    expect(adviceText(none)).toMatch(/Still a spark/);
    expect(adviceText({ ...none, hasTag: true, hasSource: true })).toMatch(
      /You can start now/,
    );
    const all = {
      hasTag: true,
      hasSource: true,
      hasWhy: true,
      hasOutline: true,
    };
    expect(passedCount(all)).toBe(4);
    expect(adviceText(all)).toMatch(/^Ready/);
  });
});

describe("form", () => {
  test("blank fields are sent as null and tags lose a leading #", () => {
    const input = toInput({
      ...formOf(null),
      title: "  Garden robot ",
      why: "   ",
      tags: ["#garden", " garden", "soil"],
    });
    expect(input).toEqual({
      title: "Garden robot",
      text: null,
      source: null,
      why: null,
      outline: null,
      tags: ["garden", "soil"],
    });
  });

  test("a source is a saved item or a link, never both", () => {
    const base = formOf(null);
    expect(
      toInput({ ...base, sourceMode: "item", sourceItem: "note:n1" }).source,
    ).toEqual({ type: "item", item: { kind: "note", id: "n1" } });
    expect(
      toInput({
        ...base,
        sourceMode: "link",
        sourceUrl: " https://a.b ",
        sourceItem: "note:n1",
      }).source,
    ).toEqual({ type: "link", url: "https://a.b" });
    expect(
      toInput({ ...base, sourceMode: "none", sourceUrl: "https://a.b" }).source,
    ).toBeNull();
  });

  test("a saved idea fills the form and comes back unchanged", () => {
    const saved = idea({
      text: "t",
      why: "w",
      outline: "a\nb",
      tags: ["x"],
      source: { type: "item", item: { kind: "bookmark", id: "b1" } },
    });
    const form = formOf(saved);
    expect(form.sourceMode).toBe("item");
    expect(toInput(form)).toEqual({
      title: saved.title,
      text: "t",
      source: saved.source,
      why: "w",
      outline: "a\nb",
      tags: ["x"],
    });
  });

  test("tidyTags drops empty and repeated tags", () => {
    expect(tidyTags(["", "#", "a", "a "])).toEqual(["a"]);
  });
});

describe("board", () => {
  test("ideas are grouped by the stage the core set", () => {
    const g = groupByStage([
      idea({ id: "a", stage: "ready" }),
      idea({ id: "b", stage: "spark" }),
      idea({ id: "c", stage: "project" }),
    ]);
    expect(g.ready.map((i) => i.id)).toEqual(["a"]);
    expect(g.spark.map((i) => i.id)).toEqual(["b"]);
    expect(g.shape).toEqual([]);
    expect(g.project.map((i) => i.id)).toEqual(["c"]);
    expect(stageLabel("shape")).toBe("Shape");
  });

  test("the card meta counts checks and tags", () => {
    expect(
      cardMeta(idea({ tags: ["a"], checks: { ...none, hasTag: true } })),
    ).toBe("1 of 4 checks · 1 tag");
    expect(cardMeta(idea())).toBe("0 of 4 checks · 0 tags");
  });
});

describe("live form checks and errors", () => {
  test("the panel follows the form as typed", () => {
    const f = { ...formOf(null), tags: ["a"], why: "because" };
    expect(passedCount(formChecks(f))).toBe(2);
    expect(formChecks({ ...f, tags: [] }).hasTag).toBe(false);
  });

  test("a link that is not a web address is named before the save", () => {
    const f = { ...formOf(null), sourceMode: "link" as const };
    expect(linkError({ ...f, sourceUrl: "ftp://x" })).toMatch(/http/);
    expect(linkError({ ...f, sourceUrl: "https://x.y/z" })).toBeNull();
    expect(linkError({ ...f, sourceUrl: "" })).toBeNull();
  });

  test("a refused save message points at its field", () => {
    expect(fieldOfError("A tag is too long (at most 40 characters).")).toBe(
      "tags",
    );
    expect(
      fieldOfError("The why line must be null or 1 to 500 characters."),
    ).toBe("why");
    expect(fieldOfError("The title cannot be empty.")).toBe("title");
    expect(fieldOfError("The source must be a saved link or a note.")).toBe(
      "link",
    );
  });
});
