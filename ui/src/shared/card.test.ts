// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { buildCard } from "./card";

test("buildCard shows title and meta as text", () => {
  const el = buildCard({ id: "c1", title: "Read", meta: "3 links" });
  expect(el.dataset.cardId).toBe("c1");
  expect(el.querySelector("strong")?.textContent).toBe("Read");
  expect(el.querySelector(".card-meta")?.textContent).toBe("3 links");
});

test("buildCard keeps markup in a title as text, never as elements", () => {
  const el = buildCard({
    id: "c2",
    title: '<img src=x onerror="alert(1)"><script>x()</script>',
    meta: "",
  });
  expect(el.querySelector("img")).toBeNull();
  expect(el.querySelector("script")).toBeNull();
  expect(el.querySelector("strong")?.textContent).toBe(
    '<img src=x onerror="alert(1)"><script>x()</script>',
  );
  expect(el.querySelector(".card-meta")?.textContent).toBe("");
});
