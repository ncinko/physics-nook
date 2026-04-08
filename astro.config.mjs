// @ts-check
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

const site = process.env.PUBLIC_SITE_URL ?? process.env.SITE_URL ?? 'https://physicsnook.com';
const astroPrerenderEntrypoint = fileURLToPath(new URL('./node_modules/astro/dist/entrypoints/prerender.js', import.meta.url));
const astroLegacyEntrypoint = fileURLToPath(new URL('./node_modules/astro/dist/entrypoints/legacy.js', import.meta.url));

// https://astro.build/config
export default defineConfig({
  site,
  integrations: [
    react(),
    mdx({
      remarkPlugins: [remarkMath],
      rehypePlugins: [rehypeKatex],
    }),
  ],

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        'astro/entrypoints/prerender': astroPrerenderEntrypoint,
        'astro/entrypoints/legacy': astroLegacyEntrypoint,
      },
    },
  }
});
