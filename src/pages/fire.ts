import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const fireHtmlPath = join(
  process.cwd(),
  'src',
  'assets',
  'fire',
  'interactive_calcifer_spectrometer.html',
);

export const prerender = true;

export const GET: APIRoute = async () => {
  const fireHtml = await readFile(fireHtmlPath);

  return new Response(fireHtml, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
};
