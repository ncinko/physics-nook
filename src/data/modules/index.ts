import { homePageMeta, standalonePages } from '../site';
import { normalizePath } from '../../utils/paths';
import type { ModuleMeta, ModulePage, ModulePathGroup } from './types';

import { mathModule } from './math';
import { measurementModule } from './measurement';
import { kinematicsModule } from './kinematics';
import { relativityModule } from './relativity';
import { oscillationsModule } from './oscillations';
import { wavesModule } from './waves';
import { quantumModule } from './quantum';
import { thermodynamicsModule } from './thermodynamics';
import { forcesModule } from './forces';
import { collisionsModule } from './collisions';
import { energyModule } from './energy';
import { electromagnetismModule } from './electromagnetism';
import { rotationModule } from './rotation';
import { astronomyModule } from './astronomy';

export * from './types';

// Order is significant: it drives `publicPageMeta` and anything that iterates
// `modules`. Per-domain metadata lives in the sibling files; this index only
// assembles the list and the cross-module structures derived from it.
export const modules: ModuleMeta[] = [
  mathModule,
  measurementModule,
  kinematicsModule,
  relativityModule,
  oscillationsModule,
  wavesModule,
  quantumModule,
  thermodynamicsModule,
  forcesModule,
  collisionsModule,
  energyModule,
  electromagnetismModule,
  rotationModule,
  astronomyModule,
];

export const featuredModule = modules.find((module) => module.featured) ?? modules[0];

export const secondaryModules = modules.filter((module) => module.slug !== featuredModule.slug);

const gameSiteUrl =
  import.meta.env.PUBLIC_GAME_URL ??
  (import.meta.env.DEV ? 'http://127.0.0.1:5173' : 'https://game.physicsnook.com');
const orbitalsGameHref = `${gameSiteUrl.replace(/\/$/, '')}/orbitals/`;

export const quantumModuleMeta = quantumModule;

export const mathPath = {
  id: 'math',
  href: mathModule.href,
  navLabel: mathModule.navLabel,
  summary: mathModule.summary,
  cardEyebrow: mathModule.cardEyebrow,
  navVisibility: 'menu',
  pages: mathModule.pages,
} satisfies ModulePathGroup;

export const measurementPath = {
  id: 'measurement',
  href: measurementModule.href,
  navLabel: measurementModule.navLabel,
  summary: measurementModule.summary,
  cardEyebrow: measurementModule.cardEyebrow,
  navVisibility: 'menu',
  pages: measurementModule.pages,
} satisfies ModulePathGroup;

export const mechanicsPath = {
  id: 'mechanics',
  href: kinematicsModule.href,
  navLabel: 'Mechanics',
  summary:
    'One- and two-dimensional kinematics, forces, vectors, collisions, and energy conservation.',
  cardEyebrow: 'Mechanics',
  navVisibility: 'menu',
  pages: [
    ...kinematicsModule.pages,
    forcesModule.pages[0],
    collisionsModule.pages[0],
    energyModule.pages[0],
  ],
} satisfies ModulePathGroup;

export const rotationPath = {
  id: 'rotation',
  // Landing page skips the hidden Rotational Dynamics draft (rotationModule.pages[0]).
  href: rotationModule.pages[1].href,
  navLabel: rotationModule.navLabel,
  summary: rotationModule.summary,
  cardEyebrow: rotationModule.cardEyebrow,
  navVisibility: 'menu',
  // pages[0] is the hidden draft index; surface only the public rotation lessons.
  pages: rotationModule.pages.slice(1),
} satisfies ModulePathGroup;

export const astronomyPath = {
  id: 'astronomy',
  href: astronomyModule.href,
  navLabel: astronomyModule.navLabel,
  summary: astronomyModule.summary,
  cardEyebrow: astronomyModule.cardEyebrow,
  navVisibility: 'menu',
  pages: astronomyModule.pages,
} satisfies ModulePathGroup;

export const relativityPath = {
  id: 'relativity',
  href: relativityModule.href,
  navLabel: relativityModule.navLabel,
  summary: relativityModule.summary,
  cardEyebrow: relativityModule.cardEyebrow,
  navVisibility: 'menu',
  pages: relativityModule.pages,
} satisfies ModulePathGroup;

export const wavesAndOscillationsPath = {
  id: 'waves-and-oscillations',
  href: '/oscillations',
  navLabel: 'Waves & Oscillations',
  summary:
    'Simple harmonic motion, springs, pendulums, resonance, standing waves, and wave reflection.',
  cardEyebrow: 'Waves & oscillations',
  navVisibility: 'menu',
  pages: [
    oscillationsModule.pages[0],
    oscillationsModule.pages[1],
    ...wavesModule.pages,
  ],
} satisfies ModulePathGroup;

