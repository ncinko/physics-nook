import type { ModuleMeta } from './types';

export const astronomyModule: ModuleMeta = {
  slug: 'astronomy',
  href: '/astronomy',
  title: 'Astronomy',
  navLabel: 'Astronomy',
  summary:
    'Make sense of the sky from the ground up: frames of reference, the scale of the system, and gravity as the force that runs it.',
  audience: 'Self-learners and curious skywatchers connecting what they see to why it happens.',
  prerequisites: [
    'Basic geometry',
    'Comfort with ratios and powers of ten',
    'Reading simple diagrams and tables',
  ],
  learningObjectives: [
    'Separate what we observe from a moving Earth from what is physically happening',
    'Explain lunar phases, the synodic month, tidal locking, and eclipse timing from geometry',
    "Use Kepler's laws and the astronomical unit to reason about orbital size, period, and speed",
    'Read retrograde motion as a frame effect rather than a real reversal',
    'Connect heliocentric and parent-relative motion to a moving 3D model of the solar system',
  ],
  status: 'active',
  navVisibility: 'menu',
  cardEyebrow: 'Astronomy',
  accent: '#4f46e5',
  heroImage: '/social/physics-nook-card.svg',
  pages: [
    {
      id: 'astronomy-overview',
      href: '/astronomy',
      title: 'Astronomy',
      shortTitle: 'Overview',
      description:
        'Start here: geocentric views versus heliocentric reality, the scale of the solar system, and gravity as the organizing force.',
      seo: {
        title: 'Astronomy',
        description:
          'An introduction to reading the sky: the difference between where we stand and what we see, the scale of the system, and gravity. Then explore two 3D explorers.',
        canonicalPath: '/astronomy',
        image: '/social/physics-nook-card.svg',
      },
    },
    {
      id: 'astronomy-moon-phases',
      href: '/astronomy/moon-phases',
      title: 'Moon',
      description:
        'Why the Moon cycles through phases, why a month of phases is longer than one orbit, why we only ever see one face, and why eclipses are rare.',
      seo: {
        title: 'Moon',
        description:
          'The geometry of lunar phases: illumination, waxing and waning, the synodic month, tidal locking, and eclipse alignment. Then walk the Earth–Moon–Sun system in 3D.',
        canonicalPath: '/astronomy/moon-phases',
        image: '/social/physics-nook-card.svg',
      },
    },
    {
      id: 'astronomy-orbits',
      href: '/astronomy/orbits',
      title: 'Solar System',
      description:
        "Kepler's three laws, the scale of planetary orbits, why inner planets move faster, and retrograde motion as a frame effect.",
      seo: {
        title: 'Solar System',
        description:
          "Kepler's laws, orbital scale in astronomical units, heliocentric versus parent-relative motion, and retrograde motion as a frame effect. Then fly a 3D solar system.",
        canonicalPath: '/astronomy/orbits',
        image: '/social/physics-nook-card.svg',
      },
    },
  ],
};
