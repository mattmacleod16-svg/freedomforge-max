#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const now = new Date();
const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}-${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}`;

const outRoot = process.env.MARKETING_KIT_OUT
  ? path.resolve(process.env.MARKETING_KIT_OUT)
  : path.join(ROOT, 'dist', 'marketing-kit');
const bundleName = `freedomforge-marketing-kit-${stamp}`;
const bundleDir = path.join(outRoot, bundleName);

const filesToCopy = [
  'MARKETING-KIT.md',
  'marketing-kit/LAUNCH-CHECKLIST.md',
  'marketing-kit/EMAIL-PITCH.txt',
  'marketing-kit/X-THREAD.txt',
  'marketing-kit/COMMUNITY-POST.txt',
  'public/freedomforge-icon-192.png',
  'public/freedomforge-icon-512.png',
  'public/freedomforge-icon-1024.png',
  'public/file.svg',
  'public/globe.svg',
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyRelative(relPath) {
  const src = path.join(ROOT, relPath);
  if (!fs.existsSync(src)) {
    throw new Error(`required file missing: ${relPath}`);
  }

  const dest = path.join(bundleDir, relPath);
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function buildManifest(relFiles) {
  const entries = relFiles.map((relPath) => {
    const fullPath = path.join(bundleDir, relPath);
    const stat = fs.statSync(fullPath);
    return {
      path: relPath,
      bytes: stat.size,
      sha256: sha256File(fullPath),
    };
  });

  const manifest = {
    name: bundleName,
    generatedAtUtc: now.toISOString(),
    sourceRepo: 'https://github.com/mattmacleod16-svg/freedomforge-max',
    liveUrl: 'https://freedomforge.one',
    fileCount: entries.length,
    files: entries,
  };

  const manifestPath = path.join(bundleDir, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestPath;
}

function writeShipReadme() {
  const content = [
    '# FreedomForge Marketing Shipment',
    '',
    '## Quick Start',
    '',
    '1. Open `LAUNCH-CHECKLIST.md` and confirm pre-launch items.',
    '2. Publish the thread in `X-THREAD.txt`.',
    '3. Publish `COMMUNITY-POST.txt` in Discord/Telegram/forums.',
    '4. Send outreach using `EMAIL-PITCH.txt`.',
    '5. Use `MARKETING-KIT.md` for full FAQ and talking points.',
    '',
    '## Links',
    '',
    '- Live: https://freedomforge.one',
    '- GitHub: https://github.com/mattmacleod16-svg/freedomforge-max',
    '',
    '## Integrity',
    '',
    '- Verify file checksums in `manifest.json` before external distribution.',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(bundleDir, 'README-SHIP-FIRST.md'), content, 'utf8');
}

function maybeZipBundle() {
  const zipPath = `${bundleDir}.zip`;
  const result = spawnSync('zip', ['-r', zipPath, '.'], {
    cwd: bundleDir,
    stdio: 'ignore',
  });

  if (result.status === 0) {
    return zipPath;
  }
  return null;
}

function main() {
  ensureDir(bundleDir);

  for (const relPath of filesToCopy) {
    copyRelative(relPath);
  }

  writeShipReadme();
  const manifestPath = buildManifest([...filesToCopy, 'README-SHIP-FIRST.md']);
  const zipPath = maybeZipBundle();

  console.log(`Marketing kit bundle: ${bundleDir}`);
  console.log(`Manifest: ${manifestPath}`);
  if (zipPath) {
    console.log(`Zip archive: ${zipPath}`);
  } else {
    console.log('Zip archive: skipped (zip command not available)');
  }
}

main();
