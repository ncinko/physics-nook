import type { ModuleMeta } from './types';

export const kinematicsModule: ModuleMeta = {
  slug: 'kinematics',
  href: '/kinematics',
  title: '1D Kinematics',
  navLabel: 'Kinematics',
  summary:
    'Position, velocity, acceleration, graph slopes, vector components, and motion challenges.',
  audience: 'Self-learners building a first mechanics foundation.',
  prerequisites: ['Graph reading', 'Signed numbers', 'Basic algebra with ratios'],
  learningObjectives: [
    'Interpret signed position, velocity, and acceleration in one dimension',
    'Connect average and instantaneous velocity to slopes on a position-time graph',
    'Connect acceleration to changes in velocity over time',
    'Use acceleration controls to solve a stop-in-zones motion challenge',
    'Break two-dimensional motion into horizontal and vertical components',
  ],
  status: 'active',
  navVisibility: 'hidden',
  cardEyebrow: 'Mechanics',
  accent: '#0f766e',
  heroImage: '/social/physics-nook-card.svg',
  pages: [
    {
      id: 'kinematics-core',
      href: '/kinematics',
      title: '1D Kinematics',
      shortTitle: '1D Motion',
      description:
        'Learn position, velocity, and acceleration through graph slopes and a stop-in-zones challenge.',
      seo: {
        title: '1D Kinematics',
        description:
          'Learn one-dimensional kinematics with interactive position and velocity graphs plus a stop-in-zones acceleration challenge.',
        canonicalPath: '/kinematics',
        image: '/social/physics-nook-card.svg',
      },
    },
    {
      id: 'kinematics-2d',
      href: '/kinematics/two-dimensional',
      title: '2D Kinematics',
      shortTitle: '2D Motion',
      description:
        'Extend kinematics into vector components, projectile motion, and two-dimensional acceleration.',
      seo: {
        title: '2D Kinematics',
        description:
          'Learn two-dimensional kinematics with vector components, projectile motion, and interactive acceleration sandboxes.',
        canonicalPath: '/kinematics/two-dimensional',
        image: '/social/physics-nook-card.svg',
      },
    },
  ],
};
