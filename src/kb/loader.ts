import * as fs from 'fs';
import * as path from 'path';

const KB_DIR = path.join(__dirname, '../../kb');

const KB_FILES = [
  'kb_coaching-principles.md',
  'kb_triggers-responses.md',
  'kb_what-works.md',
  'kb_daily-structure.md',
];

let cachedKB: string | null = null;

export function loadKnowledgeBase(forceReload: boolean = false): string {
  if (cachedKB && !forceReload) return cachedKB;

  const sections: string[] = [];

  for (const file of KB_FILES) {
    const filePath = path.join(KB_DIR, file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      sections.push(content);
    } else {
      console.warn(`KB file not found: ${file}`);
    }
  }

  cachedKB = sections.join('\n\n---\n\n');
  return cachedKB;
}

export function reloadKnowledgeBase(): string {
  cachedKB = null;
  return loadKnowledgeBase();
}
