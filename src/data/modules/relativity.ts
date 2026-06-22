import type { ModuleMeta } from './types';

export const relativityModule: ModuleMeta = {
  slug: 'relativity',
  href: '/relativity',
  title: 'Relativity',
  navLabel: 'Relativity',
  summary:
    'Spacetime diagrams, Lorentz transformations, relativistic energy & momentum, and general relativity.',
  audience: 'Self-learners building intuition before or alongside a formal course.',
  prerequisites: [
    'Comfort reading graphs and coordinate axes',
    'Basic algebra with square roots and ratios',
    'Familiarity with velocity, momentum, and energy in classical mechanics',
  ],
  learningObjectives: [
    'Read spacetime diagrams and explain why simultaneity depends on the observer',
    'Derive and use the Lorentz transformations for one-dimensional inertial motion',
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
      id: 'lorentz-transformations',
      href: '/relativity/lorentz-transformations',
      title: 'Lorentz Transformations',
      shortTitle: 'Lorentz',
      description:
        'Derive the coordinate transformations that preserve the speed of light for every inertial observer.',
      seo: {
        title: 'Lorentz Transformations',
        description:
          'Derive the Lorentz transformations algebraically from the constancy of the speed of light and use them to compare events between inertial frames.',
        canonicalPath: '/relativity/lorentz-transformations',
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
};
