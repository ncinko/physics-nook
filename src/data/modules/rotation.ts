import type { ModuleMeta } from './types';

export const rotationModule: ModuleMeta = {
  slug: 'rotation',
  href: '/rotation',
  title: 'Rotational Dynamics',
  navLabel: 'Rotation',
  summary:
    'Angular kinematics, torque and moment of inertia, rolling motion, and angular momentum, then a step into rotating reference frames and the centrifugal and Coriolis effects.',
  audience: 'Self-learners extending Newtonian dynamics into rotation and non-inertial frames.',
  prerequisites: ['Forces and Newton’s second law', 'Vectors in two dimensions', 'Circular motion basics'],
  learningObjectives: [
    'Relate angular position, velocity, and acceleration to their linear analogs through s = rθ and v = rω',
    'Relate torque, moment of inertia, and angular acceleration through τ = Iα',
    'Split the kinetic energy of rolling between translation and rotation, and predict races down an incline',
    'Apply conservation of angular momentum when the moment of inertia changes',
    'Distinguish centripetal force from the apparent centrifugal and Coriolis effects in a rotating frame',
  ],
  status: 'active',
  navVisibility: 'menu',
  cardEyebrow: 'Rotational dynamics',
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
      id: 'rotation-angular-kinematics',
      href: '/rotation/angular-kinematics',
      title: 'Angular Kinematics',
      shortTitle: 'Angular Kinematics',
      description:
        'Describe spin with radians: angular position, velocity, and acceleration, the v = rω link to linear motion, and the rotational kinematic equations.',
      seo: {
        title: 'Angular Kinematics',
        description:
          'Learn angular position, velocity, and acceleration with interactive rolling-wheel and spin-up graphers connecting θ, ω, and α to their linear analogs.',
        canonicalPath: '/rotation/angular-kinematics',
        image: '/social/physics-nook-card.svg',
      },
    },
    {
      id: 'rotation-torque-and-inertia',
      href: '/rotation/torque-and-inertia',
      title: 'Torque & Moment of Inertia',
      shortTitle: 'Torque & Inertia',
      description:
        'Build the rotational analogs of force and mass — lever arms and τ = rF sin θ, moment of inertia from mass distribution, and Newton’s second law for rotation.',
      seo: {
        title: 'Torque and Moment of Inertia',
        description:
          'Explore torque, lever arms, and moment of inertia with interactive explorers, then connect them through Newton’s second law for rotation, τ = Iα.',
        canonicalPath: '/rotation/torque-and-inertia',
        image: '/social/physics-nook-card.svg',
      },
    },
    {
      id: 'rotation-rolling-and-energy',
      href: '/rotation/rolling-and-energy',
      title: 'Rolling & Rotational Energy',
      shortTitle: 'Rolling & Energy',
      description:
        'Combine translation and spin: rolling without slipping, kinetic energy split between ½mv² and ½Iω², and why shape decides the race down an incline.',
      seo: {
        title: 'Rolling Motion and Rotational Energy',
        description:
          'Race a hoop, disk, and spheres down an interactive incline to see rolling without slipping and how kinetic energy splits between translation and rotation.',
        canonicalPath: '/rotation/rolling-and-energy',
        image: '/social/physics-nook-card.svg',
      },
    },
    {
      id: 'rotation-angular-momentum',
      href: '/rotation/angular-momentum',
      title: 'Angular Momentum',
      shortTitle: 'Angular Momentum',
      description:
        'Meet L = Iω and its conservation: spinning skaters, dropped disks, and why kinetic energy can change while angular momentum cannot.',
      seo: {
        title: 'Angular Momentum and Its Conservation',
        description:
          'Learn angular momentum L = Iω with an interactive figure-skater spin and rotational collisions showing conservation when net external torque is zero.',
        canonicalPath: '/rotation/angular-momentum',
        image: '/social/physics-nook-card.svg',
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
