// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createCard } from "./card";

test("a card is an article with the card class, and the title goes in as text", () => {
  const card = createCard({
    title: "<b>x</b>",
    children: [document.createElement("p")],
  });
  expect(card.tagName).toBe("ARTICLE");
  expect(card.classList.contains("card")).toBe(true);
  expect(card.querySelector("h3")?.textContent).toBe("<b>x</b>");
  expect(card.querySelector("b")).toBeNull();
  expect(card.querySelector("p")).not.toBeNull();
});

test("the heading level can change", () => {
  expect(
    createCard({ title: "T", level: 4 }).querySelector("h4"),
  ).not.toBeNull();
});
