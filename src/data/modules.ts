import type { PageMeta } from './site';
import { homePageMeta, standalonePages } from './site';
import { normalizePath } from '../utils/paths';

export type ModuleStatus = 'flagship' | 'active';
export type ModuleNavVisibility = 'menu' | 'hidden';

export interface ModulePage {
  id: string;
  href: string;
  title: string;
  shortTitle?: string;
  description: string;
  seo: PageMeta;
}

export interface ModuleMeta {
  slug: string;
  href: string;
  title: string;
  navLabel: string;
  summary: string;
  audience: string;
  prerequisites: string[];
  learningObjectives: string[];
  status: ModuleStatus;
  navVisibility: ModuleNavVisibility;
  cardEyebrow: string;
  accent: string;
  heroImage: string;
  featured?: boolean;
  pages: ModulePage[];
}

export interface ModulePathGroup {
  id: string;
  href: string;
  navLabel: string;
  summary: string;
  cardEyebrow: string;
  navVisibility: ModuleNavVisibility;
  pages: ModulePage[];
}

export const modules: ModuleMeta[] = [
  {
    slug: 'relativity',
    href: '/relativity',
    title: 'Relativity',
    navLabel: 'Relativity',
    summary:
      'Spacetime diagrams, relativistic energy & momentum, and general relativity.',
    audience: 'Self-learners building intuition before or alongside a formal course.',
    prerequisites: [
      'Comfort reading graphs and coordinate axes',
      'Basic algebra with square roots and ratios',
      'Familiarity with velocity, momentum, and energy in classical mechanics',
    ],
    learningObjectives: [
      'Read spacetime diagrams and explain why simultaneity depends on the observer',
      'Connect beta, gamma, momentum, and energy in one-dimensional special relativity',
      'Describe gravity geometrically through the equivalence principle and geodesics',
    ],
    status: 'flagship',
    navVisibility: 'menu',
    cardEyebrow: 'Relativity',
    accent: '#3b82f6',
    heroImage: '/social/relativity-card.svg',
    featured: true,
    pages: [
      {
        id: 'spacetime-diagrams',
        href: '/relativity',
        title: 'Spacetime Diagrams',
        shortTitle: 'Spacetime',
        description:
          'Events, worldlines, and a geometric interpretation of space & time.',
        seo: {
          title: 'Relativity',
          description:
            'Start the relativity path with spacetime diagrams, worldlines, light cones, and relativity of simultaneity.',
          canonicalPath: '/relativity',
          image: '/social/relativity-card.svg',
        },
      },
      {
        id: 'momentum-energy',
        href: '/relativity/momentum-energy',
        title: 'Relativistic Momentum and Energy',
        shortTitle: 'Momentum and Energy',
        description:
          'See how momentum and energy transform near the speed of light.',
        seo: {
          title: 'Relativistic Momentum and Energy',
          description:
            'Compare classical and relativistic momentum and energy with a guided one-dimensional explorer.',
          canonicalPath: '/relativity/momentum-energy',
          image: '/social/relativity-card.svg',
        },
      },
      {
        id: 'general-relativity',
        href: '/relativity/general-relativity',
        title: 'General Relativity',
        shortTitle: 'General Relativity',
        description:
          'Connect accelerating frames to gravity through the equivalence principle, and move beyond flat spacetime.',
        seo: {
          title: 'General Relativity',
          description:
            'Explore the equivalence principle, geodesics, and tidal gravity through an interactive introduction to general relativity.',
          canonicalPath: '/relativity/general-relativity',
          image: '/social/relativity-card.svg',
        },
      },
    ],
  },
  {
    slug: 'oscillations',
    href: '/oscillations',
    title: 'Oscillations',
    navLabel: 'Oscillations',
    summary:
      'Explore springs, pendulums, and coupled resonance through sinusoidal motion, restoring forces, and energy exchange.',
    audience: 'Self-learners reinforcing the language of periodic motion.',
    prerequisites: ['Basic force diagrams', 'Algebra', 'Graphs of sine and cosine'],
    learningObjectives: [
      'Connect restoring force to simple harmonic motion',
      'Relate period, frequency, angular frequency, and resonant driving',
      'Track the energy exchange within one oscillator and between coupled neighbors',
      'Use coupled oscillators as a bridge from periodic motion to waves',
    ],
    status: 'active',
    navVisibility: 'menu',
    cardEyebrow: 'Core module',
    accent: '#0f766e',
    heroImage: '/social/physics-nook-card.svg',
    pages: [
      {
        id: 'oscillations-core',
        href: '/oscillations',
        title: 'Oscillations',
        description:
          'Use springs and pendulums to connect equilibrium, sinusoidal motion, and energy exchange.',
        seo: {
          title: 'Oscillations',
          description:
            'Learn simple harmonic motion through restoring forces, sinusoidal motion, and a spring-mass explorer.',
          canonicalPath: '/oscillations',
          image: '/social/physics-nook-card.svg',
        },
      },
      {
        id: 'oscillations-resonance',
        href: '/oscillations/resonance',
        title: 'Resonance',
        description:
          'Use coupled oscillators to connect driven resonance, normal modes, and the first hints of wave motion.',
        seo: {
          title: 'Resonance',
          description:
            'Explore driven resonance, coupled oscillators, and normal modes as a bridge from oscillations to waves.',
          canonicalPath: '/oscillations/resonance',
          image: '/social/physics-nook-card.svg',
        },
      },
    ],
  },
  {
    slug: 'waves',
    href: '/waves',
    title: 'Waves',
    navLabel: 'Waves',
    summary:
      'Compare transverse and longitudinal waves while adjusting amplitude, wavelength, and frequency.',
    audience: 'Self-learners building visual intuition for traveling waves.',
    prerequisites: ['Basic graph reading', 'Ratios', 'Periodic motion vocabulary'],
    learningObjectives: [
      'Differentiate transverse and longitudinal motion',
      'Relate amplitude, wavelength, period, and speed',
      'Track how the medium moves differently from the wave pattern',
    ],
    status: 'active',
    navVisibility: 'menu',
    cardEyebrow: 'Core module',
    accent: '#2563eb',
    heroImage: '/social/physics-nook-card.svg',
    pages: [
      {
        id: 'waves-core',
        href: '/waves',
        title: 'Waves',
        description:
          'Build intuition for wave propagation by comparing what the pattern does with what the medium does.',
        seo: {
          title: 'Waves',
          description:
            'Explore wave propagation with interactive transverse and longitudinal wave comparisons.',
          canonicalPath: '/waves',
          image: '/social/physics-nook-card.svg',
        },
      },
    ],
  },
  {
    slug: 'quantum',
    href: '/quantum',
    title: 'Quantum',
    navLabel: 'Quantum',
    summary:
      'Move from key experiments into wavefunctions, superposition, quantization, and tunneling.',
    audience: 'Self-learners building a first modern-physics intuition before a formal quantum course.',
    prerequisites: [
      'Core wave vocabulary such as wavelength, frequency, and interference',
      'Basic energy relationships and algebra',
      'Comfort reading graphs and simple probability statements',
    ],
    learningObjectives: [
      'Use the photoelectric effect and double-slit interference to explain why classical pictures break down',
      'Interpret a wavefunction through amplitudes, probabilities, normalization, and measurement',
      'Connect boundary conditions to quantized energy levels and describe tunneling qualitatively',
    ],
    status: 'active',
    navVisibility: 'hidden',
    cardEyebrow: 'Next module',
    accent: '#0891b2',
    heroImage: '/social/physics-nook-card.svg',
    pages: [
      {
        id: 'quantum-foundations',
        href: '/quantum',
        title: 'Quantum Foundations',
        shortTitle: 'Foundations',
        description:
          'Use the photoelectric effect and single-particle interference to motivate quantum ideas.',
        seo: {
          title: 'Quantum Foundations',
          description:
            'Start the quantum path with the photoelectric effect, de Broglie wavelength, and a double-slit build-up explorer.',
          canonicalPath: '/quantum',
          image: '/social/physics-nook-card.svg',
        },
      },
      {
        id: 'quantum-wavefunctions',
        href: '/quantum/wavefunctions',
        title: 'Wavefunctions and Superposition',
        shortTitle: 'Wavefunctions',
        description:
          'Interpret amplitudes, probabilities, phase, and measurement in a one-dimensional quantum state.',
        seo: {
          title: 'Wavefunctions and Superposition',
          description:
            'Learn how wavefunctions encode amplitudes, normalization, superposition, and position measurements.',
          canonicalPath: '/quantum/wavefunctions',
          image: '/social/physics-nook-card.svg',
        },
      },
      {
        id: 'quantum-quantization',
        href: '/quantum/quantization',
        title: 'Quantization and Tunneling',
        shortTitle: 'Quantization',
        description:
          'Use boundary conditions and barriers to build intuition for discrete energies and tunneling.',
        seo: {
          title: 'Quantization and Tunneling',
          description:
            'Explore the Schrödinger equation, particle-in-a-box states, and tunneling through a finite barrier.',
          canonicalPath: '/quantum/quantization',
          image: '/social/physics-nook-card.svg',
        },
      },
    ],
  },
  {
    slug: 'collisions',
    href: '/collisions',
    title: 'Collisions',
    navLabel: 'Collisions',
    summary:
      'Use one-dimensional collisions to compare momentum conservation with changing kinetic energy.',
    audience: 'Self-learners practicing momentum bookkeeping.',
    prerequisites: ['Vectors in one dimension', 'Momentum and kinetic energy basics', 'Algebra'],
    learningObjectives: [
      'Identify when momentum is conserved',
      'Distinguish elastic, inelastic, and perfectly inelastic collisions',
      'Use worked examples to solve one-dimensional collision problems',
    ],
    status: 'active',
    navVisibility: 'hidden',
    cardEyebrow: 'Core module',
    accent: '#dc2626',
    heroImage: '/social/physics-nook-card.svg',
    pages: [
      {
        id: 'collisions-core',
        href: '/collisions',
        title: 'Collisions',
        description:
          'Compare elastic and inelastic collisions while keeping momentum and energy bookkeeping straight.',
        seo: {
          title: 'Collisions',
          description:
            'Learn elastic and inelastic collisions through worked examples and a one-dimensional collision explorer.',
          canonicalPath: '/collisions',
          image: '/social/physics-nook-card.svg',
        },
      },
    ],
  },
  {
    slug: 'energy',
    href: '/energy',
    title: 'Energy',
    navLabel: 'Energy',
    summary:
      'Track kinetic, gravitational, and thermal energy with a cart moving along a curved track.',
    audience: 'Self-learners connecting work, potential energy, and conservation.',
    prerequisites: ['Force and motion basics', 'Algebra', 'Graphs and rates of change'],
    learningObjectives: [
      'Use the work-energy theorem to organize motion',
      'Reinterpret conservative work as changes in potential energy',
      'Track how friction shifts mechanical energy into thermal energy',
    ],
    status: 'active',
    navVisibility: 'hidden',
    cardEyebrow: 'Next module',
    accent: '#7c3aed',
    heroImage: '/social/physics-nook-card.svg',
    pages: [
      {
        id: 'energy-core',
        href: '/energy',
        title: 'Energy',
        description:
          'Use a curved track explorer to connect work, potential energy, mechanical energy, and friction.',
        seo: {
          title: 'Energy',
          description:
            'Explore the work-energy theorem and energy conservation with a curved-track energy explorer.',
          canonicalPath: '/energy',
          image: '/social/physics-nook-card.svg',
        },
      },
    ],
  },
];

