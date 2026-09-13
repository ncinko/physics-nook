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
    'Draw interaction diagrams and use a system boundary to find the forces on a system',
    'Isolate a single system and draw a complete free-body diagram for it',
    'Tell third-law partners apart from forces that balance on one diagram',
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
      shortTitle: 'Forces',
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
    {
      id: 'forces-free-body-diagrams',
      href: '/forces/free-body-diagrams',
      title: 'Free-Body Diagrams',
      shortTitle: 'Free-Body Diagrams',
      description:
        "Map every interaction, draw a boundary around one system, and turn its free-body diagram into equations with Newton's three laws.",
      seo: {
        title: 'Free-Body Diagrams',
        description:
          "Draw interaction diagrams, choose a system boundary, build free-body diagrams interactively, and apply Newton's three laws to elevators, pushes, and pulleys.",
        canonicalPath: '/forces/free-body-diagrams',
        image: '/social/physics-nook-card.svg',
        // Unlisted lesson: reachable only by typing the URL, so keep it out of
        // the sitemap and site search until it ships.
        noindex: true,
      },
    },
  ],
};
