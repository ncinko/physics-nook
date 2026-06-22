import type { ModuleMeta } from './types';

export const collisionsModule: ModuleMeta = {
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
};
