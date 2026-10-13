import source from './docs.md?raw';
import { parseDocs } from './parseDocs';

/**
 * docs.md parsed once. Kept separate from the renderers (DocsContent.tsx) so
 * that file can export only components (react-refresh). Both /docs and /guide
 * read from here, so the two pages can never drift.
 */
export const docs = parseDocs(source);

/** Every heading by its text, so "*Proxy rotation*" in a sentence links to that section. */
export const anchors = new Map<string, string>();
for (const s of docs.sections) {
  anchors.set(s.title.toLowerCase(), s.id);
  for (const b of s.blocks) if (b.t === 'h3') anchors.set(b.text.toLowerCase(), b.id);
}
