import { Fragment, type ReactNode } from 'react';
import { inline, type DocBlock } from './parseDocs';
import { anchors } from './docsData';

/**
 * The block/inline renderers for docs.md. Both the public docs page (/docs) and
 * the in-app Guide (/guide) render with these, so the two can never drift. The
 * parsed content and anchor map live in docsData.ts; presentation (layout, rail,
 * colours) belongs to each page.
 */
export function Text({ value }: { value: string }) {
  return (
    <>
      {inline(value).map((run, i) => {
        if (run.k === 'code') return <code key={i}>{run.v}</code>;
        if (run.k === 'b') return <strong key={i}>{run.v}</strong>;
        if (run.k === 'link') {
          const external = /^https?:/.test(run.href);
          return (
            <a key={i} href={run.href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>
              {run.v.replace(/^https?:\/\//, '')}
            </a>
          );
        }
        if (run.k === 'i') {
          const id = anchors.get(run.v.toLowerCase());
          return id ? (
            <a key={i} className="xref" href={`#${id}`}>
              {run.v}
            </a>
          ) : (
            <em key={i}>{run.v}</em>
          );
        }
        return <Fragment key={i}>{run.v}</Fragment>;
      })}
    </>
  );
}

export function Block({ block }: { block: DocBlock }): ReactNode {
  switch (block.t) {
    case 'h3':
      return (
        <h3 id={block.id}>
          <a href={`#${block.id}`}>{block.text}</a>
        </h3>
      );
    case 'p':
      return (
        <p>
          <Text value={block.text} />
        </p>
      );
    case 'ul':
    case 'ol': {
      const List = block.t;
      return (
        <List>
          {block.items.map((item, i) => (
            <li key={i}>
              <Text value={item} />
            </li>
          ))}
        </List>
      );
    }
    case 'table':
      return (
        <div className="table" role="region" tabIndex={0} aria-label="Table">
          <table>
            <thead>
              <tr>
                {block.head.map((h, i) => (
                  <th key={i} scope="col">
                    <Text value={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>
                      <Text value={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'code':
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      );
  }
}
