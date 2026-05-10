import { normalizePath } from '../utils/paths';

export interface PageMeta {
  title: string;
  description: string;
  canonicalPath: string;
  image?: string;
  noindex?: boolean;
}

export const siteMeta = {
  name: 'Physics Nook',
  description:
    'Interactive guided physics modules that pair simulations, worked examples, and checkpoint questions.',
  defaultSocialImage: '/social/physics-nook-card.svg',
};

export const homePageMeta: PageMeta = {
  title: 'Interactive Guided Physics Modules',
  description:
    'Explore physics through interactive modules that connect simulations, intuition, and math.',
  canonicalPath: '/',
  image: '/social/physics-nook-card.svg',
};

export const standalonePages: PageMeta[] = [
  {
    title: 'Pendulum Peg Challenge',
    description:
      'A hidden pendulum game about timing, wrapping a string around a peg, and cutting for the closest landing.',
    canonicalPath: '/oscillations/pendulum-peg',
    image: '/social/physics-nook-card.svg',
    noindex: true,
  },
];

export const buildDocumentTitle = (pageMeta: PageMeta) =>
  normalizePath(pageMeta.canonicalPath) === '/'
    ? `${siteMeta.name} | ${pageMeta.title}`
    : `${pageMeta.title} | ${siteMeta.name}`;
