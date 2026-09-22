import { useEffect, useRef } from 'react';

const FOCUSABLE = 'button:not([disabled]):not([tabindex="-1"]), [href], input, [tabindex="0"]';

/** Escape closes, focus moves into the dialog, Tab stays inside, and focus returns to the opener. */
export function useDialogFocus<T extends HTMLElement>(isOpen: boolean, onClose: () => void) {
  const dialogRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const isOutside = !dialog.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || isOutside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || isOutside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      opener?.focus();
    };
  }, [isOpen]);

  return dialogRef;
}
