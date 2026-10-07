import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import source from '@/docs/docs.md?raw';
import { inline, parseDocs, type DocBlock } from '@/docs/parseDocs';
import '@/docs/docs.css';
import { SiteFooter } from '@/components/site/SiteChrome';
import Seo from '@/seo/Seo';
import '@/seo/fonts';

const docs = parseDocs(source);

/** Every heading by its text, so "*Proxy rotation*" in a sentence links to that section. */
const anchors = new Map<string, string>();
for (const s of docs.sections) {
  anchors.set(s.title.toLowerCase(), s.id);
  for (const b of s.blocks) if (b.t === 'h3') anchors.set(b.text.toLowerCase(), b.id);
}

function Text({ value }: { value: string }) {
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

function Block({ block }: { block: DocBlock }): ReactNode {
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

/**
 * Public documentation at /docs, read from docs.md (the same file served to AI
 * tools as /llms-full.txt). The section rail works like a mission lane: the
 * sections behind you are done, the one you are reading is running.
 */
export default function DocsPage() {
  const [active, setActive] = useState(0);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);
  const ids = useMemo(() => docs.sections.map((s) => s.id), []);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      // The section whose top has passed a line a third of the way down the screen.
      const line = window.innerHeight * 0.32;
      let current = 0;
      sectionRefs.current.forEach((el, i) => {
        if (el && el.getBoundingClientRect().top <= line) current = i;
      });
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Keep the active chip visible in the phone-width rail.
  useEffect(() => {
    const chip = document.querySelector<HTMLElement>(`.dx-rail [data-step="${active}"]`);
    const rail = chip?.closest<HTMLElement>('.dx-rail ol');
    if (chip && rail && rail.scrollWidth > rail.clientWidth) {
      rail.scrollTo({ left: chip.offsetLeft - 16, behavior: 'smooth' });
    }
  }, [active]);

  const state = (i: number) => (i < active ? 'done' : i === active ? 'running' : 'waiting');

  return (
    <div className="dx">
      <Seo path="/docs" />

      <a className="dx-skip" href="#content">
        Skip to the docs
      </a>

      <header className="dx-top">
        <Link to="/" className="dx-brand" aria-label="FLEET by Vector Brain, home">
          <b>FLEET</b>
          <span>Docs</span>
        </Link>
        <nav aria-label="Site">
          <a href="/llms.txt">For AI tools</a>
          <Link to="/login">Sign in</Link>
          <Link className="dx-cta" to="/signup">
            Get started
          </Link>
        </nav>
      </header>

      <section className="dx-hero">
        <h1>
          <span>Run your phones</span>{' '}
          <span>with FLEET</span>
        </h1>
        <div className="dx-lede">
          {docs.intro.map((b, i) => (
            <Block key={i} block={b} />
          ))}
        </div>
      </section>

      <div className="dx-body">
        <nav className="dx-rail" aria-label="Sections">
          <ol style={{ ['--fill' as string]: String(active / Math.max(1, ids.length - 1)) }}>
            {docs.sections.map((s, i) => (
              <li key={s.id} data-step={i} data-state={state(i)}>
                <a href={`#${s.id}`} aria-current={i === active ? 'location' : undefined}>
                  <i aria-hidden="true" />
                  <span>{s.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <main id="content" className="dx-content">
          {docs.sections.map((s, i) => (
            <section
              key={s.id}
              id={s.id}
              aria-labelledby={`${s.id}-h`}
              ref={(el) => {
                sectionRefs.current[i] = el;
              }}
            >
              <h2 id={`${s.id}-h`}>
                <a href={`#${s.id}`}>{s.title}</a>
              </h2>
              {s.blocks.map((b, j) => (
                <Block key={j} block={b} />
              ))}
            </section>
          ))}

          <p className="dx-foot">
            The same text is available to AI assistants as <a href="/llms-full.txt">llms-full.txt</a>, with a short index at{' '}
            <a href="/llms.txt">llms.txt</a>.
          </p>
        </main>
      </div>
      <div className="st st-inline">
        <SiteFooter />
      </div>
    </div>
  );
}
