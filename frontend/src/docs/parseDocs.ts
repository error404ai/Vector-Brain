/**
 * A small Markdown reader for the docs page. docs.md is the single source for
 * both /docs and /llms-full.txt, so the page reads it as written instead of a
 * second copy that could drift. Only the subset docs.md uses is supported:
 * headings, paragraphs, lists, tables and fenced code; inline code, bold,
 * italics and links are handled when rendering.
 */

export type DocBlock =
  | { t: 'h3'; text: string; id: string }
  | { t: 'p'; text: string }
  | { t: 'ul' | 'ol'; items: string[] }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'code'; text: string };

export interface DocSection {
  id: string;
  title: string;
  blocks: DocBlock[];
}

export interface ParsedDocs {
  title: string;
  intro: DocBlock[];
  sections: DocSection[];
}

export const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

export function parseDocs(md: string): ParsedDocs {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: ParsedDocs = { title: '', intro: [], sections: [] };
  let target = out.intro;
  let para: string[] = [];

  const flush = () => {
    if (para.length) target.push({ t: 'p', text: para.join(' ') });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i]);
      target.push({ t: 'code', text: body.join('\n') });
      continue;
    }
    if (line.startsWith('# ')) {
      flush();
      out.title = line.slice(2).trim();
      continue;
    }
    if (line.startsWith('## ')) {
      flush();
      const title = line.slice(3).trim();
      const section: DocSection = { id: slug(title), title, blocks: [] };
      out.sections.push(section);
      target = section.blocks;
      continue;
    }
    if (line.startsWith('### ')) {
      flush();
      const text = line.slice(4).trim();
      const parent = out.sections[out.sections.length - 1]?.id ?? 'intro';
      target.push({ t: 'h3', text, id: `${parent}--${slug(text)}` });
      continue;
    }
    if (line.startsWith('|')) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      i++; // the |---| separator
      while (i + 1 < lines.length && lines[i + 1].startsWith('|')) rows.push(cells(lines[++i]));
      target.push({ t: 'table', head, rows });
      continue;
    }
    const bullet = /^- (.*)$/.exec(line);
    const numbered = /^\d+\. (.*)$/.exec(line);
    if (bullet || numbered) {
      flush();
      const kind = bullet ? 'ul' : 'ol';
      const re = bullet ? /^- (.*)$/ : /^\d+\. (.*)$/;
      const items = [(bullet ?? numbered)![1]];
      while (i + 1 < lines.length && re.test(lines[i + 1])) items.push(re.exec(lines[++i])![1]);
      target.push({ t: kind, items });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}

export type Inline =
  | { k: 'text'; v: string }
  | { k: 'code'; v: string }
  | { k: 'b'; v: string }
  | { k: 'i'; v: string }
  | { k: 'link'; v: string; href: string };

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)]+[^\s).,;:])/g;

/** Splits a line into text, code, bold, italic and link runs. */
export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push({ k: 'text', v: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ k: 'code', v: m[1] });
    else if (m[2] !== undefined) out.push({ k: 'b', v: m[2] });
    else if (m[3] !== undefined) out.push({ k: 'i', v: m[3] });
    else if (m[4] !== undefined) out.push({ k: 'link', v: m[4], href: m[5] });
    else out.push({ k: 'link', v: m[6], href: m[6] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ k: 'text', v: text.slice(last) });
  return out;
}
