import type { ModuleMeta } from './types';

export const wavesModule: ModuleMeta = {
  slug: 'waves',
  href: '/waves',
  title: 'Waves',
  navLabel: 'Waves',
  summary:
    'Compare traveling waves, boundary reflections, standing waves, harmonics, and musical pitch.',
  audience: 'Self-learners building visual intuition for traveling waves.',
  prerequisites: ['Basic graph reading', 'Ratios', 'Periodic motion vocabulary'],
  learningObjectives: [
    'Differentiate transverse and longitudinal motion',
    'Relate amplitude, wavelength, period, and speed',
    'Track how the medium moves differently from the wave pattern',
    'Explain how superposition, reflection, and transmission satisfy boundary conditions',
    'Connect standing-wave boundary conditions to harmonics and musical pitch',
  ],
  status: 'active',
  navVisibility: 'menu',
  cardEyebrow: 'Core module',
  accent: '#2563eb',
  heroImage: '/social/physics-nook-card.svg',
  pages: [
    {
      id: 'waves-core',
      href: '/waves',
      title: 'Waves',
      description:
        'Build intuition for wave propagation by comparing what the pattern does with what the medium does.',
      seo: {
        title: 'Waves',
        description:
          'Explore wave propagation with interactive transverse and longitudinal wave comparisons.',
        canonicalPath: '/waves',
        image: '/social/physics-nook-card.svg',
      },
    },
    {
      id: 'waves-reflection-transmission',
      href: '/waves/reflection-transmission',
      title: 'Superposition and Reflection',
      shortTitle: 'Reflection',
      description:
        'See how incident, reflected, and transmitted waves combine at fixed, free, closed, and open boundaries.',
      seo: {
        title: 'Reflection, Transmission, and Superposition',
        description:
          'Learn wave superposition, reflection, transmission, and why open pipe ends still reflect sound with an interactive boundary explorer.',
        canonicalPath: '/waves/reflection-transmission',
        image: '/social/physics-nook-card.svg',
      },
    },
    {
      id: 'waves-standing-waves',
      href: '/waves/standing-waves',
      title: 'Standing Waves and Harmonics',
      shortTitle: 'Standing Waves',
      description:
        'Connect reflected waves, nodes, antinodes, harmonics, and musical pitch on strings and air columns.',
      seo: {
        title: 'Standing Waves and Harmonics',
        description:
          'Learn standing waves, harmonics, strings, air columns, and musical pitch with an interactive node-and-antinode explorer.',
        canonicalPath: '/waves/standing-waves',
        image: '/social/physics-nook-card.svg',
      },
    },
    {
      id: 'waves-sound-synthesis',
      href: '/waves/sound-synthesis',
      title: 'Sound Synthesis',
      shortTitle: 'Sound Synthesis',
      description:
        'Shape harmonic amplitudes, play a piano keyboard, and watch sound as a waveform or spectrogram.',
      seo: {
        title: 'Sound Synthesis',
        description:
          'Learn how additive synthesis builds musical timbre from harmonics with a playable piano keyboard, waveform display, and live spectrogram.',
        canonicalPath: '/waves/sound-synthesis',
        image: '/social/physics-nook-card.svg',
      },
    },
  ],
};
