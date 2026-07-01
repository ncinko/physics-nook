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
    title: 'Interactives',
    description:
      'Open Physics Nook inline demos, standalone labs, and immersive physics sandboxes from one compact catalog.',
    canonicalPath: '/interactives',
    image: '/social/physics-nook-card.svg',
  },
  {
    title: 'Resources',
    description:
      'Available modules, curated external resources, and how to use Physics Nook effectively.',
    canonicalPath: '/resources',
    image: '/social/physics-nook-card.svg',
  },
  {
    title: 'Moon Phase Explorer',
    description:
      'Explore the Earth-Moon-Sun system in 3D, advance time, and walk on Earth or the Moon.',
    canonicalPath: '/moon-phases',
    image: '/social/physics-nook-card.svg',
  },
  {
    title: 'Solar System Explorer',
    description:
      'Fly through a Sun-centered 3D solar system, advance time, and land on solid worlds.',
    canonicalPath: '/solar-system',
    image: '/social/physics-nook-card.svg',
  },
  {
    title: 'Pendulum Peg Challenge',
    description:
      'A hidden pendulum game about timing, wrapping a string around a peg, and cutting for the closest landing.',
    canonicalPath: '/oscillations/pendulum-peg',
    image: '/social/physics-nook-card.svg',
    noindex: true,
  },
  {
    title: "Hamlet's Wheel",
    description:
      'A communal pixel hamster who runs his wheel by day and sleeps by night on Pacific time. Feed, water, and pet him — everyone shares the same hamster.',
    canonicalPath: '/hamlet',
    image: '/social/physics-nook-card.svg',
    noindex: true,
  },
];

export const buildDocumentTitle = (pageMeta: PageMeta) =>
  normalizePath(pageMeta.canonicalPath) === '/'
    ? `${siteMeta.name} | ${pageMeta.title}`
    : `${pageMeta.title} | ${siteMeta.name}`;
