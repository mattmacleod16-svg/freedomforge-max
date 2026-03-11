import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.VERCEL
  ? '/tmp/freedomforge-data'
  : path.resolve(process.cwd(), 'data');
const LOG_FILE = path.join(DATA_DIR, 'events.log');
const MAX_LOG_SIZE_BYTES = parseInt(process.env.LOG_MAX_SIZE_BYTES || '10485760', 10); // 10MB default
const MAX_ROTATED_FILES = 3;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function rotateIfNeeded() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const stats = fs.statSync(LOG_FILE);
    if (stats.size < MAX_LOG_SIZE_BYTES) return;
    // Rotate: events.log.2 -> events.log.3, etc.
    for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
      const older = `${LOG_FILE}.${i}`;
      const newer = `${LOG_FILE}.${i - 1}`;
      if (fs.existsSync(newer)) {
        try { fs.renameSync(newer, older); } catch {}
      }
    }
    try { fs.renameSync(LOG_FILE, `${LOG_FILE}.0`); } catch {}
  } catch {
    // best effort rotation
  }
}

export async function logEvent(type: string, payload: Record<string, any>) {
  try {
    ensureDir();
    rotateIfNeeded();
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
    // Read only the tail of the file to avoid OOM on large logs
    const stats = fs.statSync(LOG_FILE);
    const MAX_READ_BYTES = 2 * 1024 * 1024; // 2MB max read
    let raw: string;
    if (stats.size > MAX_READ_BYTES) {
      // Read only the last 2MB
      const fd = fs.openSync(LOG_FILE, 'r');
      const buffer = Buffer.alloc(MAX_READ_BYTES);
      fs.readSync(fd, buffer, 0, MAX_READ_BYTES, stats.size - MAX_READ_BYTES);
      fs.closeSync(fd);
      raw = buffer.toString('utf8');
      // Drop the first (potentially partial) line
      const firstNewline = raw.indexOf('\n');
      if (firstNewline >= 0) raw = raw.slice(firstNewline + 1);
    } else {
      raw = fs.readFileSync(LOG_FILE, 'utf8');
    }
    const lines = raw.trim().split('\n');
    const slice = lines.slice(-n);
    return slice.map((l) => {
      try { return JSON.parse(l); } catch { return { raw: l }; }
    });
  } catch (err) {
    console.error('logger read error', err);
    return [];
  }
}