export const electromagnetismPath = {
  id: 'electromagnetism',
  href: electromagnetismModule.href,
  navLabel: electromagnetismModule.navLabel,
  summary: electromagnetismModule.summary,
  cardEyebrow: electromagnetismModule.cardEyebrow,
  navVisibility: 'menu',
  pages: electromagnetismModule.pages,
} satisfies ModulePathGroup;

export const quantumPath = {
  id: 'quantum',
  href: quantumModule.href,
  navLabel: quantumModule.navLabel,
  summary: quantumModule.summary,
  cardEyebrow: quantumModule.cardEyebrow,
  navVisibility: 'menu',
  pages: quantumModule.pages,
} satisfies ModulePathGroup;

export const thermodynamicsPath = {
  id: 'thermodynamics',
  href: thermodynamicsModule.href,
  navLabel: thermodynamicsModule.navLabel,
  summary: thermodynamicsModule.summary,
  cardEyebrow: thermodynamicsModule.cardEyebrow,
  navVisibility: 'hidden',
  pages: thermodynamicsModule.pages,
} satisfies ModulePathGroup;

export const textbookProgressionGroups = [
  mathPath,
  measurementPath,
  mechanicsPath,
  rotationPath,
  astronomyPath,
  wavesAndOscillationsPath,
  electromagnetismPath,
  relativityPath,
  quantumPath,
] satisfies ModulePathGroup[];

export interface TextbookProgressionEntry {
  group: ModulePathGroup;
  groupIndex: number;
  page: ModulePage;
  pageIndex: number;
}

export interface TextbookProgression {
  current: TextbookProgressionEntry;
  previous?: TextbookProgressionEntry;
  next?: TextbookProgressionEntry;
  crossesModule: boolean;
  crossesModuleBackward: boolean;
}

export const gamesPath = {
  id: 'orbitals-game',
  href: orbitalsGameHref,
  navLabel: 'Orbitals',
  summary:
    'Shared multiplayer physics sandboxes and experimental game pages.',
  cardEyebrow: 'Games',
  navVisibility: 'hidden',
  pages: [
    {
      id: 'orbitals',
      href: orbitalsGameHref,
      title: 'Orbitals',
      description:
        'A shared N-body gravity sandbox where everyone can add masses to one persistent canvas.',
      seo: {
        title: 'Orbitals',
        description:
          'A shared N-body gravity sandbox where everyone can add masses to one persistent canvas.',
        canonicalPath: '/orbitals',
        image: '/social/physics-nook-card.svg',
        noindex: true,
      },
    },
  ],
} satisfies ModulePathGroup;

export const exploreModuleGroups = [
  mathPath,
  measurementPath,
  mechanicsPath,
  rotationPath,
  astronomyPath,
  wavesAndOscillationsPath,
  electromagnetismPath,
  relativityPath,
  quantumPath,
  thermodynamicsPath,
  gamesPath,
].filter((group) => group.navVisibility === 'menu');

const textbookProgressionEntries = textbookProgressionGroups.flatMap((group, groupIndex) =>
  group.pages.map((page, pageIndex) => ({
    group,
    groupIndex,
    page,
    pageIndex,
  })),
);

export const publicPageMeta = [
  homePageMeta,
  ...standalonePages,
  ...modules.flatMap((module) => module.pages.map((page) => page.seo)),
];

export const getModuleBySlug = (slug: string) =>
  modules.find((module) => module.slug === slug);

export const getModuleByPath = (path: string) =>
  modules.find((module) => {
    const normalizedModulePath = normalizePath(module.href);
    const normalizedPath = normalizePath(path);
    return (
      normalizedPath === normalizedModulePath ||
      normalizedPath.startsWith(`${normalizedModulePath}/`)
    );
  });

export const getPageMetaByPath = (path: string) =>
  publicPageMeta.find((page) => normalizePath(page.canonicalPath) === normalizePath(path));

export const getTextbookProgressByPath = (path: string): TextbookProgression | undefined => {
  const normalizedPath = normalizePath(path);
  const currentIndex = textbookProgressionEntries.findIndex(({ page }) => {
    const normalizedHref = normalizePath(page.href);
    const normalizedCanonicalPath = normalizePath(page.seo.canonicalPath);
    return normalizedPath === normalizedHref || normalizedPath === normalizedCanonicalPath;
  });

  if (currentIndex === -1) return undefined;

  const current = textbookProgressionEntries[currentIndex];
  const previous = textbookProgressionEntries[currentIndex - 1];
  const next = textbookProgressionEntries[currentIndex + 1];

  return {
    current,
    previous,
    next,
    crossesModule: Boolean(next && next.group.id !== current.group.id),
    crossesModuleBackward: Boolean(previous && previous.group.id !== current.group.id),
  };
};
