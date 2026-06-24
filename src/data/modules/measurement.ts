import type { ModuleMeta } from './types';

export const measurementModule: ModuleMeta = {
  slug: 'measurement',
  href: '/measurement/uncertainty',
  title: 'Measurement & Uncertainty',
  navLabel: 'Measurement',
  summary:
    'SI units, scientific notation, uncertainty, and the habits that turn measured numbers into defensible results.',
  audience: 'Self-learners and intro-lab students who want the algebra-level toolkit every experiment reuses.',
  prerequisites: ['Decimals and percentages', 'Rounding', 'Basic algebra'],
  learningObjectives: [
    'Report a measurement as a best estimate plus an absolute uncertainty',
    'Convert between absolute and relative (percent) uncertainty',
    'Use SI units, metric prefixes, and powers of ten to keep measurements readable',
    'Write measurements in scientific notation while preserving significant figures',
    'Propagate uncertainty with the high–low bracket and the add/multiply shortcut rules',
    'Round an uncertainty to one significant figure and match the value to it',
    'Decide whether a theoretical value is consistent with a measurement using its error bar',
  ],
  status: 'active',
  navVisibility: 'menu',
  cardEyebrow: 'Lab skills',
  accent: '#b45309',
  heroImage: '/social/physics-nook-card.svg',
  pages: [
    {
      id: 'measurement-si-units-scientific-notation',
      href: '/measurement/si-units-scientific-notation',
      title: 'Measurement',
      shortTitle: 'Units & Notation',
      description:
        'Build the measurement language for lab work: SI units, metric prefixes, and scientific notation.',
      seo: {
        title: 'Measurement',
        description:
          'Learn SI units, common metric prefixes, scientific notation, and how significant figures work when measured values are written as powers of ten.',
        canonicalPath: '/measurement/si-units-scientific-notation',
        image: '/social/physics-nook-card.svg',
      },
    },
    {
      id: 'measurement-uncertainty',
      href: '/measurement/uncertainty',
      title: 'Uncertainty',
      shortTitle: 'Uncertainty',
      description:
        'Explore the concept of measurement uncertainty and how it affects the reliability of experimental results.',
      seo: {
        title: 'Uncertainty',
        description:
          'An algebra-level introduction to measurement uncertainty, propagation by the high–low method, and comparing an experiment to theory — by trying to measure π with everyday round objects.',
        canonicalPath: '/measurement/uncertainty',
        image: '/social/physics-nook-card.svg',
      },
    },
    
  ],
};
