import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const origin = (site ?? new URL('https://physicsnook.com')).toString().replace(/\/$/, '');
  const body = ['User-agent: *', 'Allow: /', `Sitemap: ${origin}/sitemap.xml`].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
