/**
 * On-device visiting-card OCR (works with no network, via ML Kit).
 * Regex/heuristic field parsing is rougher than the server's AI scan
 * (lib/api.ts contacts scan-card), so callers should still let the user
 * verify fields before saving, and prefer the AI scan when online.
 */
import { Platform } from 'react-native';

export interface ParsedCard {
  firstName: string;
  lastName:  string;
  jobTitle:  string;
  company:   string;
  email:     string;
  phone:     string;
  mobile:    string;
}

const EMPTY: ParsedCard = {
  firstName: '', lastName: '', jobTitle: '', company: '', email: '', phone: '', mobile: '',
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /(\+?\d[\d\s().-]{6,}\d)/;
const TITLE_WORDS = [
  'ceo', 'cto', 'coo', 'cfo', 'president', 'founder', 'co-founder',
  'director', 'manager', 'head of', 'lead', 'engineer', 'officer',
  'executive', 'sales', 'marketing', 'consultant', 'owner', 'partner',
];

/**
 * Offline fallback for voice capture: splits a dictated sentence into
 * fragments and runs them through the same heuristics as card OCR.
 * The server's AI parse (contacts/parse-lead-text) is preferred when online.
 */
export function parseDictation(text: string): ParsedCard {
  const fragments = text
    .split(/[,.;\n]| and | at | from /i)
    .map((f) => f.trim())
    .filter(Boolean);
  return parseLines(fragments);
}

export async function recognizeCardOffline(imageUri: string): Promise<ParsedCard> {
  if (Platform.OS === 'web') throw new Error('On-device OCR is not available in the browser');
  // Lazy require: this is a phone-only native module — importing it at the top
  // crashes web/preview builds before any screen renders.
  const TextRecognition = require('@react-native-ml-kit/text-recognition').default;
  const result = await TextRecognition.recognize(imageUri);
  const lines = (result.text as string)
    .split('\n')
    .map((l: string) => l.trim())
    .filter(Boolean);
  return parseLines(lines);
}

function parseLines(lines: string[]): ParsedCard {
  const parsed = { ...EMPTY };
  const remaining: string[] = [];

  for (const line of lines) {
    const email = line.match(EMAIL_RE)?.[0];
    if (email && !parsed.email) {
      parsed.email = email;
      continue;
    }

    const phone = line.match(PHONE_RE)?.[0];
    if (phone) {
      if (!parsed.phone) parsed.phone = phone.trim();
      else if (!parsed.mobile) parsed.mobile = phone.trim();
      continue;
    }

    if (!parsed.jobTitle && TITLE_WORDS.some((w) => line.toLowerCase().includes(w))) {
      parsed.jobTitle = line;
      continue;
    }

    remaining.push(line);
  }

  // Best-effort: first short, letters-only line is the name; next leftover line is the company.
  const nameIdx = remaining.findIndex((l) => /^[A-Za-z.\s'-]+$/.test(l) && l.split(' ').length <= 4);
  if (nameIdx !== -1) {
    const parts = remaining[nameIdx].split(' ').filter(Boolean);
    parsed.firstName = parts[0] ?? '';
    parsed.lastName  = parts.slice(1).join(' ');
    remaining.splice(nameIdx, 1);
  }

  if (remaining.length) parsed.company = remaining[0];

  return parsed;
}
