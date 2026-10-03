import type { ModuleMeta } from './types';

export const measurementModule: ModuleMeta = {
  slug: 'measurement',
  href: '/measurement/si-units-scientific-notation',
  title: 'Measurement & Uncertainty',
  navLabel: 'Measurement',
  summary:
    'SI units, scientific notation, measurement uncertainty, error propagation, and fitting data.',
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
    'Distinguish a straight-line fit from a functional fit and use residuals to judge whether a model fits',
    'Estimate the uncertainty in a best-fit parameter by hand, with chi-square, and by repeating the experiment',
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
    {
      id: 'measurement-curve-fitting',
      href: '/measurement/curve-fitting',
      title: 'Fitting Data',
      shortTitle: 'Fitting Data',
      description:
        'Compare a straight-line fit with a functional fit, read the residuals, and estimate the uncertainty in a best-fit parameter.',
      seo: {
        title: 'Fitting Data',
        description:
          'Fit a charging RC circuit to find its time constant: straight-line versus exponential fits, reading residuals, estimating parameter uncertainty by hand, and a first look at chi-square.',
        canonicalPath: '/measurement/curve-fitting',
        image: '/social/physics-nook-card.svg',
      },
    },
  ],
};
