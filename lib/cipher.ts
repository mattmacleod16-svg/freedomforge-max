/**
 * FreedomForge Cipher Engine
 * ==========================
 *
 * Full-spectrum cipher utility supporting ROT13, Caesar (ROT-N),
 * Vigenère, Atbash, and reversible display-obfuscation transforms.
 *
 * WARNING: These are classical ciphers for educational/obfuscation use only.
 * They provide ZERO cryptographic security. For real security use HMAC-SHA256
 * (see lib/auth/session.ts) or AES-256.
 */

/* ─── Constants ───────────────────────────────────────────────────────────── */

const UPPER_A = 65;
const LOWER_A = 97;
const ALPHA_LEN = 26;

/* ─── Types ───────────────────────────────────────────────────────────────── */

export type CipherAlgorithm = 'rot13' | 'caesar' | 'vigenere' | 'atbash';

export interface CipherResult {
  input: string;
  output: string;
  algorithm: CipherAlgorithm;
  key: string | number;
  steps: CipherStep[];
}

export interface CipherStep {
  inputChar: string;
  outputChar: string;
  position: number;
  shift: number;
}

export interface CipherAnalysis {
  text: string;
  letterFrequency: Record<string, number>;
  mostCommon: string;
  leastCommon: string;
  entropy: number;
  isLikelyEncrypted: boolean;
}

/* ─── Core Shift ──────────────────────────────────────────────────────────── */

function shiftChar(ch: string, shift: number): string {
  const code = ch.charCodeAt(0);
  if (code >= UPPER_A && code < UPPER_A + ALPHA_LEN) {
    return String.fromCharCode(((code - UPPER_A + shift) % ALPHA_LEN + ALPHA_LEN) % ALPHA_LEN + UPPER_A);
  }
  if (code >= LOWER_A && code < LOWER_A + ALPHA_LEN) {
    return String.fromCharCode(((code - LOWER_A + shift) % ALPHA_LEN + ALPHA_LEN) % ALPHA_LEN + LOWER_A);
  }
  return ch;
}

function isAlpha(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= UPPER_A && c < UPPER_A + ALPHA_LEN) || (c >= LOWER_A && c < LOWER_A + ALPHA_LEN);
}

/* ─── ROT13 ───────────────────────────────────────────────────────────────── */

export function rot13(text: string): CipherResult {
  return caesar(text, 13);
}

/* ─── Caesar Cipher (ROT-N) ──────────────────────────────────────────────── */

export function caesar(text: string, shift: number): CipherResult {
  const normalizedShift = ((shift % ALPHA_LEN) + ALPHA_LEN) % ALPHA_LEN;
  const steps: CipherStep[] = [];
  let output = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const transformed = shiftChar(ch, normalizedShift);
    output += transformed;
    steps.push({
      inputChar: ch,
      outputChar: transformed,
      position: i,
      shift: isAlpha(ch) ? normalizedShift : 0,
    });
  }

  return { input: text, output, algorithm: shift === 13 ? 'rot13' : 'caesar', key: shift, steps };
}

export function caesarDecode(text: string, shift: number): CipherResult {
  return caesar(text, -shift);
}

/* ─── Vigenère Cipher ─────────────────────────────────────────────────────── */

export function vigenere(text: string, key: string): CipherResult {
  if (!key || !/^[a-zA-Z]+$/.test(key)) {
    throw new Error('Vigenère key must be a non-empty alphabetic string');
  }

  const upperKey = key.toUpperCase();
  const steps: CipherStep[] = [];
  let output = '';
  let keyIndex = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (isAlpha(ch)) {
      const shift = upperKey.charCodeAt(keyIndex % upperKey.length) - UPPER_A;
      const transformed = shiftChar(ch, shift);
      output += transformed;
      steps.push({ inputChar: ch, outputChar: transformed, position: i, shift });
      keyIndex++;
    } else {
      output += ch;
      steps.push({ inputChar: ch, outputChar: ch, position: i, shift: 0 });
    }
  }

  return { input: text, output, algorithm: 'vigenere', key, steps };
}