export const featuredModule = modules.find((module) => module.featured) ?? modules[0];

export const secondaryModules = modules.filter((module) => module.slug !== featuredModule.slug);

const mustGetModuleBySlug = (slug: string) => {
  const module = modules.find((entry) => entry.slug === slug);

  if (!module) {
    throw new Error(`Unknown module slug: ${slug}`);
  }

  return module;
};

const relativityModule = mustGetModuleBySlug('relativity');
const oscillationsModule = mustGetModuleBySlug('oscillations');
const wavesModule = mustGetModuleBySlug('waves');
const quantumModule = mustGetModuleBySlug('quantum');
const collisionsModule = mustGetModuleBySlug('collisions');

export const quantumModuleMeta = quantumModule;

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
    'Periodic motion, springs, pendulums, and traveling waves collected under one quieter thread.',
  cardEyebrow: 'Waves & oscillations',
  navVisibility: 'menu',
  pages: [
    oscillationsModule.pages[0],
    oscillationsModule.pages[1],
    wavesModule.pages[0],
  ],
} satisfies ModulePathGroup;

export const momentumPath = {
  id: 'momentum',
  href: '/collisions',
  navLabel: 'Momentum',
  summary:
    'Momentum bookkeeping, collisions, and later impulse-focused lessons collected under one path.',
  cardEyebrow: 'Momentum',
  navVisibility: 'menu',
  pages: [collisionsModule.pages[0]],
} satisfies ModulePathGroup;

export const exploreModuleGroups = [
  relativityPath,
  wavesAndOscillationsPath,
  momentumPath,
].filter((group) => group.navVisibility === 'menu');

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
