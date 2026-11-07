import type { ModuleMeta } from './types';

export const electromagnetismModule: ModuleMeta = {
  slug: 'electromagnetism',
  href: '/electromagnetism',
  title: 'Electromagnetism',
  navLabel: 'Electromagnetism',
  summary:
    'Coulomb’s law, electric fields, Gauss’ law and flux, electric potential, capacitance, circuits with Ohm’s law, and the magnetic force and field of moving charges.',
  audience: 'Self-learners moving from mechanics into electricity and the field picture.',
  prerequisites: [
    'Vectors in two dimensions, including the cross product',
    'Coulomb’s law and charge',
    'Work and potential energy',
    'Uniform circular motion',
  ],
  learningObjectives: [
    'Define the electric field as force per unit charge and build it from point charges',
    'Use superposition to combine fields and read field lines',
    'Connect electric flux to enclosed charge and use symmetry to apply Gauss’ law',
    'Connect electric potential energy, electric potential, and the field as its gradient',
    'Relate capacitance to geometry and dielectrics and compute the energy stored in the field',
    'Relate microscopic electron drift to Ohm’s law and circuit behavior',
    'Use the Lorentz force to predict how a charge moves in a magnetic field',
    'Find magnetic fields from currents with the Biot–Savart law and Ampère’s law',
  ],
  status: 'active',
  navVisibility: 'menu',
  cardEyebrow: 'Electromagnetism',
  accent: '#6366f1',
  heroImage: '/social/physics-nook-card.svg',
  pages: [
    {
      id: 'electromagnetism-field',
      href: '/electromagnetism',
      title: 'Electric Field',
      shortTitle: 'Electric Field',
      description:
        'Define the electric field as force per unit charge, build it from point charges, and explore superposition and field lines.',
      seo: {
        title: 'Electric Field',
        description:
          'Learn the electric field as force per unit charge, build it from point charges, and explore superposition and field lines with interactive simulations.',
        canonicalPath: '/electromagnetism',
        image: '/social/physics-nook-card.svg',
      },
    },
    {
      id: 'electromagnetism-gauss-law',
      href: '/electromagnetism/gauss-law',
      title: 'Gauss’ Law',
      shortTitle: 'Gauss’ Law',
      description:
        'Understand electric flux, relate closed surfaces to enclosed charge, and use symmetry to find the field.',
      seo: {
        title: 'Gauss’ Law',
        description:
          'Explore electric flux and Gauss’ law with interactive surfaces and charges, then use spherical, cylindrical, and planar symmetry to calculate electric fields.',
        canonicalPath: '/electromagnetism/gauss-law',
        image: '/social/physics-nook-card.svg',
      },
    },
    {
      id: 'electromagnetism-potential',
      href: '/electromagnetism/potential',
      title: 'Electric Potential',
      shortTitle: 'Potential',
      description:
        'Move from force to energy: potential energy landscapes, the electric potential, and its relationship to the field.',
      seo: {
        title: 'Electric Potential',
        description:
          'Learn electric potential as potential energy per unit charge, visualize V(x,y) as a color map, and connect potential to the electric field.',
        canonicalPath: '/electromagnetism/potential',
        image: '/social/physics-nook-card.svg',
      },
    },
    {
      id: 'electromagnetism-capacitance',
      href: '/electromagnetism/capacitance',
      title: 'Capacitance',
      shortTitle: 'Capacitance',
      description:
        'Store charge and energy between conductors: C = Q/ΔV, parallel plates, dielectrics, and series–parallel combinations.',
      seo: {
        title: 'Capacitance',
        description:
          'Learn capacitance from the parallel-plate capacitor: C = ε₀A/d, the energy stored in the field, how dielectrics raise C, and how capacitors combine in series and parallel, with an interactive plate explorer.',
        canonicalPath: '/electromagnetism/capacitance',
        image: '/social/physics-nook-card.svg',
      },
    },
    {
      id: 'electromagnetism-current',
      href: '/electromagnetism/current',
      title: 'Electric Current',
      shortTitle: 'Current',
      description:
        'Follow charges into motion: electron drift, the surface charge that steers the field, Ohm’s law, and circuits.',
      seo: {
        title: 'Electric Current',
        description:
          'Learn electric current from the microscopic Drude model of electron drift through the surface charge that guides the field around a circuit, up to Ohm’s law, power, and series–parallel behavior.',
        canonicalPath: '/electromagnetism/current',
        image: '/social/physics-nook-card.svg',
      },
    },
    {
      id: 'electromagnetism-magnetic-force',
      href: '/electromagnetism/magnetic-force',
      title: 'Magnetic Force',
      shortTitle: 'Magnetic Force',
      description:
        'Use the Lorentz force on a moving charge to find which way it bends, why its speed is constant, and how big its circle is.',
      seo: {
        title: 'Magnetic Force',
        description:
          'Learn the Lorentz force F = qv × B, the right-hand rule, and why charged particles move in circles with radius mv/|q|B, with an interactive charged-particle simulation.',
        canonicalPath: '/electromagnetism/magnetic-force',
        image: '/social/physics-nook-card.svg',
      },
    },
    {
      id: 'electromagnetism-magnetic-field',
      href: '/electromagnetism/magnetic-field',
      title: 'Magnetic Field',
      shortTitle: 'Magnetic Field',
      description:
        'Find magnetic fields from currents with the Biot–Savart law and Ampère’s law, and explore wires, loops, solenoids, and magnets in 3D.',
      seo: {
        title: 'Magnetic Field',
        description:
          'Learn the magnetic field of a current from the Biot–Savart law, the right-hand rule, and Ampère’s law, with interactive demos of a straight wire, an Amperian path, and 3D fields of loops, solenoids, and bar magnets.',
        canonicalPath: '/electromagnetism/magnetic-field',
        image: '/social/physics-nook-card.svg',
      },
    },
  ],
};
