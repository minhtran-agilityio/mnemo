// @vitest-environment node
// The typed client of the model table: each wrapper sends exactly the command and arguments
// the Rust commands take (`list_ai_models`, `set_ai_model`, `reset_ai_models` in
// src-tauri/src/commands.rs), and a refusal reaches the caller as { code, message }.
import { beforeEach, expect, test, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
}));

import {
  type AiModelTable,
  errorMessage,
  isAppError,
  listAiModels,
  resetAiModels,
  setAiModel,
} from "./api";

const TABLE: AiModelTable = {
  rows: [
    { feature: "save", label: "Save a link", model: "haiku", effort: "low" },
  ],
  models: [{ value: "haiku", label: "Haiku 5.5" }],
  efforts: [{ value: "low", label: "Low" }],
};

beforeEach(() => {
  invoke.mockReset();
});

test("listAiModels calls list_ai_models with no arguments", async () => {
  invoke.mockResolvedValueOnce(TABLE);
  expect(await listAiModels()).toEqual(TABLE);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith("list_ai_models");
});

test("setAiModel sends feature, model and effort as named arguments", async () => {
  invoke.mockResolvedValueOnce(TABLE);
  expect(await setAiModel("save", "sonnet", "high")).toEqual(TABLE);
  expect(invoke).toHaveBeenCalledWith("set_ai_model", {
    feature: "save",
    model: "sonnet",
    effort: "high",
  });
});

test("resetAiModels calls reset_ai_models with no arguments", async () => {
  invoke.mockResolvedValueOnce(TABLE);
  expect(await resetAiModels()).toEqual(TABLE);
  expect(invoke).toHaveBeenCalledWith("reset_ai_models");
});

test("a refused set passes the invalid_ai_model error through", async () => {
  const refusal = {
    code: "invalid_ai_model",
    message: 'Mnemo does not know the model "gpt-4". Nothing was changed.',
  };
  invoke.mockRejectedValueOnce(refusal);
  const error = await setAiModel("save", "haiku", "low").catch((e) => e);
  expect(isAppError(error)).toBe(true);
  expect(error).toEqual(refusal);
  expect(errorMessage(error)).toBe(refusal.message);
});

test("a failed list and a failed reset pass their errors through", async () => {
  const failure = { code: "storage_error", message: "Mnemo could not read." };
  invoke.mockRejectedValueOnce(failure).mockRejectedValueOnce(failure);
  await expect(listAiModels()).rejects.toEqual(failure);
  await expect(resetAiModels()).rejects.toEqual(failure);
});
