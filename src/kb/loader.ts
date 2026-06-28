import * as fs from 'fs';
import * as path from 'path';

const KB_DIR = path.join(__dirname, '../../kb');

// ── Universal KB: Natascha's methodology, techniques, research ──
// These are loaded for ALL families. They contain zero private data.
const UNIVERSAL_FILES = [
  'kb_coaching-principles.md',
  'kb_triggers-responses.md',
  'kb_what-works.md',
  'kb_daily-structure.md',
];

// ── Founding family KB: profiles specific to Idan, Sveta & Maya ──
// These are ONLY loaded when the requesting family matches FOUNDING_FAMILY_ID.
const FOUNDING_FAMILY_DIR = path.join(KB_DIR, 'families', 'founding');
const FOUNDING_FAMILY_FILES = [
  'kb_maya-profile.md',
  'kb_parent-profiles.md',
];

// Set this in Vercel env vars after first onboarding completes.
const FOUNDING_FAMILY_ID = process.env.FOUNDING_FAMILY_ID || '';

// Cache per family to avoid re-reading files on every message
const cache = new Map<string, string>();

export function loadKnowledgeBase(familyId?: string): string {
  const cacheKey = familyId || '__universal__';
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  const sections: string[] = [];

  // 1. Always load universal methodology
  for (const file of UNIVERSAL_FILES) {
    const filePath = path.join(KB_DIR, file);
    if (fs.existsSync(filePath)) {
      sections.push(fs.readFileSync(filePath, 'utf-8'));
    } else {
      console.warn(`[KB] Universal file not found: ${file}`);
    }
  }

  // 2. Load founding-family files ONLY for the founding family
  if (familyId && FOUNDING_FAMILY_ID && familyId === FOUNDING_FAMILY_ID) {
    for (const file of FOUNDING_FAMILY_FILES) {
      const filePath = path.join(FOUNDING_FAMILY_DIR, file);
      if (fs.existsSync(filePath)) {
        sections.push(fs.readFileSync(filePath, 'utf-8'));
      } else {
        console.warn(`[KB] Founding family file not found: ${file}`);
      }
    }
  }

  const result = sections.join('\n\n---\n\n');
  cache.set(cacheKey, result);
  return result;
}

export function reloadKnowledgeBase(): void {
  cache.clear();
}
