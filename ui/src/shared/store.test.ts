// @vitest-environment node
import { expect, test, vi } from "vitest";
import { createStore } from "./store";

test("subscribers hear each change until they unsubscribe", () => {
  const store = createStore(1);
  const seen = vi.fn();
  const stop = store.subscribe(seen);
  store.set(2);
  store.update((n) => n + 1);
  stop();
  store.set(10);
  expect(seen.mock.calls).toEqual([[2], [3]]);
  expect(store.get()).toBe(10);
});

test("setting the same value does not notify", () => {
  const store = createStore<string | null>(null);
  const seen = vi.fn();
  store.subscribe(seen);
  store.set(null);
  expect(seen).not.toHaveBeenCalled();
});
