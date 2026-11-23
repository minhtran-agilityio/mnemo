// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AiEffort, AiModel, AiModelTable } from "../../shared/api";
import { type AiModelsDeps, createAiModelsCard } from "./ai-models";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const MODELS = [
  { value: "haiku", label: "Haiku 5.5" },
  { value: "sonnet", label: "Sonnet 5.5" },
  { value: "opus", label: "Opus 5.5" },
] as AiModelTable["models"];
const EFFORTS = [
  { value: "low", label: "Low effort" },
  { value: "medium", label: "Medium effort" },
  { value: "high", label: "High effort" },
] as AiModelTable["efforts"];

function table(
  save: [AiModel, AiEffort] = ["haiku", "low"],
  ask: [AiModel, AiEffort] = ["sonnet", "medium"],
): AiModelTable {
  return {
    rows: [
      {
        feature: "save",
        label: "Save a link",
        model: save[0],
        effort: save[1],
      },
      { feature: "ask", label: "Ask Mnemo", model: ask[0], effort: ask[1] },
    ],
    models: MODELS,
    efforts: EFFORTS,
  };
}

let container: HTMLElement;
let sets: Array<[string, AiModel, AiEffort]>;
let resets: number;
let listResult: () => Promise<AiModelTable>;
let setResult: (f: string, m: AiModel, e: AiEffort) => Promise<AiModelTable>;
let resetResult: () => Promise<AiModelTable>;

function deps(): AiModelsDeps {
  return {
    listAiModels: () => listResult(),
    setAiModel: (f, m, e) => {
      sets.push([f, m, e]);
      return setResult(f, m, e);
    },
    resetAiModels: () => {
      resets += 1;
      return resetResult();
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function mount() {
  const card = createAiModelsCard(document, deps());
  container.append(card.element);
  return card;
}

function select(name: string): HTMLSelectElement {
  const s = container.querySelector<HTMLSelectElement>(
    `select[aria-label="${name}"]`,
  );
  if (!s) throw new Error(`no select ${name}`);
  return s;
}

function choose(name: string, label: string): void {
  const s = select(name);
  s.value = label;
  s.dispatchEvent(new Event("change"));
}

function resetButton(): HTMLButtonElement {
  const b = [...container.querySelectorAll("button")].find(
    (x) => x.textContent?.trim() === "Reset to defaults",
  );
  if (!b) throw new Error("no reset button");
  return b;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  sets = [];
  resets = 0;
  listResult = async () => table();
  setResult = async (f, m, e) =>
    f === "save" ? table([m, e]) : table(undefined, [m, e]);
  resetResult = async () => table();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

test("shows a loading line, then one row per feature with its model and effort", async () => {
  let done: (t: AiModelTable) => void = () => {};
  listResult = () => new Promise((r) => (done = r));
  mount();
  expect(container.textContent).toContain("Reading the AI models");
  expect(resetButton().disabled).toBe(true);
  done(table());
  await flush();
  expect(container.textContent).toContain("Save a link");
  expect(container.textContent).toContain("Ask Mnemo");
  expect(select("Model for Save a link").value).toBe("Haiku 5.5");
  expect(select("Effort for Save a link").value).toBe("Low effort");
  expect(select("Model for Ask Mnemo").value).toBe("Sonnet 5.5");
  expect(select("Effort for Ask Mnemo").value).toBe("Medium effort");
  expect(resetButton().disabled).toBe(false);
});

test("a changed model is saved at once with the row's feature and values", async () => {
  mount();
  await flush();
  choose("Model for Save a link", "Opus 5.5");
  await flush();
  expect(sets).toEqual([["save", "opus", "low"]]);
  choose("Effort for Ask Mnemo", "High effort");
  await flush();
  expect(sets[1]).toEqual(["ask", "sonnet", "high"]);
  expect(container.querySelector(".setting-row-error")).toBeNull();
});

test("the row is disabled while its save is pending", async () => {
  let done: (t: AiModelTable) => void = () => {};
  setResult = () => new Promise((r) => (done = r));
  mount();
  await flush();
  choose("Model for Save a link", "Opus 5.5");
  expect(select("Model for Save a link").disabled).toBe(true);
  expect(select("Effort for Save a link").disabled).toBe(true);
  expect(select("Model for Ask Mnemo").disabled).toBe(false);
  done(table(["opus", "low"]));
  await flush();
  expect(select("Model for Save a link").disabled).toBe(false);
});

test("a refused value shows a plain error and the old value stays", async () => {
  setResult = () =>
    Promise.reject({
      code: "invalid_ai_model",
      message: "Unknown model 'gpt'. Choose Haiku, Sonnet or Opus.",
    });
  mount();
  await flush();
  choose("Model for Save a link", "Opus 5.5");
  await flush();
  expect(select("Model for Save a link").value).toBe("Haiku 5.5");
  const alert = container.querySelector(".setting-row-error");
  expect(alert?.textContent).toContain("could not save this choice");
  expect(alert?.textContent).toContain("Unknown model 'gpt'");
  expect(alert?.textContent).toContain("The old choice stays");
});

test("a good save after a failure clears the error line", async () => {
  let fail = true;
  setResult = async (f, m, e) => {
    if (fail) throw { code: "storage", message: "Disk full." };
    return f === "save" ? table([m, e]) : table();
  };
  mount();
  await flush();
  choose("Model for Save a link", "Opus 5.5");
  await flush();
  expect(container.querySelector(".setting-row-error")).not.toBeNull();
  fail = false;
  choose("Model for Save a link", "Sonnet 5.5");
  await flush();
  expect(container.querySelector(".setting-row-error")).toBeNull();
  expect(select("Model for Save a link").value).toBe("Sonnet 5.5");
});

test("Reset to defaults asks the core and redraws the rows from its answer", async () => {
  listResult = async () => table(["opus", "high"]);
  mount();
  await flush();
  expect(select("Model for Save a link").value).toBe("Opus 5.5");
  resetButton().click();
  await flush();
  expect(resets).toBe(1);
  expect(select("Model for Save a link").value).toBe("Haiku 5.5");
  expect(select("Effort for Save a link").value).toBe("Low effort");
});

test("a reset that fails says so and keeps the rows", async () => {
  listResult = async () => table(["opus", "high"]);
  resetResult = () =>
    Promise.reject({ code: "storage", message: "Disk full." });
  mount();
  await flush();
  resetButton().click();
  await flush();
  expect(container.textContent).toContain("Could not reset.");
  expect(container.textContent).toContain("Your choices did not change.");
  expect(select("Model for Save a link").value).toBe("Opus 5.5");
});

test("a list that cannot be read shows an error with Try again", async () => {
  let fail = true;
  listResult = async () => {
    if (fail) throw { code: "storage", message: "Database locked." };
    return table();
  };
  mount();
  await flush();
  expect(container.textContent).toContain("Could not read the AI models.");
  expect(container.textContent).toContain("Database locked.");
  expect(container.querySelector("select")).toBeNull();
  fail = false;
  const again = [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Try again",
  );
  again?.click();
  await flush();
  expect(select("Model for Save a link").value).toBe("Haiku 5.5");
});

test("the AI-off note shows and hides; the rows stay editable", async () => {
  const card = mount();
  await flush();
  card.setAiOff(true);
  expect(container.textContent).toContain("AI is off now");
  expect(select("Model for Save a link").disabled).toBe(false);
  card.setAiOff(false);
  expect(container.textContent).not.toContain("AI is off now");
});
