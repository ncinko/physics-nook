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
      rehypePlugins: [
        [
          rehypeKatex,
          {
            // Allows `\htmlClass` so parts of an equation can be tagged for
            // hover explanations (see src/components/textbook/MathHint.astro).
            trust: (/** @type {{ command: string }} */ context) => context.command === '\\htmlClass',
            strict: (/** @type {string} */ errorCode) => (errorCode === 'htmlExtension' ? 'ignore' : 'warn'),
          },
        ],
      ],
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
