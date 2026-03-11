#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { ClobClient } from '@polymarket/clob-client';
import ethers5 from 'ethers5';

const { Wallet } = ethers5;

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const HOST = (process.env.POLY_CLOB_REST_URL || 'https://clob.polymarket.com').replace(/\/$/, '');
const CHAIN_ID = Number(process.env.POLY_CLOB_CHAIN_ID || process.env.POLY_CLOB_NETWORK_ID || '137');
const PRIVATE_KEY = (
  process.env.POLY_CLOB_PRIVATE_KEY ||
  process.env.POLYMARKET_PRIVATE_KEY ||
  process.env.PRIVATE_KEY ||
  process.env.WALLET_PRIVATE_KEY ||
  ''
).trim();
const SHOW_SECRETS = String(process.env.POLY_CLOB_SHOW_SECRETS || 'false').toLowerCase() === 'true';
const WRITE_ENV = String(process.env.POLY_CLOB_WRITE_ENV || 'false').toLowerCase() === 'true';
const ENV_FILE = path.resolve(process.cwd(), process.env.POLY_CLOB_ENV_FILE || '.env.local');

function mask(value) {
  const text = String(value || '');
  if (!text) return '<empty>';
  if (text.length <= 10) return `${text.slice(0, 2)}***${text.slice(-2)}`;
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function upsertEnv(content, key, value) {
  const line = `${key}="${String(value).replace(/"/g, '\\"')}"`;
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) return content.replace(regex, line);
  const suffix = content.endsWith('\n') || content.length === 0 ? '' : '\n';
  return `${content}${suffix}${line}\n`;
}

async function main() {
  if (!Number.isFinite(CHAIN_ID)) {
    throw new Error(`Invalid POLY_CLOB_CHAIN_ID: ${process.env.POLY_CLOB_CHAIN_ID || process.env.POLY_CLOB_NETWORK_ID}`);
  }

  if (!PRIVATE_KEY) {
    throw new Error('Missing private key. Set POLY_CLOB_PRIVATE_KEY, PRIVATE_KEY, or WALLET_PRIVATE_KEY.');
  }

  const wallet = new Wallet(PRIVATE_KEY);
  const client = new ClobClient(HOST, CHAIN_ID, wallet);
  let credentials = null;
  let source = 'create';
  let createError = null;

  try {
    credentials = await client.createApiKey();
  } catch (error) {
    createError = error;
  }

  if (!credentials?.key) {
    source = 'derive';
    try {
      credentials = await client.deriveApiKey();
    } catch (deriveError) {
      const createMsg = createError instanceof Error ? createError.message : String(createError || 'unknown');
      const deriveMsg = deriveError instanceof Error ? deriveError.message : String(deriveError || 'unknown');
      throw new Error(
        `Unable to create or derive CLOB API credentials. createApiKey: ${createMsg}; deriveApiKey: ${deriveMsg}. ` +
        'Open Polymarket, connect this wallet, ensure it is fully initialized for CLOB usage, then retry.'
      );
    }
  }

  if (!credentials?.key || !credentials?.secret || !credentials?.passphrase) {
    throw new Error('CLOB client did not return a complete credential payload (expected key, secret, passphrase).');
  }

  const output = {
    host: HOST,
    chainId: CHAIN_ID,
    wallet: wallet.address,
    source,
    credentials: SHOW_SECRETS
      ? {
          apiKey: credentials.key,
          secret: credentials.secret,
          passphrase: credentials.passphrase,
        }
      : {
          apiKey: mask(credentials.key),
          secret: mask(credentials.secret),
          passphrase: mask(credentials.passphrase),
        },
    writeEnv: WRITE_ENV,
    envFile: ENV_FILE,
  };

  if (WRITE_ENV) {
    const previous = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
    let next = previous;
    next = upsertEnv(next, 'POLY_CLOB_API_KEY', credentials.key);
    next = upsertEnv(next, 'POLY_CLOB_API_SECRET', credentials.secret);
    next = upsertEnv(next, 'POLY_CLOB_API_PASSPHRASE', credentials.passphrase);
    next = upsertEnv(next, 'POLY_CLOB_REST_URL', HOST);
    const tmpEnv = ENV_FILE + '.tmp';
    fs.writeFileSync(tmpEnv, next, 'utf8');
    fs.renameSync(tmpEnv, ENV_FILE);
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[polymarket:derive-keys] ${message}`);
  process.exit(1);
});
