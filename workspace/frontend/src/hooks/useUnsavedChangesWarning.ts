import { useEffect } from 'react';

export function useUnsavedChangesWarning(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const protectNavigation = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectNavigation);
    return () => window.removeEventListener('beforeunload', protectNavigation);
  }, [dirty]);
}
