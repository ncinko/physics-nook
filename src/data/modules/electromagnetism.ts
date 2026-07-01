import type { ModuleMeta } from './types';

export const electromagnetismModule: ModuleMeta = {
  slug: 'electromagnetism',
  href: '/electromagnetism',
  title: 'Electromagnetism',
  navLabel: 'Electromagnetism',
  summary:
    'Coulomb’s law, electric fields and field lines, electric potential, and circuits with Ohm’s law.',
  audience: 'Self-learners moving from mechanics into electricity and the field picture.',
  prerequisites: ['Vectors in two dimensions', 'Coulomb’s law and charge', 'Work and potential energy'],
  learningObjectives: [
    'Define the electric field as force per unit charge and build it from point charges',
    'Use superposition to combine fields and read field lines',
    'Connect electric potential energy, electric potential, and the field as its gradient',
    'Relate microscopic electron drift to Ohm’s law and circuit behavior',
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
      id: 'electromagnetism-current',
      href: '/electromagnetism/current',
      title: 'Electric Current',
      shortTitle: 'Current',
      description:
        'Follow charges into motion: the Drude model of electron drift, Ohm’s law, and series–parallel circuits.',
      seo: {
        title: 'Electric Current',
        description:
          'Learn electric current from the microscopic Drude model of electron drift up to Ohm’s law, power, and series–parallel circuit behavior.',
        canonicalPath: '/electromagnetism/current',
        image: '/social/physics-nook-card.svg',
      },
    },
  ],
};
