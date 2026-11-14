// Motion that answers the user's actions: rows arriving, rows leaving, forms opening.
// Every animation is skipped when the user prefers reduced motion.

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

function skip(): boolean {
  return reduceMotion.matches || typeof Element.prototype.animate !== 'function';
}

/** Resolve when the animation ends, or after its duration anyway (background tabs pause animations). */
function settle(animation: Animation, duration: number): Promise<void> {
  return Promise.race([
    animation.finished.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => setTimeout(resolve, duration + 80)),
  ]);
}

/** A new row grows into place, then glows gold briefly so the eye finds it. */
export function animateEnter(element: HTMLElement): void {
  if (skip()) return;
  const style = getComputedStyle(element);
  const height = element.offsetHeight;
  element.style.overflow = 'hidden';
  const grow = element.animate(
    [
      { height: '0px', opacity: 0, transform: 'translateY(-8px) scale(0.98)', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px' },
      { height: `${height}px`, opacity: 1, transform: 'none', marginBottom: style.marginBottom, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom },
    ],
    { duration: 320, easing: EASE_OUT },
  );
  grow.onfinish = () => (element.style.overflow = '');
  highlight(element, 200);
}

/** An edited row glows gold to show what changed. */
export function highlight(element: HTMLElement, delay = 0): void {
  if (skip()) return;
  const base = getComputedStyle(element).backgroundColor;
  element.animate([{ backgroundColor: '#ffe9a3' }, { backgroundColor: base }], {
    duration: 1400,
    delay,
    easing: 'ease-out',
    fill: 'backwards',
  });
}

/** A deleted row slides away and collapses; resolves when it is gone. */
export async function animateLeave(element: HTMLElement): Promise<void> {
  if (skip()) return;
  const style = getComputedStyle(element);
  element.style.overflow = 'hidden';
  const leave = element.animate(
    [
      { height: `${element.offsetHeight}px`, opacity: 1, transform: 'none', marginBottom: style.marginBottom, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom },
      { height: `${element.offsetHeight}px`, opacity: 0, transform: 'translateX(-32px)', offset: 0.55, marginBottom: style.marginBottom, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom },
      { height: '0px', opacity: 0, transform: 'translateX(-32px)', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px' },
    ],
    { duration: 380, easing: 'ease-in-out', fill: 'forwards' },
  );
  await settle(leave, 380);
}

/** Show a hidden panel by growing it open. */
export function expand(element: HTMLElement): void {
  element.hidden = false;
  if (skip()) return;
  const height = element.scrollHeight;
  element.animate(
    [
      { height: '0px', opacity: 0 },
      { height: `${height}px`, opacity: 1 },
    ],
    { duration: 300, easing: EASE_OUT },
  );
}

/** Hide a panel by shrinking it closed. */
export async function collapse(element: HTMLElement): Promise<void> {
  if (element.hidden) return;
  if (!skip()) {
    const animation = element.animate(
      [
        { height: `${element.offsetHeight}px`, opacity: 1 },
        { height: '0px', opacity: 0 },
      ],
      { duration: 220, easing: 'ease-in' },
    );
    await settle(animation, 220);
    animation.cancel();
  }
  element.hidden = true;
}
