// @vitest-environment happy-dom
import { beforeEach, expect, test } from "vitest";
import { type ChoiceList, createChoiceList } from "./choice-list";

type Theme = "system" | "light" | "dark";
let list: ChoiceList<Theme>;
let changes: Theme[];

const CHOICES = [
  { value: "system", label: "System", hint: "Matches your computer." },
  { value: "light", label: "Light", hint: "Light background, dark text." },
  { value: "dark", label: "Dark", hint: "Dark background, light text." },
] as const;

beforeEach(() => {
  changes = [];
  document.body.replaceChildren();
  list = createChoiceList<Theme>(document, {
    legend: "Colours",
    name: "theme",
    choices: CHOICES,
    value: "system",
    onChange: (v) => changes.push(v),
  });
  document.body.append(list.element);
});

const radio = (v: Theme) =>
  document.querySelector<HTMLInputElement>(`#theme-${v}`) as HTMLInputElement;

test("it is a fieldset with a legend and one native radio per choice", () => {
  const group = list.element.querySelector("fieldset");
  expect(group?.querySelector("legend")?.textContent).toBe("Colours");
  const radios =
    list.element.querySelectorAll<HTMLInputElement>("input[type=radio]");
  expect([...radios].map((r) => r.value)).toEqual(["system", "light", "dark"]);
  for (const r of radios) expect(r.name).toBe("theme");
  expect(radio("system").checked).toBe(true);
});

test("each radio has a label with for and a hint named by aria-describedby", () => {
  for (const c of CHOICES) {
    const r = radio(c.value);
    const label = list.element.querySelector(`label[for="${r.id}"]`);
    expect(label?.textContent).toBe(c.label);
    const hint = document.getElementById(
      r.getAttribute("aria-describedby") ?? "",
    );
    expect(hint?.textContent).toBe(c.hint);
  }
});

test("checking a choice tells the caller once, with its value", () => {
  radio("dark").click();
  expect(changes).toEqual(["dark"]);
  expect(radio("dark").checked).toBe(true);
  expect(radio("system").checked).toBe(false);
});

test("the keyboard reaches the checked radio, and its label clicks it", () => {
  radio("system").focus();
  expect(document.activeElement).toBe(radio("system"));
  (
    list.element.querySelector('label[for="theme-light"]') as HTMLLabelElement
  ).click();
  expect(radio("light").checked).toBe(true);
});

test("the error line is hidden until there is an error, and says it as a status", () => {
  const error = list.element.querySelector<HTMLElement>(".choice-list-error");
  expect(error?.getAttribute("role")).toBe("status");
  expect(error?.hidden).toBe(true);
  list.setError("Mnemo could not save the theme.");
  expect(error?.hidden).toBe(false);
  expect(error?.textContent).toBe("Mnemo could not save the theme.");
  list.setError(null);
  expect(error?.hidden).toBe(true);
  expect(error?.textContent).toBe("");
});

test("disabled turns off every radio", () => {
  const off = createChoiceList(document, {
    legend: "Colours",
    name: "off",
    choices: CHOICES,
    disabled: true,
  });
  expect(off.element.querySelector("fieldset")?.disabled).toBe(true);
});

test("setValue checks a choice without telling the caller", () => {
  list.setValue("light");
  expect(radio("light").checked).toBe(true);
  expect(changes).toEqual([]);
});

test("long hints and markup stay text", () => {
  const long = "A hint that goes on ".repeat(20);
  const odd = createChoiceList(document, {
    legend: "<b>x</b>",
    name: "odd",
    choices: [{ value: "a", label: "<i>A</i>", hint: long }],
  });
  expect(odd.element.querySelector("b, i")).toBeNull();
  expect(odd.element.querySelector(".choice-list-hint")?.textContent).toBe(
    long,
  );
});
