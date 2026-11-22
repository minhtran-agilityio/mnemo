// @vitest-environment node
// Acceptance tests for #24 [AI-03] Model and effort per feature: the typed UI client (AC9).
// Run: npx vitest run --root . tests/acceptance/ai-03-api.test.ts
// (also run by tests/acceptance/ai-03-model-effort.test.mjs, so npm test covers it). Uses a mocked Tauri invoke.
//
// AC9: "Vitest tests cover the new typed client functions in ui/src/shared/api.ts (listAiModels, setAiModel,
// resetAiModels): the invoke command name, the argument shape, and error pass-through."
// The commands are the ones AC8 names: list_ai_models, set_ai_model, reset_ai_models.
// setAiModel is called as setAiModel(feature, model, effort), in the order of set_row(save, sonnet, high) in AC4.
import { resolve } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

const API_PATH = resolve(__dirname, "..", "..", "ui/src/shared/api.ts");
const load = (): Promise<any> => import(/* @vite-ignore */ API_PATH);

const ROWS = [
  { feature: "save", model: "haiku", effort: "low" },
  { feature: "ask", model: "sonnet", effort: "medium" },
];

beforeEach(() => {
  invoke.mockReset();
});

const WRAPPERS: [string, string, unknown[], unknown][] = [
  ["listAiModels", "list_ai_models", [], ROWS],
  ["setAiModel", "set_ai_model", ["save", "sonnet", "high"], { feature: "save", model: "sonnet", effort: "high" }],
  ["resetAiModels", "reset_ai_models", [], ROWS],
];

test.each(WRAPPERS)("AC9: %s calls the %s command once and returns its result", async (fn, cmd, args, result) => {
  const api = await load();
  expect(typeof api[fn], `${fn} is not exported by ui/src/shared/api.ts`).toBe("function");
  invoke.mockResolvedValueOnce(result);
  const out = await api[fn](...args);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls[0][0]).toBe(cmd);
  expect(out).toEqual(result);
});

test("AC9: setAiModel sends the feature, the model and the effort as named arguments", async () => {
  const api = await load();
  invoke.mockResolvedValueOnce({ feature: "notes", model: "opus", effort: "medium" });
  await api.setAiModel("notes", "opus", "medium");
  const sent = invoke.mock.calls[0][1];
  expect(sent !== null && typeof sent === "object", "set_ai_model got no argument object").toBe(true);
  const values = Object.values(sent as Record<string, unknown>);
  for (const part of ["notes", "opus", "medium"]) expect(values).toContain(part);
});

test("AC9: a refused set (unknown model) reaches the caller as the { code, message } error the core sent", async () => {
  const api = await load();
  const err = { code: "validation", message: "Mnemo does not know the model gpt-4. Pick Haiku 5.5, Sonnet 5.5 or Opus 5.5." };
  invoke.mockRejectedValueOnce(err);
  const caught = await api.setAiModel("save", "gpt-4", "low").catch((e: unknown) => e);
  expect(caught).toMatchObject(err);
  expect(api.isAppError(caught)).toBe(true);
  expect(api.errorMessage(caught)).toBe(err.message);
});

test("AC9: a failed list reaches the caller with its { code, message }", async () => {
  const api = await load();
  const err = { code: "storage", message: "The data file could not be read." };
  invoke.mockRejectedValueOnce(err);
  await expect(api.listAiModels()).rejects.toMatchObject(err);
});

test("AC9: a failed reset reaches the caller with its { code, message }", async () => {
  const api = await load();
  const err = { code: "storage", message: "The data file could not be written." };
  invoke.mockRejectedValueOnce(err);
  await expect(api.resetAiModels()).rejects.toMatchObject(err);
});
