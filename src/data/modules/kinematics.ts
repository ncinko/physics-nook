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
    'Read displacement and change in velocity as signed areas under motion graphs',
    'Apply the constant-acceleration equations to free fall with a = -g',
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
        'Learn position, velocity, and acceleration through graph slopes, signed areas, free fall, and a stop-in-zones challenge.',
      seo: {
        title: '1D Kinematics',
        description:
          'Learn one-dimensional kinematics with interactive position, velocity, and acceleration graphs, signed areas, free fall, and a stop-in-zones challenge.',
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
    {
      id: 'kinematics-video-analysis',
      href: '/kinematics/video-analysis',
      title: 'Video Analysis',
      shortTitle: 'Video Analysis',
      description:
        'Measure real motion from a phone video: mark the object frame by frame, set a scale, and fit the position data.',
      seo: {
        title: 'Video Analysis',
        description:
          'Measure real motion from a phone video. Mark the moving object frame by frame, set a distance scale and frame rate, plot position and velocity, and fit a quadratic to find the acceleration.',
        canonicalPath: '/kinematics/video-analysis',
        image: '/social/physics-nook-card.svg',
      },
    },
  ],
};
