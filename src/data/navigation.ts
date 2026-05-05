import { exploreModuleGroups } from './modules';
import { normalizePath } from '../utils/paths';

export type NavVisibility = 'primary' | 'menu' | 'hidden';
export type NavMatch = 'exact' | 'prefix';

export interface NavItem {
  label: string;
  href: string;
  section: string;
  description?: string;
  visibility: NavVisibility;
  match?: NavMatch;
}

export interface NavSection {
  id: string;
  label: string;
}

export interface NavSectionWithItems extends NavSection {
  items: NavItem[];
}

const homeNavItem: NavItem = {
  label: 'Home',
  href: '/',
  section: 'primary',
  visibility: 'primary',
  match: 'exact',
};

export const menuNavSections: NavSectionWithItems[] = exploreModuleGroups.map((group) => ({
  id: group.id,
  label: group.navLabel,
  items: group.pages.map((page) => ({
    label: page.title,
    href: page.href,
    section: group.id,
    description: page.description,
    visibility: 'menu' as const,
    match: 'exact' as const,
  })),
}));

const hiddenNavItems: NavItem[] = [
  {
    label: 'Deep Pool',
    href: '/waves/deep-pool',
    section: 'hidden',
    visibility: 'hidden',
    match: 'prefix',
    description: 'Immersive wave playground kept out of the primary navigation.',
  },
  {
    label: 'Pendulum Peg Challenge',
    href: '/oscillations/pendulum-peg',
    section: 'hidden',
    visibility: 'hidden',
    match: 'prefix',
    description: 'Hidden pendulum timing game kept out of the primary navigation.',
  },
];

export const navItems: NavItem[] = [
  homeNavItem,
  ...menuNavSections.flatMap((section) => section.items),
  ...hiddenNavItems,
];

export const isNavItemActive = (item: NavItem, currentPath: string) => {
  const normalizedCurrentPath = normalizePath(currentPath);
  const normalizedHref = normalizePath(item.href);

  if ((item.match ?? 'exact') === 'prefix' && normalizedHref !== '/') {
    return (
      normalizedCurrentPath === normalizedHref ||
      normalizedCurrentPath.startsWith(`${normalizedHref}/`)
    );
  }

  return normalizedCurrentPath === normalizedHref;
};

export const primaryNavItems = [homeNavItem];
