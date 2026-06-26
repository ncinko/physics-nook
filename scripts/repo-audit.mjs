import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pageRoot = path.join(repoRoot, 'src', 'pages');
const dataRoot = path.join(repoRoot, 'src', 'data');

const errors = [];
const notes = [];

const fail = (message) => {
  errors.push(message);
};

const note = (message) => {
  notes.push(message);
};

const toRepoPath = (absolutePath) => path.relative(repoRoot, absolutePath).replace(/\\/g, '/');

const walk = (directory, ignoredNames = new Set(['.git', 'node_modules', 'dist', '.astro'])) => {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredNames.has(entry.name)) return [];

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(entryPath, ignoredNames);
    return [entryPath];
  });
};

const normalizeRoute = (route) => {
  const withoutHash = route.split('#')[0];
  const withSlash = withoutHash.startsWith('/') ? withoutHash : `/${withoutHash}`;
  const trimmed = withSlash.replace(/\/+$/, '');
  return trimmed || '/';
};

const routeForPageFile = (filePath) => {
  const relative = path
    .relative(pageRoot, filePath)
    .replace(/\\/g, '/')
    .replace(/\.(astro|mdx)$/, '');
  const withoutIndex = relative.replace(/\/index$/, '');
  return normalizeRoute(withoutIndex === 'index' ? '/' : `/${withoutIndex}`);
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const checkPackageManager = () => {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

  if (packageJson.packageManager !== 'npm@11.16.0') {
    fail('package.json must pin packageManager to npm@11.16.0.');
  }

  if (!existsSync(path.join(repoRoot, 'package-lock.json'))) {
    fail('package-lock.json is missing.');
  }

  for (const lockfile of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']) {
    if (existsSync(path.join(repoRoot, lockfile))) {
      fail(`${lockfile} should not be present; npm is the canonical package manager.`);
    }
  }
};

const checkRoutesAndMetadata = () => {
  const pageFiles = walk(pageRoot).filter((file) => /\.(astro|mdx)$/.test(file));
  const routeToFile = new Map(pageFiles.map((file) => [routeForPageFile(file), file]));
  const routes = new Set(routeToFile.keys());

  const dataText = walk(dataRoot)
    .filter((file) => /\.(js|ts)$/.test(file))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  const mentionedRoutes = new Set(
    [...dataText.matchAll(/(?:href|canonicalPath):\s*['"]([^'"]+)['"]/g)]
      .map((match) => match[1])
      .filter((value) => value.startsWith('/'))
      .map(normalizeRoute),
  );

  for (const route of [...routes].sort()) {
    if (!mentionedRoutes.has(route)) {
      fail(`${route} is missing from src/data metadata.`);
    }
  }

  const externalCanonicalRoutes = new Set(['/orbitals']);
  for (const route of [...mentionedRoutes].sort()) {
    if (!routes.has(route) && !externalCanonicalRoutes.has(route)) {
      fail(`${route} is referenced in src/data metadata but has no local page.`);
    }
  }

  return routeToFile;
};

const checkInteractiveAnchors = (routeToFile) => {
  const interactivesPath = path.join(repoRoot, 'src', 'data', 'interactives.ts');
  const interactivesText = readFileSync(interactivesPath, 'utf8');
  const hrefs = [...interactivesText.matchAll(/href:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);

  for (const href of hrefs) {
    if (!href.startsWith('/')) continue;

    const [routeValue, anchor] = href.split('#');
    const route = normalizeRoute(routeValue);
    const pageFile = routeToFile.get(route);

    if (!pageFile) {
      fail(`${href} in src/data/interactives.ts points at a missing local page.`);
      continue;
    }

    if (!anchor) continue;

    const pageText = readFileSync(pageFile, 'utf8');
    const anchorPattern = new RegExp(`id=(?:["']|\\{["'])${escapeRegExp(anchor)}(?:["']|["']\\})`);
    if (!anchorPattern.test(pageText)) {
      fail(`${href} in src/data/interactives.ts points at an anchor missing from ${toRepoPath(pageFile)}.`);
    }
  }
};

const checkTrackedGeneratedArtifacts = () => {
  let trackedFiles = [];
  try {
    trackedFiles = execFileSync('git', ['ls-files'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    note('Skipped tracked generated artifact check because git is unavailable.');
    return;
  }

  const generatedPrefixes = [
    'dist/',
    'apps/client/dist/',
    '.astro/',
    '.wrangler/',
    '.edge-profile/',
    'qa-screenshots/',
    'node_modules/',
  ];

  for (const file of trackedFiles) {
    if (generatedPrefixes.some((prefix) => file.startsWith(prefix)) || file.endsWith('.log')) {
      fail(`${file} is a generated/local artifact but is tracked by git.`);
    }
  }
};

const checkRetiredSimulationFolder = () => {
  const retiredPath = path.join(repoRoot, 'src', 'components', 'simulations');
  if (existsSync(retiredPath) && statSync(retiredPath).isDirectory()) {
    fail('src/components/simulations is retired; put simulation islands in src/components/<domain>.');
  }
};

checkPackageManager();
const routeToFile = checkRoutesAndMetadata();
checkInteractiveAnchors(routeToFile);
checkTrackedGeneratedArtifacts();
checkRetiredSimulationFolder();

if (errors.length > 0) {
  console.error('Repo audit failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

for (const message of notes) {
  console.warn(`Note: ${message}`);
}

console.log('Repo audit passed.');
