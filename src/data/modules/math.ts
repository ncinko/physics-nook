import type { ModuleMeta } from './types';

export const mathModule: ModuleMeta = {
  slug: 'math',
  href: '/math/vectors',
  title: 'Math Foundations',
  navLabel: 'Math',
  summary:
    'Vector interpretation, components, and operations for physics problem solving.',
  audience: 'Self-learners preparing for mechanics, free-body diagrams, and two-dimensional motion.',
  prerequisites: ['Signed numbers', 'Coordinate axes', 'Basic algebra'],
  learningObjectives: [
    'Interpret vectors as quantities with both magnitude and direction',
    'Read and write two-dimensional vectors using components',
    'Connect graphical head-to-tail addition to symbolic component addition',
    'Scale and negate vectors and read the effect on magnitude and direction',
    'Express vectors with unit vectors and connect the formalism to physical units',
  ],
  status: 'active',
  navVisibility: 'menu',
  cardEyebrow: 'Math tools',
  accent: '#0f766e',
  heroImage: '/social/physics-nook-card.svg',
  pages: [
    {
      id: 'math-vectors',
      href: '/math/vectors',
      title: 'Vectors',
      description:
        'Learn to read vectors by their components, magnitude, and direction, and to add them head-to-tail, starting from hops on a number line.',
      seo: {
        title: 'Vectors',
        description:
          'Learn how to read vectors by components, magnitude, and direction, and add them head-to-tail — building up from a bunny hopping on a number line.',
        canonicalPath: '/math/vectors',
        image: '/social/physics-nook-card.svg',
      },
    },
    {
      id: 'math-more-vectors',
      href: '/math/more-vectors',
      title: 'More with Vectors',
      shortTitle: 'More Vectors',
      description:
        'Scale and negate vectors, build them from unit vectors, and see how the same formalism carries physical units.',
      seo: {
        title: 'More with Vectors',
        description:
          'Scale and negate vectors, write them with unit vectors, and connect displacement, velocity, and force through the units a vector carries.',
        canonicalPath: '/math/more-vectors',
        image: '/social/physics-nook-card.svg',
      },
    },
  ],
};