export function vigenereDecode(text: string, key: string): CipherResult {
  if (!key || !/^[a-zA-Z]+$/.test(key)) {
    throw new Error('Vigenère key must be a non-empty alphabetic string');
  }

  const upperKey = key.toUpperCase();
  const steps: CipherStep[] = [];
  let output = '';
  let keyIndex = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (isAlpha(ch)) {
      const shift = -(upperKey.charCodeAt(keyIndex % upperKey.length) - UPPER_A);
      const transformed = shiftChar(ch, shift);
      output += transformed;
      steps.push({ inputChar: ch, outputChar: transformed, position: i, shift: Math.abs(shift) });
      keyIndex++;
    } else {
      output += ch;
      steps.push({ inputChar: ch, outputChar: ch, position: i, shift: 0 });
    }
  }

  return { input: text, output, algorithm: 'vigenere', key, steps };
}

/* ─── Atbash Cipher ───────────────────────────────────────────────────────── */

export function atbash(text: string): CipherResult {
  const steps: CipherStep[] = [];
  let output = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = ch.charCodeAt(0);
    let transformed: string;

    if (code >= UPPER_A && code < UPPER_A + ALPHA_LEN) {
      transformed = String.fromCharCode(UPPER_A + ALPHA_LEN - 1 - (code - UPPER_A));
    } else if (code >= LOWER_A && code < LOWER_A + ALPHA_LEN) {
      transformed = String.fromCharCode(LOWER_A + ALPHA_LEN - 1 - (code - LOWER_A));
    } else {
      transformed = ch;
    }

    output += transformed;
    steps.push({ inputChar: ch, outputChar: transformed, position: i, shift: 0 });
  }

  return { input: text, output, algorithm: 'atbash', key: 'mirror', steps };
}

/* ─── Brute-Force Caesar Crack ────────────────────────────────────────────── */

export function bruteForce(text: string): CipherResult[] {
  const results: CipherResult[] = [];
  for (let shift = 1; shift < ALPHA_LEN; shift++) {
    results.push(caesar(text, shift));
  }
  return results;
}

/* ─── Frequency Analysis ──────────────────────────────────────────────────── */

export function analyzeFrequency(text: string): CipherAnalysis {
  const freq: Record<string, number> = {};
  let totalLetters = 0;

  for (const ch of text.toUpperCase()) {
    if (isAlpha(ch)) {
      freq[ch] = (freq[ch] || 0) + 1;
      totalLetters++;
    }
  }

  // Normalize to percentages
  const normalized: Record<string, number> = {};
  for (const [k, v] of Object.entries(freq)) {
    normalized[k] = totalLetters > 0 ? (v / totalLetters) * 100 : 0;
  }

  // Sort by frequency
  const sorted = Object.entries(normalized).sort((a, b) => b[1] - a[1]);
  const mostCommon = sorted[0]?.[0] || '';
  const leastCommon = sorted[sorted.length - 1]?.[0] || '';

  // Shannon entropy
  let entropy = 0;
  for (const count of Object.values(freq)) {
    if (count > 0 && totalLetters > 0) {
      const p = count / totalLetters;
      entropy -= p * Math.log2(p);
    }
  }

  // English text typically has entropy ~4.0-4.2; random text ~4.7+
  const isLikelyEncrypted = entropy > 4.5 || totalLetters < 5;

  return { text, letterFrequency: normalized, mostCommon, leastCommon, entropy, isLikelyEncrypted };
}

/* ─── Display Obfuscation (Reversible) ────────────────────────────────────── */

export function obfuscateDisplay(value: string, visibleChars: number = 4): string {
  if (value.length <= visibleChars) return value;
  const masked = '\u2022'.repeat(value.length - visibleChars);
  return masked + value.slice(-visibleChars);
}

export function obfuscateMiddle(value: string, bookend: number = 4): string {
  if (value.length <= bookend * 2) return value;
  const start = value.slice(0, bookend);
  const end = value.slice(-bookend);
  const masked = '\u2022'.repeat(Math.min(value.length - bookend * 2, 12));
  return `${start}${masked}${end}`;
}

/* ─── Cipher Educational Info ─────────────────────────────────────────────── */

export interface CipherInfo {
  name: string;
  algorithm: CipherAlgorithm;
  yearInvented: string;
  inventor: string;
  description: string;
  strength: 'none' | 'trivial' | 'weak' | 'educational';
  keySpace: string;
  howItWorks: string[];
  funFact: string;
  modernEquivalent: string;
}

