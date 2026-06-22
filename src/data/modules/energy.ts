import type { ModuleMeta } from './types';

export const energyModule: ModuleMeta = {
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
        'Build a 3D roller coaster and watch kinetic, potential, and thermal energy trade as the train runs.',
      seo: {
        title: 'Energy',
        description:
          'Explore the work-energy theorem, conservation, g-forces, and friction by building a 3D roller coaster and reading its live energy ledger.',
        canonicalPath: '/energy',
        image: '/social/physics-nook-card.svg',
      },
    },
  ],
};
