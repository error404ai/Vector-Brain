import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import type { ReactNode } from 'react';

/**
 * Renders the small subset of markdown the agent actually produces in its
 * summaries: tables, bullet lists, headings, bold and inline code. Pulling in a
 * full markdown dependency would mean touching the lockfile, and the agent never
 * emits anything richer than this.
 */

/** Splits a line into bold / code / plain runs. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const token = match[0];

    if (token.startsWith('**')) {
      parts.push(
        <Box key={`${keyPrefix}-b${index}`} component="strong" sx={{ fontWeight: 800, color: 'text.primary' }}>
          {token.slice(2, -2)}
        </Box>,
      );
    } else {
      parts.push(
        <Box
          key={`${keyPrefix}-c${index}`}
          component="code"
          sx={{
            fontFamily: 'monospace',
            fontSize: '0.85em',
            px: 0.5,
            py: 0.125,
            borderRadius: 0.5,
            bgcolor: 'action.hover',
          }}
        >
          {token.slice(1, -1)}
        </Box>,
      );
    }

    lastIndex = match.index + token.length;
    index += 1;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

const isSeparatorRow = (line: string): boolean => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');

export default function AgentMarkdown({ text }: { text: string }) {
  if (!text?.trim()) return null;

  // Models often emit a whole table on one line; put each row back on its own.
  const normalised = text.replace(/\|\s*\|/g, '|\n|');
  const lines = normalised.split('\n');

  const blocks: ReactNode[] = [];
  let listBuffer: string[] = [];
  let key = 0;

  const flushList = () => {
    if (listBuffer.length === 0) return;
    const items = [...listBuffer];
    listBuffer = [];
    blocks.push(
      <Box key={`list-${key++}`} component="ul" sx={{ pl: 2.5, my: 0.75 }}>
        {items.map((item, i) => (
          <Typography key={i} component="li" variant="body2" sx={{ lineHeight: 1.6, mb: 0.25 }}>
            {renderInline(item, `li-${i}`)}
          </Typography>
        ))}
      </Box>,
    );
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    // Table: a header row followed by a |---|---| separator
    if (trimmed.startsWith('|') && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      flushList();
      const header = splitRow(trimmed);
      const rows: string[][] = [];
      let cursor = i + 2;

      while (cursor < lines.length && lines[cursor].trim().startsWith('|')) {
        if (!isSeparatorRow(lines[cursor])) rows.push(splitRow(lines[cursor]));
        cursor += 1;
      }
      i = cursor - 1;

      blocks.push(
        <Box
          key={`table-${key++}`}
          sx={{ my: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}
        >
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'action.hover' }}>
                {header.map((cell, ci) => (
                  <TableCell key={ci} sx={{ fontWeight: 800, fontSize: 12, py: 0.75 }}>
                    {renderInline(cell, `th-${ci}`)}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row, ri) => (
                <TableRow key={ri}>
                  {row.map((cell, ci) => (
                    <TableCell key={ci} sx={{ fontSize: 12.5, py: 0.6 }}>
                      {renderInline(cell, `td-${ri}-${ci}`)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>,
      );
      continue;
    }

    // Heading
    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushList();
      blocks.push(
        <Typography
          key={`h-${key++}`}
          variant="subtitle2"
          sx={{ fontWeight: 800, mt: 1, mb: 0.5, color: 'text.primary' }}
        >
          {renderInline(heading[2], `h-${key}`)}
        </Typography>,
      );
      continue;
    }

    // List item
    const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      listBuffer.push(bullet[1]);
      continue;
    }

    flushList();
    blocks.push(
      <Typography key={`p-${key++}`} variant="body2" sx={{ lineHeight: 1.65, mb: 0.5 }}>
        {renderInline(trimmed, `p-${key}`)}
      </Typography>,
    );
  }

  flushList();
  return <Box>{blocks}</Box>;
}
