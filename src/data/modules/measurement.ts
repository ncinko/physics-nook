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
      id: 'measurement-uncertainty',
      href: '/measurement/uncertainty',
      title: 'Measurement & Uncertainty',
      shortTitle: 'Uncertainty',
      description:
        'Discover π by measuring round objects: read the ± off a ruler, propagate it through C ÷ d, and test whether your error bar catches the true value.',
      seo: {
        title: 'Measurement & Uncertainty',
        description:
          'An algebra-level introduction to measurement uncertainty, propagation by the high–low method, and comparing an experiment to theory — by trying to measure π with everyday round objects.',
        canonicalPath: '/measurement/uncertainty',
        image: '/social/physics-nook-card.svg',
      },
    },
    {
      id: 'measurement-si-units-scientific-notation',
      href: '/measurement/si-units-scientific-notation',
      title: 'SI Units & Scientific Notation',
      shortTitle: 'Units & Notation',
      description:
        'Build the measurement language for lab work: SI units, metric prefixes, unit conversions, scientific notation, and significant figures.',
      seo: {
        title: 'SI Units & Scientific Notation',
        description:
          'Learn SI units, common metric prefixes, scientific notation, and how significant figures work when measured values are written as powers of ten.',
        canonicalPath: '/measurement/si-units-scientific-notation',
        image: '/social/physics-nook-card.svg',
      },
    },
  ],
};
