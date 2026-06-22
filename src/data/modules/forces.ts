import type { ModuleMeta } from './types';

export const forcesModule: ModuleMeta = {
  slug: 'forces',
  href: '/forces',
  title: 'Forces',
  navLabel: 'Forces',
  summary:
    'Build force intuition with Newt the physics frog, from spring-like contacts to gravity and friction.',
  audience: 'Self-learners moving from kinematics into Newtonian dynamics.',
  prerequisites: ['Vectors in two dimensions', 'Acceleration', 'Basic algebra'],
  learningObjectives: [
    'Connect net force to acceleration',
    'Use spring-like microscopic models for normal force and tension',
    'Draw force vectors for gravity, friction, normal force, tension, and applied pushes',
  ],
  status: 'active',
  navVisibility: 'hidden',
  cardEyebrow: 'Mechanics',
  accent: '#16a34a',
  heroImage: '/social/physics-nook-card.svg',
  pages: [
    {
      id: 'forces-core',
      href: '/forces',
      title: 'Forces',
      description:
        'Explore common mechanics forces with Newt the physics frog, from spring-like contact forces to gravity and friction.',
      seo: {
        title: 'Forces',
        description:
          'Learn common mechanics forces with inline interactives featuring Newt the physics frog, including spring force, normal force, tension, gravity, and friction.',
        canonicalPath: '/forces',
        image: '/social/physics-nook-card.svg',
      },
    },
  ],
};
