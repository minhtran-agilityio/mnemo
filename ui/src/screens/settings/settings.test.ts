// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Theme } from "../../frame/theme";
import { renderSettings, type SettingsDeps } from "./settings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

let container: HTMLElement;
let current: Theme;
let saves: Theme[];
let applied: Theme[];
let release: Array<() => void>;
let failWith: unknown;

function deps(): SettingsDeps {
  return {
    getTheme: () => current,
    applyTheme: (theme) => {
      current = theme;
      applied.push(theme);
    },
    saveTheme: (theme) => {
      saves.push(theme);
      if (failWith) return Promise.reject(failWith);
      return new Promise<void>((done) => release.push(done));
    },
  };
}

function rowText(name: string): string {
  const row = [...container.querySelectorAll("button.settings-row")].find(
    (b) => b.querySelector(".settings-row-name")?.textContent === name,
  );
  return (row?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function pick(label: string): void {
  const radio = container.querySelector<HTMLInputElement>(
    `#theme-${label.toLowerCase()}`,
  );
  if (!radio) throw new Error(`no ${label} choice`);
  radio.click();
}

const tick = () => new Promise((done) => setTimeout(done, 0));

// The save queue outlives a screen, so every save a test left open is finished before the next test.
afterEach(async () => {
  for (const done of release) done();
  await tick();
  await tick();
});

beforeEach(() => {
  container = document.createElement("main");
  document.body.replaceChildren(container);
  current = "system";
  saves = [];
  applied = [];
  release = [];
  failWith = undefined;
  renderSettings(container, deps());
});

test("it shows the title, the note and a section list with the current value of each row", () => {
  expect(container.querySelector("h1")?.textContent).toBe("Settings");
  expect(container.querySelector(".settings-note")?.textContent).toBe(
    "Changes are saved at once.",
  );
  expect(rowText("Appearance")).toBe("Appearance System");
  expect(rowText("AI")).toMatch(/^AI \S/);
  expect(rowText("Data")).toMatch(/^Data \S/);
});

test("Appearance offers System, Light and Dark, and no other theme", () => {
  const labels = [...container.querySelectorAll(".settings-choice label")].map(
    (l) => l.textContent,
  );
  expect(labels).toEqual(["System", "Light", "Dark"]);
  const checked = container.querySelector<HTMLInputElement>("input:checked");
  expect(checked?.value).toBe("system");
});

test("the AI and Data sections open and have no controls", () => {
  for (const name of ["AI", "Data"]) {
    const row = [...container.querySelectorAll("button.settings-row")].find(
      (b) => b.querySelector(".settings-row-name")?.textContent === name,
    ) as HTMLButtonElement;
    row.click();
    expect(container.querySelector(".settings-body h2")?.textContent).toBe(
      name,
    );
    expect(container.querySelectorAll(".settings-body input").length).toBe(0);
    expect(container.querySelectorAll(".settings-body button").length).toBe(0);
  }
});

test("choosing a theme applies it at once, updates the row and saves it", async () => {
  pick("Dark");
  expect(applied).toEqual(["dark"]);
  expect(rowText("Appearance")).toBe("Appearance Dark");
  await tick();
  expect(saves).toEqual(["dark"]);
});

test("saves run one at a time, in the order of the choices", async () => {
  pick("Dark");
  pick("Light");
  pick("System");
  await tick();
  expect(saves).toEqual(["dark"]);
  release[0]?.();
  await tick();
  expect(saves).toEqual(["dark", "light"]);
  release[1]?.();
  await tick();
  expect(saves).toEqual(["dark", "light", "system"]);
  release[2]?.();
  await tick();
});

test("a failed save shows a plain line, keeps the theme applied and keeps the choices", async () => {
  failWith = {
    code: "storage",
    message: "The data file could not be written.",
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
  pick("Dark");
  await tick();
  await tick();
  const status = container.querySelector<HTMLElement>(".settings-status");
  expect(status?.hidden).toBe(false);
  expect(status?.textContent).toContain("could not save the theme");
  expect(status?.textContent).toContain("The data file could not be written.");
  expect(rowText("Appearance")).toBe("Appearance Dark");
  expect(container.querySelectorAll("input").length).toBe(3);
});

test("a later save that works clears the line", async () => {
  failWith = { code: "storage", message: "nope" };
  vi.spyOn(console, "error").mockImplementation(() => {});
  pick("Dark");
  await tick();
  await tick();
  failWith = undefined;
  pick("Light");
  await tick();
  release[0]?.();
  await tick();
  await tick();
  expect(container.querySelector<HTMLElement>(".settings-status")?.hidden).toBe(
    true,
  );
});
