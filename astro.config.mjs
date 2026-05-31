// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

const site = process.env.PUBLIC_SITE_URL ?? process.env.SITE_URL ?? 'https://physicsnook.com';
const ignoredDevWatchFiles = [
  '**/apps/client/dist/**',
  '**/dist/**',
  '**/apps/client/tsconfig*.json',
  '**/apps/server/tsconfig*.json',
  '**/packages/shared/tsconfig*.json',
];

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
    cacheDir: 'node_modules/.vite-astro',
    plugins: [tailwindcss()],
    server: {
      watch: {
        ignored: ignoredDevWatchFiles,
      },
    },
  },
});
