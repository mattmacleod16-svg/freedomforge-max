/**
 * FreedomForge SaaS — User Database Layer
 * Uses Railway PostgreSQL (DATABASE_URL env var)
 * Falls back to in-memory store for dev/testing
 */

import crypto from 'crypto';

const IS_POSTGRES = Boolean(process.env.DATABASE_URL);

// ─── Types ─────────────────────────────────────────────────────────────────

export type Plan = 'free' | 'pro' | 'elite';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  plan: Plan;
  trialEndsAt: number | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface UserKeys {
  userId: string;
  coinbaseApiKey: string | null;
  coinbaseApiSecret: string | null;
  krakenApiKey: string | null;
  krakenApiSecret: string | null;
  openrouterApiKey: string | null;
  telegramChatId: string | null;
  telegramBotToken: string | null;
  targetMonthly: number;
  targetDaily: number;
  updatedAt: number;
}

// ─── Password Hashing ───────────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(derived), Buffer.from(hash));
}

// ─── Encryption (for API keys at rest) ─────────────────────────────────────

const ENC_KEY = Buffer.from(
  (process.env.KEYS_ENCRYPTION_SECRET || process.env.DASHBOARD_SESSION_SECRET || 'fallback-dev-key-32-chars-minimum').padEnd(32, '0').slice(0, 32)
);

export function encryptKey(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptKey(value: string): string {
  const [ivHex, tagHex, encHex] = value.split(':');
  if (!ivHex || !tagHex || !encHex) return '';
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(encHex, 'hex')) .toString('utf8') + decipher.final('utf8');
}

// ─── In-Memory Store (dev fallback) ────────────────────────────────────────

const memUsers = new Map<string, User>();
const memKeys  = new Map<string, UserKeys>();

// ─── Postgres Client ────────────────────────────────────────────────────────

let pgPool: any = null;
let pgModule: any = null;

async function getPool() {
  if (!IS_POSTGRES) return null;
  
  // Dynamically load pg module only when DATABASE_URL is set
  // Use indirect require to prevent Turbopack static analysis
  if (!pgModule) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const requireFn = typeof require !== 'undefined' ? require : null;
      if (requireFn) {
        pgModule = requireFn(/* webpackIgnore: true */ 'pg');
      }
    } catch {
      console.warn('[db] pg module not installed — using in-memory store');
      return null;
    }
  }
  
  if (!pgModule) return null;
  
  if (!pgPool) {
    const { Pool } = pgModule;
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await initSchema(pgPool);
  }
  return pgPool;
}

