import type { ModuleMeta } from './types';

export const quantumModule: ModuleMeta = {
  slug: 'quantum',
  href: '/quantum',
  title: 'Quantum',
  navLabel: 'Quantum',
  summary:
    'The photoelectric effect and double-slit interference, wavefunctions, quantized energy levels, and time evolution.',
  audience: 'Self-learners building a first modern-physics intuition before a formal quantum course.',
  prerequisites: [
    'Core wave vocabulary such as wavelength, frequency, and interference',
    'Basic energy relationships and algebra',
    'Comfort reading graphs and simple probability statements',
  ],
  learningObjectives: [
    'Use the photoelectric effect and double-slit interference to explain why classical pictures break down',
    'Interpret a wavefunction through amplitudes, probabilities, normalization, and measurement',
    'Connect boundary conditions and normalizable solutions to quantized energy levels in the infinite well, harmonic oscillator, and hydrogen atom',
    'Use the time-dependent Schrodinger equation to explain phase evolution, spreading, scattering, and interference',
  ],
  status: 'active',
  navVisibility: 'hidden',
  cardEyebrow: 'Quantum',
  accent: '#0891b2',
  heroImage: '/social/physics-nook-card.svg',
  pages: [
    {
      id: 'quantum-foundations',
      href: '/quantum',
      title: 'Quantum Foundations',
      shortTitle: 'Foundations',
      description:
        'Use the photoelectric effect and single-particle interference to motivate quantum ideas.',
      seo: {
        title: 'Quantum Foundations',
        description:
          'Start the quantum path with the photoelectric effect, de Broglie wavelength, and inline labs for the photoelectric and double-slit experiments.',
        canonicalPath: '/quantum',
        image: '/social/physics-nook-card.svg',
      },
    },
    {
      id: 'quantum-wavefunctions',
      href: '/quantum/wavefunctions',
      title: 'Wavefunctions',
      shortTitle: 'Wavefunctions',
      description:
        'Interpret amplitudes, probabilities, and measurement in a one-dimensional quantum state.',
      seo: {
        title: 'Wavefunctions',
        description:
          'Learn how wavefunctions encode amplitudes, normalization, and position measurements.',
        canonicalPath: '/quantum/wavefunctions',
        image: '/social/physics-nook-card.svg',
      },
    },
    {
      id: 'quantum-quantization',
      href: '/quantum/quantization',
      title: 'Quantization',
      shortTitle: 'Quantization',
      description:
        'Use bound-state potentials to build intuition for discrete energies in quantum systems.',
      seo: {
        title: 'Quantization',
        description:
          'Explore the Schrodinger equation, the infinite well, the harmonic oscillator, and hydrogen radial states.',
        canonicalPath: '/quantum/quantization',
        image: '/social/physics-nook-card.svg',
      },
    },
    {
      id: 'quantum-time-evolution',
      href: '/quantum/time-evolution',
      title: 'Time Evolution',
      shortTitle: 'Time Evolution',
      description:
        'Evolve wavefunctions through free spreading, finite barriers, and two-dimensional interference.',
      seo: {
        title: 'Quantum Time Evolution',
        description:
          'Learn the time-dependent Schrodinger equation with wave-packet spreading, finite-barrier scattering, and a two-dimensional split-step simulator.',
        canonicalPath: '/quantum/time-evolution',
        image: '/social/physics-nook-card.svg',
      },
    },
  ],
};
