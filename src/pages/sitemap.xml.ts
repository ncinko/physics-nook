import type { APIRoute } from 'astro';
import { publicPageMeta } from '../data/modules';

export const GET: APIRoute = ({ site }) => {
  const origin = (site ?? new URL('https://physicsnook.com')).toString().replace(/\/$/, '');
  const urls = publicPageMeta
    .filter((page) => !page.noindex)
    .map((page) => `${origin}${page.canonicalPath}`);

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${url}</loc></url>`),
    '</urlset>',
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
};
