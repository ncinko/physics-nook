import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { CHICKEN_COUNT_OPEN_EVENT } from './ChickenCompanion';
import { ChickenCountGame } from './ChickenCountGame';

export function ChickenCountLauncher() {
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const openGame = () => setOpen(true);
    window.addEventListener(CHICKEN_COUNT_OPEN_EVENT, openGame);
    return () => window.removeEventListener(CHICKEN_COUNT_OPEN_EVENT, openGame);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[80] overflow-y-auto bg-black/45 px-3 py-5 backdrop-blur-sm sm:px-5"
      onClick={() => setOpen(false)}
    >
      <div className="mx-auto flex min-h-full max-w-4xl items-center">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Chicken counting game"
          className="w-full"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mb-2 flex justify-end">
            <button
              ref={closeButtonRef}
              type="button"
              aria-label="Close chicken counting game"
              onClick={() => setOpen(false)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-sm transition hover:border-[var(--accent-blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-blue)]"
            >
              <X aria-hidden="true" size={18} strokeWidth={2.5} />
            </button>
          </div>
          <ChickenCountGame className="my-0" />
        </div>
      </div>
    </div>
  );
}
