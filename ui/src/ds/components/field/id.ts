// A unique id for form controls built by the design system (labels and hints point at it).
let counter = 0;

export function nextControlId(prefix: string): string {
  counter += 1;
  return `ds-${prefix}-${counter}`;
}
