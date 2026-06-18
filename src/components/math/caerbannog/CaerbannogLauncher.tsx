import { Suspense, lazy, useEffect, useState } from 'react';

// Thin, always-mounted listener for the hidden "Rabbit of Caerbannog" game.
// BunnyCompanion dispatches `caerbannog:open` when the bunny is clicked during
// its rare red-eyed glare; only then do we lazy-load the (heavy) game so its
// bundle stays out of the initial page load. Deliberately NOT registered in
// src/data/interactives.ts — it's an easter egg, not a catalog entry.
const CaerbannogDefense = lazy(() => import('./CaerbannogDefense'));

export function CaerbannogLauncher() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('caerbannog:open', onOpen);
    return () => window.removeEventListener('caerbannog:open', onOpen);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Hidden game: the Rabbit of Caerbannog"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          setOpen(false);
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(3px)',
      }}
    >
      <div
        className="relative w-full max-w-5xl rounded-2xl border border-[var(--grid-line)] bg-[var(--sim-bg)] p-4 shadow-2xl"
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close game"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--grid-line)] bg-[var(--bg-primary)] text-lg leading-none text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
        >
          ×
        </button>
        <Suspense
          fallback={
            <div className="flex h-72 items-center justify-center text-sm text-[var(--text-muted)]">
              Summoning the rabbit…
            </div>
          }
        >
          <CaerbannogDefense onExit={() => setOpen(false)} />
        </Suspense>
      </div>
    </div>
  );
}
