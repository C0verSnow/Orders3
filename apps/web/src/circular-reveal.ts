import { flushSync } from 'react-dom';

// One document snapshot pair for both preferences. Do not mount a second React tree:
// it would duplicate queries, dialogs and forms and could lose unsaved drafts.
let revealing = false;
export async function circularReveal(trigger: HTMLElement, update: () => void) {
  if (revealing) return false;
  const root = document.documentElement;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !document.startViewTransition) {
    flushSync(update);
    return true;
  }
  revealing = true;
  const rect = trigger.getBoundingClientRect();
  const x = rect.left + rect.width / 2,
    y = rect.top + rect.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  root.style.setProperty('--reveal-x', `${x}px`);
  root.style.setProperty('--reveal-y', `${y}px`);
  root.style.setProperty('--reveal-radius', `${radius}px`);
  root.dataset.revealing = 'true';
  let applied = false;
  const apply = () => {
    if (!applied) {
      applied = true;
      flushSync(update);
    }
  };
  try {
    const transition = document.startViewTransition(apply);
    // If snapshots cannot be created (hidden document, interrupted navigation),
    // the preference update still completes and the UI remains usable.
    await transition.finished.catch(() => undefined);
    await transition.updateCallbackDone;
  } finally {
    apply();
    delete root.dataset.revealing;
    root.style.removeProperty('--reveal-x');
    root.style.removeProperty('--reveal-y');
    root.style.removeProperty('--reveal-radius');
    revealing = false;
  }
  return true;
}
