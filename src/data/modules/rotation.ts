import type { ModuleMeta } from './types';

export const rotationModule: ModuleMeta = {
  slug: 'rotation',
  href: '/rotation',
  title: 'Rotational Dynamics',
  navLabel: 'Rotation',
  summary:
    'Torque, moment of inertia, and angular momentum, then a step into rotating reference frames and the centrifugal and Coriolis effects.',
  audience: 'Self-learners extending Newtonian dynamics into rotation and non-inertial frames.',
  prerequisites: ['Forces and Newton’s second law', 'Vectors in two dimensions', 'Circular motion basics'],
  learningObjectives: [
    'Relate torque, moment of inertia, and angular acceleration through τ = Iα',
    'Connect angular momentum and rotational kinetic energy to their linear analogs',
    'Decompose acceleration in polar coordinates into radial and transverse parts',
    'Distinguish centripetal force from the apparent centrifugal and Coriolis effects in a rotating frame',
  ],
  status: 'active',
  navVisibility: 'hidden',
  cardEyebrow: 'Mechanics',
  accent: '#16a34a',
  heroImage: '/social/physics-nook-card.svg',
  pages: [
    {
      id: 'rotation-core',
      href: '/rotation',
      title: 'Rotational Dynamics',
      shortTitle: 'Rotation',
      description:
        'Build the rotational analogs of force and mass: torque, moment of inertia, angular momentum, and rotational kinetic energy.',
      seo: {
        title: 'Rotational Dynamics',
        description:
          'Learn rotational dynamics with interactive torque, moment of inertia, angular momentum, and physical pendulum simulations.',
        canonicalPath: '/rotation',
        image: '/social/physics-nook-card.svg',
        noindex: true,
      },
    },
    {
      id: 'rotation-rotating-frames',
      href: '/rotation/rotating-frames',
      title: 'Rotating Frames',
      shortTitle: 'Rotating Frames',
      description:
        'Tell centripetal force apart from the apparent centrifugal and Coriolis effects using a rotating spaceship and a bead on a spinning rod.',
      seo: {
        title: 'Rotating Reference Frames',
        description:
          'Distinguish real centripetal force from the apparent centrifugal and Coriolis effects in a rotating reference frame, with an interactive rotating spaceship.',
        canonicalPath: '/rotation/rotating-frames',
        image: '/social/physics-nook-card.svg',
      },
    },
  ],
};
