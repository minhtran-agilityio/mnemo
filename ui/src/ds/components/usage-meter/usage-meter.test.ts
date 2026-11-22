// @vitest-environment happy-dom
import { expect, test } from "vitest";
import {
  buildRunCount,
  buildUsageMeter,
  buildUsageWindows,
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

test("the owner sets the lines: ticks, tone and note follow", () => {
  const meter = buildUsageMeter({
    label: "Usage now",
    percent: 75,
    warnAt: 70,
    pauseAt: 90,
  });
  expect(meter.classList.contains("meter-warn")).toBe(true);
  expect(meter.querySelector(".meter-note")?.textContent).toBe(
    "Over 70%. Background jobs pause at 90%.",
  );
  const ticks = [...meter.querySelectorAll<HTMLElement>(".meter-tick")];
  expect(ticks.map((t) => t.style.left)).toEqual(["70%", "90%"]);
  expect(usageTone(70, 70, 90)).toBe("warn");
  expect(usageTone(90, 70, 90)).toBe("pause");
});

test("edge lines 1 and 100", () => {
  const m = buildUsageMeter({
    label: "x",
    percent: 1,
    warnAt: 1,
    pauseAt: 100,
  });
  expect(m.classList.contains("meter-warn")).toBe(true);
  const p = buildUsageMeter({
    label: "x",
    percent: 100,
    warnAt: 1,
    pauseAt: 100,
  });
  expect(p.classList.contains("meter-pause")).toBe(true);
});

test("an unverified percent says so in words", () => {
  const meter = buildUsageMeter({
    label: "5-hour window",
    percent: 72,
    unverified: true,
    resetsAt: "14:30",
  });
  expect(meter.querySelector(".meter-value")?.textContent).toBe(
    "72% (Unverified)",
  );
  expect(meter.querySelector(".meter-reset")?.textContent).toBe("resets 14:30");
  expect(
    meter.querySelector('[role="meter"]')?.getAttribute("aria-label"),
  ).toBe("5-hour window 72% (Unverified)");
});

test("the age of a stored percent is shown", () => {
  const meter = buildUsageMeter({
    label: "x",
    percent: 10,
    readAgo: "2 h ago",
  });
  expect(meter.querySelector(".meter-age")?.textContent).toBe("Read 2 h ago.");
  const none = buildUsageMeter({ label: "x", percent: 10 });
  expect(none.querySelector(".meter-age")).toBeNull();
});

test("two windows: the higher share drives the tone", () => {
  const meter = buildUsageWindows({
    windows: [
      {
        label: "5-hour window",
        percent: 72,
        unverified: true,
        resetsAt: "14:30",
      },
      { label: "7-day window", percent: 41 },
    ],
    warnAt: 70,
    pauseAt: 90,
    readAgo: "2 h ago",
  });
  expect(meter.classList.contains("meter-warn")).toBe(true);
  expect(meter.querySelectorAll('[role="meter"]')).toHaveLength(2);
  expect(meter.querySelector(".meter-note")?.textContent).toContain("Over 70%");
  expect(meter.querySelector(".meter-age")?.textContent).toBe("Read 2 h ago.");
  const low = buildUsageWindows({
    windows: [
      { label: "a", percent: 10 },
      { label: "b", percent: 20 },
    ],
  });
  expect(low.classList.contains("meter-warn")).toBe(false);
  const high = buildUsageWindows({
    windows: [
      { label: "a", percent: 99 },
      { label: "b", percent: 20 },
    ],
  });
  expect(high.classList.contains("meter-pause")).toBe(true);
});

test("the run count shows today and this week and says the share is unknown", () => {
  const meter = buildRunCount({
    label: "Mnemo runs",
    today: 4,
    week: 19,
  });
  expect(meter.querySelector('[role="meter"]')).toBeNull();
  expect(meter.querySelector(".meter-value")?.textContent).toBe(
    "4 today, 19 this week",
  );
  expect(meter.querySelector(".meter-note")?.textContent).toBe(
    "This is a run count. The real usage share is not known yet.",
  );
});

test("a long label wraps and keeps the value", () => {
  const meter = buildUsageMeter({
    label: "A very long label ".repeat(10),
    percent: 5,
  });
  expect(
    meter.querySelector(".meter-label")?.textContent?.length,
  ).toBeGreaterThan(100);
  expect(meter.querySelector(".meter-value")?.textContent).toBe("5% used");
});

test("a reset time shows once, for each window", () => {
  const single = buildUsageMeter({
    label: "x",
    percent: 72,
    unverified: true,
    resetsAt: "14:30",
  });
  expect(single.textContent?.match(/14:30/g)).toHaveLength(1);
  const calm = buildUsageMeter({ label: "x", percent: 10, resetsAt: "14:30" });
  expect(calm.textContent?.match(/14:30/g)).toHaveLength(1);
  const two = buildUsageWindows({
    windows: [
      { label: "5h", percent: 10, resetsAt: "14:30", unverified: true },
      { label: "7d", percent: 20, resetsAt: "Mon 09:00" },
    ],
  });
  expect(two.textContent?.match(/14:30/g)).toHaveLength(1);
  expect(two.textContent?.match(/Mon 09:00/g)).toHaveLength(1);
});

test("the lines are clamped, NaN falls back, pause is never below warn", () => {
  const m = buildUsageMeter({
    label: "x",
    percent: 50,
    warnAt: -10,
    pauseAt: 500,
  });
  expect(
    [...m.querySelectorAll<HTMLElement>(".meter-tick")].map(
      (t) => t.style.left,
    ),
  ).toEqual(["0%", "100%"]);
  const nan = buildUsageMeter({
    label: "x",
    percent: 70,
    warnAt: Number.NaN,
    pauseAt: Number.NaN,
  });
  expect(
    [...nan.querySelectorAll<HTMLElement>(".meter-tick")].map(
      (t) => t.style.left,
    ),
  ).toEqual(["60%", "95%"]);
  const swapped = buildUsageMeter({
    label: "x",
    percent: 85,
    warnAt: 80,
    pauseAt: 50,
  });
  expect(swapped.classList.contains("meter-pause")).toBe(true);
  const ticks = [...swapped.querySelectorAll<HTMLElement>(".meter-tick")];
  expect(ticks.map((t) => t.style.left)).toEqual(["80%", "80%"]);
});

test("the pause is the owner's line", () => {
  const warn = buildUsageMeter({
    label: "x",
    percent: 80,
    warnAt: 70,
    pauseAt: 90,
  });
  expect(warn.querySelector(".meter-note")?.textContent).toContain(
    "pause at 90%",
  );
});

test("in two windows each bar is coloured by its own share", () => {
  const m = buildUsageWindows({
    windows: [
      { label: "a", percent: 99 },
      { label: "b", percent: 41 },
    ],
  });
  const fills = [...m.querySelectorAll(".meter-fill")];
  expect(fills[0]?.classList.contains("meter-fill-pause")).toBe(true);
  expect(fills[1]?.className).toBe("meter-fill");
});

test("each window's meter is described by the shared note", () => {
  const m = buildUsageWindows({
    windows: [
      { label: "a", percent: 80 },
      { label: "b", percent: 41 },
    ],
  });
  const id = m.querySelector(".meter-note")?.id;
  expect(id).toBeTruthy();
  for (const track of m.querySelectorAll('[role="meter"]')) {
    expect(track.getAttribute("aria-describedby")).toBe(id);
  }
});

test("an unverified figure that drives the tone says so in the note", () => {
  const m = buildUsageWindows({
    windows: [
      { label: "a", percent: 80, unverified: true },
      { label: "b", percent: 41 },
    ],
  });
  expect(m.querySelector(".meter-note")?.textContent).toContain(
    "The figure is unverified.",
  );
  const ok = buildUsageMeter({ label: "x", percent: 80 });
  expect(ok.querySelector(".meter-note")?.textContent).not.toContain(
    "unverified",
  );
});
