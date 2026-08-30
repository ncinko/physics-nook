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
    'Isolate a single system and draw a complete free-body diagram for it',
    'Tell third-law partners apart from forces that balance on one diagram',
    "Apply Newton's second law along tilted axes on an inclined plane",
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
        "Isolate one object, draw every force acting on it, and turn the picture into equations with Newton's three laws.",
      seo: {
        title: 'Free-Body Diagrams',
        description:
          "Build free-body diagrams interactively, separate third-law partners from balanced forces, and apply Newton's second law along tilted axes on an inclined plane.",
        canonicalPath: '/forces/free-body-diagrams',
        image: '/social/physics-nook-card.svg',
        // Unlisted lesson: reachable only by typing the URL, so keep it out of
        // the sitemap and site search until it ships.
        noindex: true,
      },
    },
  ],
};
