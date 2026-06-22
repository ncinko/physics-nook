import type { PageMeta } from '../site';

export type ModuleStatus = 'flagship' | 'active';
export type ModuleNavVisibility = 'menu' | 'hidden';

export interface ModulePage {
  id: string;
  href: string;
  title: string;
  shortTitle?: string;
  description: string;
  seo: PageMeta;
}

export interface ModuleMeta {
  slug: string;
  href: string;
  title: string;
  navLabel: string;
  summary: string;
  audience: string;
  prerequisites: string[];
  learningObjectives: string[];
  status: ModuleStatus;
  navVisibility: ModuleNavVisibility;
  cardEyebrow: string;
  accent: string;
  heroImage: string;
  featured?: boolean;
  pages: ModulePage[];
}

export interface ModulePathGroup {
  id: string;
  href: string;
  navLabel: string;
  summary: string;
  cardEyebrow: string;
  navVisibility: ModuleNavVisibility;
  pages: ModulePage[];
}