export const CIPHER_ENCYCLOPEDIA: CipherInfo[] = [
  {
    name: 'ROT13',
    algorithm: 'rot13',
    yearInvented: '1980s (Usenet era)',
    inventor: 'Internet community',
    description: 'A special case of the Caesar cipher with a fixed shift of 13. Self-inverse: encoding and decoding are the same operation.',
    strength: 'none',
    keySpace: '1 (no key needed)',
    howItWorks: [
      'Each letter is shifted 13 positions forward in the alphabet',
      'A→N, B→O, C→P, ... M→Z, N→A, O→B, ...',
      'Numbers, spaces, and punctuation remain unchanged',
      'Applying ROT13 twice returns the original text (self-inverse)',
    ],
    funFact: 'ROT13 was widely used on Usenet to hide spoilers and punchlines. The phrase "ROT13 encryption" is sometimes called the "hello world" of cryptography.',
    modernEquivalent: 'Base64 encoding (also not encryption, just encoding)',
  },
  {
    name: 'Caesar Cipher',
    algorithm: 'caesar',
    yearInvented: '~58 BC',
    inventor: 'Julius Caesar',
    description: 'One of the earliest known ciphers. Each letter is shifted by a fixed number of positions. Caesar reportedly used a shift of 3.',
    strength: 'trivial',
    keySpace: '25 possible shifts',
    howItWorks: [
      'Choose a shift value (1-25)',
      'Each letter moves forward by that many positions',
      'With shift=3: A→D, B→E, C→F, ...',
      'Wraps around: X→A, Y→B, Z→C',
      'To decode, shift in the opposite direction',
    ],
    funFact: 'Caesar\'s nephew Augustus also used a cipher, but shifted by only 1 position — making it even easier to crack. The entire cipher can be broken by trying all 25 possible shifts (brute force).',
    modernEquivalent: 'AES-256 (symmetric key encryption with 2^256 possible keys)',
  },
  {
    name: 'Vigenère Cipher',
    algorithm: 'vigenere',
    yearInvented: '1553',
    inventor: 'Giovan Battista Bellaso (popularized by Blaise de Vigenère)',
    description: 'A polyalphabetic cipher that uses a keyword to determine variable shifts for each letter, making frequency analysis much harder.',
    strength: 'weak',
    keySpace: '26^n where n = key length',
    howItWorks: [
      'Choose a keyword (e.g., "FORGE")',
      'Repeat the keyword to match the message length',
      'Each letter of the keyword determines the shift for that position',
      'F=5, O=14, R=17, G=6, E=4 — so shifts cycle: 5, 14, 17, 6, 4',
      'Same plaintext letter can encrypt to different ciphertext letters',
    ],
    funFact: 'It was called "le chiffre indéchiffrable" (the indecipherable cipher) for 300 years until Friedrich Kasiski published a method to crack it in 1863.',
    modernEquivalent: 'TLS/SSL with rotating session keys',
  },
  {
    name: 'Atbash Cipher',
    algorithm: 'atbash',
    yearInvented: '~500 BC',
    inventor: 'Hebrew scholars',
    description: 'A substitution cipher where the alphabet is reversed. A→Z, B→Y, C→X, etc. Like ROT13, it is self-inverse.',
    strength: 'none',
    keySpace: '1 (no key needed)',
    howItWorks: [
      'The alphabet is mapped to its reverse: A↔Z, B↔Y, C↔X, ...',
      'Named from Hebrew letters: Aleph→Tav, Beth→Shin',
      'Self-inverse: applying it twice returns the original text',
      'No key is needed — the mapping is always the same',
    ],
    funFact: 'The Atbash cipher appears in the Hebrew Bible. The word "Sheshach" in Jeremiah 25:26 is believed to be an Atbash encoding of "Babel" (Babylon).',
    modernEquivalent: 'Bitwise NOT operation (flipping all bits)',
  },
];

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

export function getCipherInfo(algorithm: CipherAlgorithm): CipherInfo | undefined {
  return CIPHER_ENCYCLOPEDIA.find((c) => c.algorithm === algorithm);
}

export function getAllCipherAlgorithms(): CipherAlgorithm[] {
  return ['rot13', 'caesar', 'vigenere', 'atbash'];
}
