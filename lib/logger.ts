import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.VERCEL
  ? '/tmp/freedomforge-data'
  : path.resolve(process.cwd(), 'data');
const LOG_FILE = path.join(DATA_DIR, 'events.log');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export async function logEvent(type: string, payload: Record<string, any>) {
  try {
    ensureDir();
    const entry = { time: new Date().toISOString(), type, payload };
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (err) {
    // Best effort logging
    console.error('logger error', err);
  }
}

export async function readLast(n = 200) {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const raw = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n');
    const slice = raw.slice(-n);
    return slice.map((l) => {
      try { return JSON.parse(l); } catch { return { raw: l }; }
    });
  } catch (err) {
    console.error('logger read error', err);
    return [];
  }
}
