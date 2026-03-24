#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

function parseArgs(argv) {
  const out = {
    live: false,
    chains: String(process.env.MULTICHAIN_TARGETS || 'ethereum,solana,multiversx')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--live') {
      out.live = true;
      continue;
    }
    if (arg === '--dry-run') {
      out.live = false;
      continue;
    }
    if (arg === '--chains' && argv[i + 1]) {
      out.chains = argv[i + 1].split(',').map((v) => v.trim()).filter(Boolean);
      i += 1;
      continue;
    }
  }

  return out;
}

function normalizeChain(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'eth' || raw === 'ethereum-mainnet' || raw === 'eth-mainnet') return 'ethereum';
  if (raw === 'sol' || raw === 'solana-mainnet') return 'solana';
  if (raw === 'mvx' || raw === 'multiversx-mainnet' || raw === 'multiversex') return 'multiversx';
  return raw;
}

function ensureEthereumNetwork(env) {
  const current = String(env.CONVERSION_NETWORKS || '').trim();
  if (!current) return 'eth-mainnet';

  const values = current.split(',').map((v) => v.trim()).filter(Boolean);
  const hasEth = values.some((v) => {
    const n = v.toLowerCase();
    return n === 'eth-mainnet' || n === 'ethereum' || n === 'mainnet' || n === 'eth';
  });

  if (!hasEth) values.unshift('eth-mainnet');
  return values.join(',');
}

function commandForChain(chain, live) {
  if (chain === 'ethereum') {
    return {
      command: 'node',
      args: ['scripts/conversion-engine.js'],
      env: {
        CONVERSION_ENGINE_ENABLED: 'true',
        CONVERSION_ENGINE_DRY_RUN: live ? 'false' : 'true',
      },
      mutateEnv: (env) => {
        env.CONVERSION_NETWORKS = ensureEthereumNetwork(env);
      },
    };
  }

  if (chain === 'solana') {
    return {
      command: 'node',
      args: ['scripts/solana-engine.js'],
      env: {
        SOLANA_ENABLED: 'true',
        SOLANA_DRY_RUN: live ? 'false' : 'true',
      },
    };
  }

  if (chain === 'multiversx') {
    return {
      command: 'node',
      args: ['scripts/multiversx-engine.js'],
      env: {
        MVX_ENABLED: 'true',
        MVX_DRY_RUN: live ? 'false' : 'true',
      },
    };
  }

  return null;
}

function runOne(chain, live) {
  const descriptor = commandForChain(chain, live);
  if (!descriptor) {
    return {
      chain,
      status: 'skipped',
      reason: `unsupported chain target: ${chain}`,
    };
  }

  const env = { ...process.env, ...descriptor.env };
  if (typeof descriptor.mutateEnv === 'function') descriptor.mutateEnv(env);

  const startedAt = Date.now();
  const result = spawnSync(descriptor.command, descriptor.args, {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    timeout: 180000,
  });
  const finishedAt = Date.now();

  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  const exitCode = typeof result.status === 'number' ? result.status : 1;
  const base = {
    chain,
    exitCode,
    elapsedMs: Math.max(0, finishedAt - startedAt),
  };

  if (exitCode !== 0) {
    return {
      ...base,
      status: 'error',
      reason: 'engine returned non-zero exit code',
    };
  }

  if (/"status"\s*:\s*"skipped"/i.test(stdout)) {
    return {
      ...base,
      status: 'skipped',
      reason: 'engine reported skipped',
    };
  }

  if (/"skipped"\s*:\s*true/i.test(stdout)) {
    return {
      ...base,
      status: 'skipped',
      reason: 'engine reported skipped=true',
    };
  }

  if (/"status"\s*:\s*"dry-run"/i.test(stdout)) {
    return {
      ...base,
      status: 'dry-run',
    };
  }

  if (/"status"\s*:\s*"ready"/i.test(stdout)) {
    return {
      ...base,
      status: 'ready',
    };
  }

  return {
    ...base,
    status: live ? 'launched' : 'checked',
  };
}

function main() {
  const args = parseArgs(process.argv);
  const live = args.live;
  const chains = args.chains.map(normalizeChain).filter(Boolean);

  const report = {
    mode: live ? 'live' : 'dry-run',
    startedAt: new Date().toISOString(),
    chains,
    results: [],
  };

  for (const chain of chains) {
    report.results.push(runOne(chain, live));
  }

  report.completedAt = new Date().toISOString();
  report.ok = report.results.every((r) => r.status !== 'error');

  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exit(1);
  }
}

main();
