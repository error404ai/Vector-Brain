/** Parser for Vector's plain-text chat replies; see ChatRichText for the grammar. */

export type Item = { n?: string; left: string; right?: string };
export type Block =
  | { type: 'p'; text: string }
  | { type: 'title'; text: string; of?: [number, number] }
  | { type: 'section'; title?: string; items: Item[]; ordered: boolean };

const BULLET = /^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/;
export const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
export const EMPTY = /^(no\b|none\b|not (saved|checked|found|set)|n\/a$|null$|unknown$|—$|-$)/i;
export const OF = /\((\d+)\s*(?:of|\/)\s*(\d+)\)/i;

const stripBold = (s: string) => s.replace(/^\*\*(.+)\*\*$/, '$1').trim();
const isHeading = (s: string) => {
  const t = stripBold(s.trim());
  return !BULLET.test(s) && t.length > 0 && t.length <= 80 && /:$/.test(t) && !/https?:\/\//.test(t);
};

function splitItem(text: string): Pick<Item, 'left' | 'right'> {
  for (const sep of [' — ', ' – ', ' - ']) {
    const at = text.indexOf(sep);
    if (at > 0) return { left: text.slice(0, at).trim(), right: text.slice(at + sep.length).trim() };
  }
  const colon = text.indexOf(': ');
  if (colon > 0 && colon <= 40 && !/https?:$/.test(text.slice(0, colon + 1))) {
    return { left: text.slice(0, colon).trim(), right: text.slice(colon + 2).trim() };
  }
  return { left: text.trim() };
}

export function parse(text: string): Block[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: Block[] = [];
  let section: Extract<Block, { type: 'section' }> | null = null;
  const close = () => {
    if (section && section.items.length) blocks.push(section);
    section = null;
  };
  const nextNonEmpty = (i: number) => {
    for (let j = i + 1; j < lines.length; j++) if (lines[j].trim()) return lines[j];
    return '';
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      // A blank line inside a list does not end it; the next heading or paragraph does.
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      if (!section) section = { type: 'section', items: [], ordered: Boolean(bullet[1]) };
      section.items.push({ n: bullet[1], ...splitItem(bullet[2]) });
      continue;
    }
    if (isHeading(line)) {
      const next = nextNonEmpty(i);
      const title = stripBold(line).replace(/:$/, '');
      if (BULLET.test(next)) {
        close();
        section = { type: 'section', title, items: [], ordered: false };
        continue;
      }
      if (isHeading(next)) {
        close();
        const m = OF.exec(title);
        blocks.push({ type: 'title', text: title, of: m ? [Number(m[1]), Number(m[2])] : undefined });
        continue;
      }
    }
    close();
    const last = blocks[blocks.length - 1];
    if (last && last.type === 'p') last.text += `\n${line.trim()}`;
    else blocks.push({ type: 'p', text: line.trim() });
  }
  close();
  return blocks;
}

/** True when the reply has structure worth laying out (a list or a titled section). */
export function isStructured(text: string): boolean {
  return parse(text ?? '').some((b) => b.type !== 'p');
}

