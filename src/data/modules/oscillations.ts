import type { ModuleMeta } from './types';

export const oscillationsModule: ModuleMeta = {
  slug: 'oscillations',
  href: '/oscillations',
  title: 'Oscillations',
  navLabel: 'Oscillations',
  summary:
    'Explore springs, pendulums, and coupled resonance through sinusoidal motion, restoring forces, and energy exchange.',
  audience: 'Self-learners reinforcing the language of periodic motion.',
  prerequisites: ['Basic force diagrams', 'Algebra', 'Graphs of sine and cosine'],
  learningObjectives: [
    'Connect restoring force to simple harmonic motion',
    'Relate period, frequency, angular frequency, and resonant driving',
    'Track the energy exchange within one oscillator and between coupled neighbors',
    'Use coupled oscillators as a bridge from periodic motion to waves',
  ],
  status: 'active',
  navVisibility: 'menu',
  cardEyebrow: 'Core module',
  accent: '#0f766e',
  heroImage: '/social/physics-nook-card.svg',
  pages: [
    {
      id: 'oscillations-core',
      href: '/oscillations',
      title: 'Oscillations',
      description:
        'Use springs and pendulums to connect equilibrium, sinusoidal motion, and energy exchange.',
      seo: {
        title: 'Oscillations',
        description:
          'Learn simple harmonic motion through restoring forces, sinusoidal motion, and a spring-mass explorer.',
        canonicalPath: '/oscillations',
        image: '/social/physics-nook-card.svg',
      },
    },
    {
      id: 'oscillations-resonance',
      href: '/oscillations/resonance',
      title: 'Resonance',
      description:
        'Use coupled oscillators to connect driven resonance, normal modes, and the first hints of wave motion.',
      seo: {
        title: 'Resonance',
        description:
          'Explore driven resonance, coupled oscillators, and normal modes as a bridge from oscillations to waves.',
        canonicalPath: '/oscillations/resonance',
        image: '/social/physics-nook-card.svg',
      },
    },
  ],
};
