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

const homeNavItem: NavItem = {
  label: 'Home',
  href: '/',
  section: 'primary',
  visibility: 'primary',
  match: 'exact',
};

const resourcesNavItem: NavItem = {
  label: 'Resources',
  href: '/resources',
  section: 'primary',
  visibility: 'primary',
  match: 'exact',
  description: 'Available modules, curated external resources, and how to use this site.',
};

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

export const primaryNavItems = [homeNavItem, resourcesNavItem];
