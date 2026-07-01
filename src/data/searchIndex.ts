import { modules } from './modules';
import { standalonePages } from './site';
import { interactiveEntries } from './interactives';
import { primaryNavItems } from './navigation';
import { normalizePath } from '../utils/paths';

export type SearchEntryKind = 'lesson' | 'explorer' | 'interactive';

export interface SearchEntry {
  id: string;
  title: string;
  description: string;
  href: string;
  section: string;
  kind: SearchEntryKind;
}

const lessonEntries: SearchEntry[] = modules
  // Excludes modules not yet published to the nav (e.g. Thermodynamics) so an
  // in-progress module can't be found until it's ready.
  .filter((module) => module.navVisibility === 'menu')
  .flatMap((module) =>
    module.pages
      .filter((page) => !page.seo.noindex)
      .map((page) => ({
        id: `lesson-${page.id}`,
        title: page.title,
        description: page.description,
        href: page.seo.canonicalPath,
        section: module.navLabel,
        kind: 'lesson' as const,
      })),
  );

const interactiveSearchEntries: SearchEntry[] = interactiveEntries.map((entry) => ({
  id: `interactive-${entry.id}`,
  title: entry.title,
  description: entry.description,
  href: entry.href,
  section: entry.module,
  kind: 'interactive' as const,
}));

const interactiveBaseHrefs = new Set(interactiveEntries.map((entry) => entry.href.split('#')[0]));
const primaryNavHrefs = new Set(primaryNavItems.map((item) => normalizePath(item.href)));

// Pages that are always one click away from the navbar (Home, Resources, ...)
// don't need their own search entry.
const explorerEntries: SearchEntry[] = standalonePages
  .filter(
    (page) =>
      !page.noindex &&
      !primaryNavHrefs.has(normalizePath(page.canonicalPath)) &&
      !interactiveBaseHrefs.has(page.canonicalPath),
  )
  .map((page) => ({
    id: `explorer-${page.canonicalPath}`,
    title: page.title,
    description: page.description,
    href: page.canonicalPath,
    section: 'Explorers',
    kind: 'explorer' as const,
  }));

// Combined, build-time search corpus for the site search palette. Every entry
// here comes from data already registered for the sitemap/interactives catalog,
// so a new page or interactive becomes searchable automatically once it's
// registered per docs/adding-content.md / docs/adding-simulations.md.
export const searchEntries: SearchEntry[] = [
  ...lessonEntries,
  ...explorerEntries,
  ...interactiveSearchEntries,
];
