// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { buildBanner } from "./banner";

test("info and warn are status messages, an error is an alert", () => {
  expect(buildBanner({ tone: "info", message: "x" }).getAttribute("role")).toBe(
    "status",
  );
  expect(buildBanner({ tone: "warn", message: "x" }).getAttribute("role")).toBe(
    "status",
  );
  expect(buildBanner({ tone: "bad", message: "x" }).getAttribute("role")).toBe(
    "alert",
  );
});

test("the tone sets the class and every tone has an icon", () => {
  expect(buildBanner({ tone: "info", message: "x" }).className).toBe("banner");
  for (const tone of ["warn", "bad"] as const) {
    const banner = buildBanner({ tone, message: "x" });
    expect(banner.className).toBe(`banner banner-${tone}`);
    expect(banner.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  }
});

test("lead and message go in as text", () => {
  const banner = buildBanner({
    tone: "bad",
    lead: "<b>Lead.</b>",
    message: "<i>Body</i>",
  });
  expect(banner.querySelector("i")).toBeNull();
  expect(banner.textContent).toBe("<b>Lead.</b> <i>Body</i>");
  expect(banner.querySelector("b")?.textContent).toBe("<b>Lead.</b>");
});

test("the one action is a button that calls back", () => {
  const onClick = vi.fn();
  const banner = buildBanner({
    tone: "info",
    message: "x",
    action: { label: "Review", onClick },
  });
  const buttons = banner.querySelectorAll("button");
  expect(buttons.length).toBe(1);
  expect(buttons[0]?.type).toBe("button");
  expect(buttons[0]?.textContent).toBe("Review");
  buttons[0]?.click();
  expect(onClick).toHaveBeenCalledOnce();
});

test("without an action there is no button", () => {
  expect(
    buildBanner({ tone: "info", message: "x" }).querySelector("button"),
  ).toBeNull();
});
