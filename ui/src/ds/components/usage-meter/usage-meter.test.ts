// @vitest-environment happy-dom
import { expect, test } from "vitest";
import {
  buildRunCount,
  buildUsageMeter,
  USAGE_PAUSE_AT,
  USAGE_WARN_AT,
  usageTone,
} from "./usage-meter";

test("the tone changes at 60 and 95", () => {
  expect(usageTone(USAGE_WARN_AT - 1)).toBe("normal");
  expect(usageTone(USAGE_WARN_AT)).toBe("warn");
  expect(usageTone(USAGE_PAUSE_AT - 1)).toBe("warn");
  expect(usageTone(USAGE_PAUSE_AT)).toBe("pause");
});

test("a normal meter shows the share, the reset time and two ticks", () => {
  const meter = buildUsageMeter({
    label: "Usage now",
    percent: 32,
    resetsAt: "14:00",
  });
  expect(meter.className).toBe("meter");
  expect(meter.querySelector(".meter-value")?.textContent).toBe("32% used");
  expect(meter.querySelector(".meter-note")?.textContent).toBe(
    "Resets at 14:00.",
  );
  const ticks = [...meter.querySelectorAll<HTMLElement>(".meter-tick")];
  expect(ticks.map((t) => t.style.left)).toEqual(["60%", "95%"]);
});

test("the track is a meter with its value and a label", () => {
  const track = buildUsageMeter({
    label: "Usage now",
    percent: 62,
  }).querySelector('[role="meter"]');
  expect(track?.getAttribute("aria-valuenow")).toBe("62");
  expect(track?.getAttribute("aria-valuemin")).toBe("0");
  expect(track?.getAttribute("aria-valuemax")).toBe("100");
  expect(track?.getAttribute("aria-label")).toBe("Usage now 62%");
});

test("warning and pause say so in words with an icon, not by colour alone", () => {
  const warn = buildUsageMeter({ label: "Usage now", percent: 62 });
  expect(warn.classList.contains("meter-warn")).toBe(true);
  expect(warn.querySelector(".meter-note")?.textContent).toBe(
    "Over 60%. Background jobs pause at 95%.",
  );
  expect(warn.querySelector(".meter-note svg")).not.toBeNull();
  const pause = buildUsageMeter({ label: "Usage now", percent: 96 });
  expect(pause.classList.contains("meter-pause")).toBe(true);
  expect(pause.querySelector(".meter-note")?.textContent).toContain("paused");
});

test("the share is clamped to 0 to 100", () => {
  const over = buildUsageMeter({ label: "x", percent: 140 });
  expect(over.querySelector(".meter-value")?.textContent).toBe("100% used");
  const under = buildUsageMeter({ label: "x", percent: -5 });
  expect(under.querySelector(".meter-value")?.textContent).toBe("0% used");
});

test("the run count has no bar and says what it cannot know", () => {
  const meter = buildRunCount({ label: "Mnemo's runs today", count: 14 });
  expect(meter.querySelector('[role="meter"]')).toBeNull();
  expect(meter.querySelector(".meter-value")?.textContent).toBe("14");
  expect(meter.textContent).toContain("Your full Claude usage is not shown.");
});
