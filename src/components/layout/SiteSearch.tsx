import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';
import { searchEntries, type SearchEntry } from '../../data/searchIndex';

const MAX_RESULTS = 8;

function scoreEntry(entry: SearchEntry, query: string): number {
  const title = entry.title.toLowerCase();
  const section = entry.section.toLowerCase();
  const description = entry.description.toLowerCase();

  if (title === query) return 100;
  if (title.startsWith(query)) return 80;
  if (title.includes(query)) return 60;
  if (section.includes(query)) return 40;
  if (description.includes(query)) return 20;
  return -1;
}

function getResults(query: string): SearchEntry[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return searchEntries.slice(0, MAX_RESULTS);

  return searchEntries
    .map((entry) => ({ entry, score: scoreEntry(entry, trimmed) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map(({ entry }) => entry);
}

export default function SiteSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => getResults(query), [query]);

  const close = () => {
    setIsOpen(false);
    setQuery('');
    setActiveIndex(0);
  };

  const open = () => {
    setIsOpen(true);
    setActiveIndex(0);
  };

  useEffect(() => {
    if (!isOpen) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(id);
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsOpen((prev) => !prev);
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if (event.key === '/' && !isTypingTarget && !isOpen) {
        event.preventDefault();
        open();
        return;
      }

      if (isOpen && event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  const navigateTo = (href: string) => {
    close();
    window.location.assign(href);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = results[activeIndex];
      if (entry) navigateTo(entry.href);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label="Search Physics Nook"
        title="Search (Ctrl+K)"
        className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] text-[color:var(--text-primary)] shadow-sm transition-all duration-300 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]"
      >
        <Search className="h-5 w-5" aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center bg-[color-mix(in_srgb,var(--bg-primary)_60%,transparent)] px-4 pt-24 backdrop-blur-sm"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search Physics Nook"
            className="w-full max-w-xl overflow-hidden rounded-[1.5rem] border border-[var(--grid-line)] bg-[color-mix(in_srgb,var(--surface-elevated)_98%,transparent)] shadow-[0_28px_85px_rgba(15,23,42,0.24)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-[var(--grid-line)] px-4 py-3">
              <Search className="h-4 w-4 flex-shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Search lessons and interactives…"
                aria-label="Search lessons and interactives"
                className="w-full bg-transparent text-sm text-[color:var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
              />
              <button
                type="button"
                onClick={close}
                aria-label="Close search"
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:text-[var(--accent-blue)]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-2">
              {results.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">
                  No matches. Try a different topic or module name.
                </p>
              ) : (
                <ul className="space-y-1">
                  {results.map((entry, index) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => navigateTo(entry.href)}
                        onMouseEnter={() => setActiveIndex(index)}
                        className={`block w-full rounded-[1rem] px-3 py-2 text-left transition-colors duration-150 ${
                          index === activeIndex
                            ? 'bg-[color-mix(in_srgb,var(--accent-blue)_12%,transparent)] text-[var(--accent-blue)]'
                            : 'text-[color:var(--text-primary)]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-sm font-semibold">{entry.title}</span>
                          <span className="ml-3 flex-shrink-0 rounded-full border border-[var(--grid-line)] px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
                            {entry.section}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-xs leading-5 text-[var(--text-muted)]">
                          {entry.description}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