async function initSchema(pool: any) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ff_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      plan TEXT NOT NULL DEFAULT 'free',
      trial_ends_at BIGINT,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ff_user_keys (
      user_id TEXT PRIMARY KEY REFERENCES ff_users(id) ON DELETE CASCADE,
      coinbase_api_key TEXT,
      coinbase_api_secret TEXT,
      kraken_api_key TEXT,
      kraken_api_secret TEXT,
      openrouter_api_key TEXT,
      telegram_chat_id TEXT,
      telegram_bot_token TEXT,
      target_monthly NUMERIC DEFAULT 50000,
      target_daily NUMERIC DEFAULT 1666.67,
      updated_at BIGINT NOT NULL
    );
  `);
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function createUser(email: string, password: string, name: string): Promise<User | null> {
  const id = crypto.randomUUID();
  const passwordHash = hashPassword(password);
  const now = Date.now();
  const trialEndsAt = now + 14 * 24 * 60 * 60 * 1000; // 14-day trial

  const user: User = { id, email: email.toLowerCase().trim(), passwordHash, name, plan: 'free', trialEndsAt, stripeCustomerId: null, stripeSubscriptionId: null, createdAt: now, updatedAt: now };

  const pool = await getPool();
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO ff_users(id,email,password_hash,name,plan,trial_ends_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, user.email, passwordHash, name, 'free', trialEndsAt, now, now]
      );
    } catch (e: any) {
      if (e.code === '23505') return null; // duplicate email
      throw e;
    }
  } else {
    if ([...memUsers.values()].find(u => u.email === user.email)) return null;
    memUsers.set(id, user);
  }
  return user;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const pool = await getPool();
  if (pool) {
    const { rows } = await pool.query(`SELECT * FROM ff_users WHERE email=$1`, [email.toLowerCase().trim()]);
    return rows[0] ? rowToUser(rows[0]) : null;
  }
  return [...memUsers.values()].find(u => u.email === email.toLowerCase()) || null;
}

export async function getUserById(id: string): Promise<User | null> {
  const pool = await getPool();
  if (pool) {
    const { rows } = await pool.query(`SELECT * FROM ff_users WHERE id=$1`, [id]);
    return rows[0] ? rowToUser(rows[0]) : null;
  }
  return memUsers.get(id) || null;
}

export async function updateUser(id: string, updates: Partial<Pick<User, 'plan' | 'stripeCustomerId' | 'stripeSubscriptionId' | 'trialEndsAt' | 'name'>>): Promise<void> {
  const pool = await getPool();
  const now = Date.now();
  if (pool) {
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if ('plan' in updates)                 { sets.push(`plan=$${i++}`);                  vals.push(updates.plan); }
    if ('stripeCustomerId' in updates)     { sets.push(`stripe_customer_id=$${i++}`);    vals.push(updates.stripeCustomerId); }
    if ('stripeSubscriptionId' in updates) { sets.push(`stripe_subscription_id=$${i++}`);vals.push(updates.stripeSubscriptionId); }
    if ('trialEndsAt' in updates)          { sets.push(`trial_ends_at=$${i++}`);          vals.push(updates.trialEndsAt); }
    if ('name' in updates)                 { sets.push(`name=$${i++}`);                  vals.push(updates.name); }
    if (!sets.length) return;
    sets.push(`updated_at=$${i++}`); vals.push(now); vals.push(id);
    await pool.query(`UPDATE ff_users SET ${sets.join(',')} WHERE id=$${i}`, vals);
  } else {
    const u = memUsers.get(id);
    if (u) memUsers.set(id, { ...u, ...updates, updatedAt: now });
  }
}

export async function getUserKeys(userId: string): Promise<UserKeys | null> {
  const pool = await getPool();
  if (pool) {
    const { rows } = await pool.query(`SELECT * FROM ff_user_keys WHERE user_id=$1`, [userId]);
    return rows[0] ? rowToKeys(rows[0]) : null;
  }
  return memKeys.get(userId) || null;
}

export async function upsertUserKeys(userId: string, keys: Partial<Omit<UserKeys, 'userId' | 'updatedAt'>>): Promise<void> {
  const now = Date.now();
  const pool = await getPool();

  // Encrypt sensitive fields before storage
  const enc = (v: string | null | undefined) => (v ? encryptKey(v) : null);

  if (pool) {
    await pool.query(`
      INSERT INTO ff_user_keys(user_id,coinbase_api_key,coinbase_api_secret,kraken_api_key,kraken_api_secret,openrouter_api_key,telegram_chat_id,telegram_bot_token,target_monthly,target_daily,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT(user_id) DO UPDATE SET
        coinbase_api_key=COALESCE(EXCLUDED.coinbase_api_key, ff_user_keys.coinbase_api_key),
        coinbase_api_secret=COALESCE(EXCLUDED.coinbase_api_secret, ff_user_keys.coinbase_api_secret),
        kraken_api_key=COALESCE(EXCLUDED.kraken_api_key, ff_user_keys.kraken_api_key),
        kraken_api_secret=COALESCE(EXCLUDED.kraken_api_secret, ff_user_keys.kraken_api_secret),
        openrouter_api_key=COALESCE(EXCLUDED.openrouter_api_key, ff_user_keys.openrouter_api_key),
        telegram_chat_id=COALESCE(EXCLUDED.telegram_chat_id, ff_user_keys.telegram_chat_id),
        telegram_bot_token=COALESCE(EXCLUDED.telegram_bot_token, ff_user_keys.telegram_bot_token),
        target_monthly=COALESCE(EXCLUDED.target_monthly, ff_user_keys.target_monthly),
        target_daily=COALESCE(EXCLUDED.target_daily, ff_user_keys.target_daily),
        updated_at=EXCLUDED.updated_at
    `, [
      userId,
      'coinbaseApiKey' in keys ? enc(keys.coinbaseApiKey!) : null,
      'coinbaseApiSecret' in keys ? enc(keys.coinbaseApiSecret!) : null,
      'krakenApiKey' in keys ? enc(keys.krakenApiKey!) : null,
      'krakenApiSecret' in keys ? enc(keys.krakenApiSecret!) : null,
      'openrouterApiKey' in keys ? enc(keys.openrouterApiKey!) : null,
      keys.telegramChatId ?? null,
      keys.telegramBotToken ?? null,
      keys.targetMonthly ?? null,
      keys.targetDaily ?? null,
      now,
    ]);
  } else {
    const existing = memKeys.get(userId) || { userId, coinbaseApiKey: null, coinbaseApiSecret: null, krakenApiKey: null, krakenApiSecret: null, openrouterApiKey: null, telegramChatId: null, telegramBotToken: null, targetMonthly: 50000, targetDaily: 1666.67, updatedAt: now };
    memKeys.set(userId, { ...existing, ...keys, userId, updatedAt: now });
  }
}

function rowToUser(row: any): User {
  return { id: row.id, email: row.email, passwordHash: row.password_hash, name: row.name, plan: row.plan, trialEndsAt: row.trial_ends_at ? Number(row.trial_ends_at) : null, stripeCustomerId: row.stripe_customer_id, stripeSubscriptionId: row.stripe_subscription_id, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}

function rowToKeys(row: any): UserKeys {
  const dec = (v: string | null) => (v ? decryptKey(v) : null);
  return { userId: row.user_id, coinbaseApiKey: dec(row.coinbase_api_key), coinbaseApiSecret: dec(row.coinbase_api_secret), krakenApiKey: dec(row.kraken_api_key), krakenApiSecret: dec(row.kraken_api_secret), openrouterApiKey: dec(row.openrouter_api_key), telegramChatId: row.telegram_chat_id, telegramBotToken: row.telegram_bot_token, targetMonthly: Number(row.target_monthly || 50000), targetDaily: Number(row.target_daily || 1666.67), updatedAt: Number(row.updated_at) };
}
