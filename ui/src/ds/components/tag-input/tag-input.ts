// Tag input: Enter adds a tag, Backspace on an empty box removes the last one, and each tag has a
// remove button with a name. Tag names go in as text.
import { X } from "lucide";
import { createIcon } from "../../icon";
import { nextControlId } from "../field/id";
import "./tag-input.css";

export interface TagInputOptions {
  readonly tags?: readonly string[];
  readonly placeholder?: string;
  readonly onChange?: (tags: readonly string[]) => void;
}

export interface TagInput {
  /** The box. Put it in a Field as `control`, with `input` as `target`. */
  readonly wrap: HTMLElement;
  readonly input: HTMLInputElement;
  tags(): string[];
}

export function createTagInput(
  doc: Document,
  options: TagInputOptions = {},
): TagInput {
  const wrap = doc.createElement("div");
  wrap.className = "tags";
  const input = doc.createElement("input");
  input.type = "text";
  input.id = nextControlId("tags");
  if (options.placeholder) input.placeholder = options.placeholder;
  wrap.append(input);

  const tags = () =>
    [...wrap.querySelectorAll(".tag")].map(
      (t) => t.firstChild?.textContent ?? "",
    );
  const changed = () => options.onChange?.(tags());
  const add = (name: string) => {
    const tag = doc.createElement("span");
    tag.className = "tag";
    tag.append(doc.createTextNode(name));
    const remove = doc.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove tag ${name}`);
    remove.append(createIcon(X));
    remove.addEventListener("click", () => {
      tag.remove();
      input.focus();
      changed();
    });
    tag.append(remove);
    wrap.insertBefore(tag, input);
  };
  for (const name of options.tags ?? []) add(name);

  input.addEventListener("keydown", (event) => {
    // An input method (Vietnamese Telex, IBus) is composing: Enter and Backspace belong to it.
    if (event.isComposing || event.keyCode === 229) return;
    const text = input.value.trim();
    if (event.key === "Enter" && text) {
      event.preventDefault();
      add(text);
      input.value = "";
      changed();
    } else if (event.key === "Backspace" && !input.value) {
      const last = [...wrap.querySelectorAll(".tag")].pop();
      if (last) {
        last.remove();
        changed();
      }
    }
  });
  return { wrap, input, tags };
}
