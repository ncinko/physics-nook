import type { ModuleMeta } from './types';

export const thermodynamicsModule: ModuleMeta = {
  slug: 'thermodynamics',
  href: '/thermodynamics',
  title: 'Thermodynamics',
  navLabel: 'Thermodynamics',
  summary:
    'Systems, heat, work, entropy, and information viewed through energy bookkeeping and statistical reasoning.',
  audience: 'Self-learners building a first bridge from mechanics into thermal and statistical physics.',
  prerequisites: [
    'Basic energy conservation',
    'Comfort reading graphs and histograms',
    'Algebra with logarithms and proportional reasoning',
  ],
  learningObjectives: [
    'Describe systems, surroundings, equilibrium, state variables, temperature, and internal energy',
    'Use one consistent first-law sign convention with work done by the system',
    'Interpret entropy increase as a statistical tendency over microstates and macrostates',
    'Connect thermodynamic entropy with missing information, Shannon entropy, bits, and erasure cost',
  ],
  status: 'active',
  navVisibility: 'hidden',
  cardEyebrow: 'Thermodynamics',
  accent: '#ea580c',
  heroImage: '/social/physics-nook-card.svg',
  pages: [
    {
      id: 'thermodynamics-foundations',
      href: '/thermodynamics',
      title: 'Thermodynamics Foundations',
      shortTitle: 'Foundations',
      description:
        'Introduce systems, surroundings, state variables, equilibrium, temperature, and internal energy.',
      seo: {
        title: 'Thermodynamics Foundations',
        description:
          'Start the thermodynamics path with systems, state variables, thermal equilibrium, temperature, and internal energy.',
        canonicalPath: '/thermodynamics',
        image: '/social/physics-nook-card.svg',
        noindex: true,
      },
    },
    {
      id: 'thermodynamics-first-law',
      href: '/thermodynamics/first-law',
      title: 'Heat, Work, and the First Law',
      shortTitle: 'First Law',
      description:
        'Track heat and work as energy transfers using Delta U = Q - W, with work done by the system.',
      seo: {
        title: 'Heat, Work, and the First Law',
        description:
          'Learn the first law of thermodynamics with heat, work, sign conventions, and energy-ledger examples.',
        canonicalPath: '/thermodynamics/first-law',
        image: '/social/physics-nook-card.svg',
        noindex: true,
      },
    },
    {
      id: 'thermodynamics-entropy',
      href: '/thermodynamics/entropy',
      title: 'Entropy and the Second Law',
      shortTitle: 'Entropy',
      description:
        'Use macrostates, microstates, multiplicity, and Boltzmann entropy to understand the second law.',
      seo: {
        title: 'Entropy and the Second Law',
        description:
          'Explore entropy through multiplicity, Boltzmann entropy, spontaneous processes, and the second law.',
        canonicalPath: '/thermodynamics/entropy',
        image: '/social/physics-nook-card.svg',
        noindex: true,
      },
    },
    {
      id: 'thermodynamics-information-entropy',
      href: '/thermodynamics/information-entropy',
      title: 'Information and Entropy',
      shortTitle: 'Information',
      description:
        'Bridge physical entropy to Shannon entropy, bits, erasure, and Landauer cost.',
      seo: {
        title: 'Information and Entropy',
        description:
          'Connect thermodynamic entropy with missing information, Shannon entropy, bit erasure, and Landauer principle.',
        canonicalPath: '/thermodynamics/information-entropy',
        image: '/social/physics-nook-card.svg',
        noindex: true,
      },
    },
  ],
};
