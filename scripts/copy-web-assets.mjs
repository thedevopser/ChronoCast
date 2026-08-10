#!/usr/bin/env node

import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(REPO_ROOT, 'src', 'web');
const TARGET_DIR = join(REPO_ROOT, 'dist', 'public');

const COPIED_EXTENSIONS = new Set([
  '.html',
  '.css',
  '.svg',
  '.png',
  '.ico',
  '.woff',
  '.woff2',
  '.json',
]);

async function collectAssets(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const collected = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      collected.push(...(await collectAssets(entryPath)));
      continue;
    }

    if (entry.isFile() && COPIED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      collected.push(entryPath);
    }
  }

  return collected;
}

async function main() {
  try {
    const sourceStats = await stat(SOURCE_DIR);
    if (!sourceStats.isDirectory()) {
      throw new Error(`${SOURCE_DIR} n'est pas un répertoire`);
    }
  } catch (error) {
    console.error(`[copy-web-assets] source introuvable : ${SOURCE_DIR}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const assets = await collectAssets(SOURCE_DIR);

  if (assets.length === 0) {
    console.warn('[copy-web-assets] aucune ressource à copier.');
    return;
  }

  for (const asset of assets) {
    const targetPath = join(TARGET_DIR, relative(SOURCE_DIR, asset));
    await mkdir(dirname(targetPath), { recursive: true });
    await cp(asset, targetPath);
  }

  console.log(`[copy-web-assets] ${String(assets.length)} ressource(s) copiée(s) vers dist/public.`);
}

await main();
