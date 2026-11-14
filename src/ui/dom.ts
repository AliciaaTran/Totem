// Tiny DOM helpers. Text always goes in through textContent, never innerHTML,
// because decoded card text comes from a link anyone can craft.

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  element.append(...children);
  return element;
}

export function fillSelect<T extends number>(
  select: HTMLSelectElement,
  values: readonly T[],
  labels: Record<T, string>,
  placeholder?: string,
): void {
  select.replaceChildren();
  if (placeholder) select.append(el('option', { value: '' }, placeholder));
  for (const value of values) select.append(el('option', { value: String(value) }, labels[value]));
}
