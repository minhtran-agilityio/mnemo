// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { type AiLightState, buildAiLight } from "./ai-light";

const STATES: AiLightState[] = [
  "idle",
  "running",
  "off",
  "not-installed",
  "signed-out",
  "at-limit",
];

test("every state is a status region with a word, so colour is not the only signal", () => {
  for (const state of STATES) {
    const light = buildAiLight({ state });
    expect(light.getAttribute("role")).toBe("status");
    expect(light.dataset.state).toBe(state);
    expect(light.querySelector("b")?.textContent?.length).toBeGreaterThan(0);
  }
});

test("each state says its own thing", () => {
  const says = (state: AiLightState) => buildAiLight({ state }).textContent;
  expect(says("idle")).toBe("AI ready");
  expect(says("off")).toBe("AI off · saving still works");
  expect(says("signed-out")).toBe(
    "Claude is signed out · run claude in a terminal to sign in",
  );
});

test("running counts jobs, with the right plural", () => {
  expect(buildAiLight({ state: "running", jobs: 2 }).textContent).toBe(
    "AI working · 2 jobs",
  );
  expect(buildAiLight({ state: "running", jobs: 1 }).textContent).toContain(
    "1 job",
  );
  expect(
    buildAiLight({ state: "running" }).querySelector(".pulse"),
  ).not.toBeNull();
});

test("at limit shows when AI resumes", () => {
  expect(
    buildAiLight({ state: "at-limit", resumesAt: "14:00" }).textContent,
  ).toBe("At usage limit · AI resumes at 14:00");
});

test("not installed offers a check again button that calls back", () => {
  const onCheckAgain = vi.fn();
  const light = buildAiLight({ state: "not-installed", onCheckAgain });
  const button = light.querySelector("button");
  expect(button?.type).toBe("button");
  button?.click();
  expect(onCheckAgain).toHaveBeenCalledOnce();
});

test("it never asks for a sign-in: no input and no link to a login page", () => {
  const light = buildAiLight({ state: "signed-out" });
  expect(light.querySelector("input, a")).toBeNull();
});
