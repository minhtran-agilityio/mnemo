// A tiny shared store: one value, readers subscribe, writers replace it.
export type Store<T> = {
  get(): T;
  set(next: T): void;
  update(change: (current: T) => T): void;
  subscribe(listener: (value: T) => void): () => void;
};

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  const store: Store<T> = {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) listener(value);
    },
    update: (change) => store.set(change(value)),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return store;
}
