import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Give a dialog the two behaviours `aria-modal` promises but does not provide:
 * Escape closes it, and Tab cannot walk out of it into the page behind.
 *
 * Focus moves to the dialog on open and returns to whatever opened it on close,
 * so a keyboard user is never dropped at the top of the document.
 */
export function useDialogDismiss(
  dialogRef: RefObject<HTMLElement | null>,
  isOpen: boolean,
  onDismiss: () => void,
): void {
  // Held in a ref so a caller passing an inline arrow does not re-run the effect
  // on every render, which would steal focus back to the first control mid-use.
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    // The ref fills in as the dialog mounts, and a ref object keeps its identity,
    // so the open flag is what tells this effect a dialog is there to guard.
    if (!isOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    focusable()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;

      const active = document.activeElement;
      const leavingBackwards = event.shiftKey && (active === first || !dialog.contains(active));
      const leavingForwards = !event.shiftKey && (active === last || !dialog.contains(active));
      if (leavingBackwards) {
        event.preventDefault();
        last.focus();
      } else if (leavingForwards) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [dialogRef, isOpen]);
}
