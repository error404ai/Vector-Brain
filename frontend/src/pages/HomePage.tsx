import { useEffect, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { startFleetLanding } from '@/components/landing/fleetLanding';
import type { ScreenKind } from '@/components/landing/screens';
import '@/components/landing/fleet.css';

const STEPS: { kind: ScreenKind; title: string; body: string }[] = [
  {
    kind: 'status',
    title: 'Connect your phones',
    body: 'Install the companion app on each phone, turn on accessibility and enter the pairing code. Any Android 10 or newer, as many as you own.',
  },
  {
    kind: 'command',
    title: 'Type the task',
    body: 'Write what you want done in plain words, in English or any language. Choose one phone, a group, or every phone.',
  },
  {
    kind: 'checkout',
    title: 'Watch it run',
    body: 'The AI reads each screen and does the taps for you. Watch every screen live, stop any run at once and read the results in chat.',
  },
];

const OPERATIONS: [string, string, string][] = [
  ['QA & regression', 'Run the same test on every model and Android version you own, and get a pass or fail per phone.', 'Taps · checks'],
  ['App flows', 'Sign-in, onboarding, checkout, settings. Describe the flow once and replay it across the fleet.', 'Flows'],
  ['Monitoring', 'Open an app on a schedule, read what is on screen and report what changed since the last run.', 'Scheduled'],
  ['Routines', 'The daily chores every phone repeats: updates, clean-ups, checks. Done without anyone watching.', 'Daily'],
  ['Any app', 'No SDK and no app changes. FLEET works through the screen, so it runs the apps you already use.', 'Any app'],
];

const RUNS: { kind: ScreenKind; title: string; body: string; devices: string; cadence: string }[] = [
  { kind: 'checkout', title: 'Checkout regression', body: 'Add to cart, pay and confirm on every model.', devices: '240', cadence: 'Android 10–15' },
  { kind: 'onboard', title: 'Onboarding sweep', body: 'First launch, permissions and sign-in, fresh install.', devices: '60', cadence: 'Per build' },
  { kind: 'monitor', title: 'Nightly app check', body: 'Open, read the screen, report what changed.', devices: '1,000', cadence: 'Every night' },
  { kind: 'settings', title: 'Settings audit', body: 'Read and set the same system options everywhere.', devices: '120', cadence: 'Weekly' },
  { kind: 'mail', title: 'Account inventory', body: 'Open the mail app and list the account on each phone.', devices: '36', cadence: 'On demand' },
  { kind: 'update', title: 'Rollout check', body: 'Confirm the new build installs and opens.', devices: '500', cadence: 'Per release' },
];

const NOTES: [string, string, string][] = [
  ['A', 'Input', 'Plain language. English or any language.'],
  ['B', 'Control', 'Android accessibility service. Real taps, types, swipes.'],
  ['C', 'Link', 'Live connection to the cloud. See every screen as it runs.'],
  ['D', 'Command queue', 'One instruction fans out to every phone you select.'],
  ['E', 'Stop', 'Instant. Mid-run, on one phone or all of them.'],
];

/**
 * Public landing page. A scroll-driven catalogue: floating phones assemble into
 * a fleet, one phone is shown as a product, then the fleet grows from 1 to
 * 1,000 as the camera pulls back. The scroll engine and the WebGL scene live
 * in components/landing; this component is only the markup.
 */
export default function HomePage() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rootRef.current) return;
    return startFleetLanding(rootRef.current);
  }, []);

  return (
    <div className="fl" ref={rootRef}>
      <Helmet>
        <title>FLEET by Vector Brain — AI that automates unlimited Android phones</title>
        <meta
          name="description"
          content="Type one instruction in plain words and an AI carries it out on every Android phone you connect: opening apps, tapping, typing and swiping. One phone or 10,000. Bring your own API key."
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,300..900&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </Helmet>

      <div className="fl-aurora" aria-hidden="true" />
      <canvas className="fl-gl" aria-hidden="true" />

      <header className="hud nav">
        <a className="brand" href="#c0" aria-label="FLEET by Vector Brain, back to top">
          <b>FLEET</b>
          <span className="mono">by Vector Brain</span>
        </a>
        <nav className="navr" aria-label="Primary">
          <a className="ctl" href="#how">How it works</a>
          <a className="ctl" href="#c3">Scale</a>
          <a className="ctl" href="#runs">Runs</a>
          <Link className="ctl" to="/login">Sign in</Link>
          <Link className="ctl solid" to="/signup">Get started</Link>
        </nav>
      </header>
      <div className="hud rail" aria-hidden="true">
        <span className="mono rl fl-rail-label">AI automation</span>
        <i />
        <span className="mono fl-rail-n">00</span>
      </div>
      <div className="hud corner c-tr" aria-hidden="true">
        <span>Index</span> <b className="fl-ix-n">00</b> / <span className="fl-ix-total">07</span>
        <br />
        <span>SKU</span> VB-FLT-001
      </div>
      <div className="hud corner c-bl" aria-hidden="true">
        <span>London, UK</span> · <b className="fl-clock">00:00:00</b> GMT
        <br />
        <span>Frame</span> <b className="fl-frame">0000</b>
      </div>
      <div className="hud corner c-br" aria-hidden="true">
        <span className="scrollcue">Scroll to operate</span>
      </div>

      <main>
        <section className="ch" id="c0" data-ch="0" data-label="AI automation" aria-label="FLEET">
          <div className="stage hero">
            <div className="hero-in">
              <p className="mono kicker">FLEET · AI automation for Android phones</p>
              <h1 className="display h-word">
                AI that automates <em>unlimited</em> Android phones.
              </h1>
              <p className="h-sub">
                Type one instruction in plain words. The AI opens apps, taps, types and swipes on every phone you
                connect, the way a person would. One phone or 10,000, all at the same time.
              </p>
              <div className="hctl">
                <Link className="ctl solid" to="/signup">Start automating</Link>
                <button className="ctl fl-watch" type="button">Watch 12s</button>
              </div>
            </div>
          </div>
        </section>

        <section className="how solid" id="how" data-label="How it works" aria-label="How it works">
          <div className="how-head">
            <p className="mono" style={{ color: 'var(--graphite)' }}>How it works</p>
            <h2 className="display">
              Three steps.
              <br />
              <em>No code.</em>
            </h2>
          </div>
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <div className="st-shot">
                  <canvas width={280} height={603} data-kind={s.kind} data-slot={`step-${i + 1}`} aria-hidden="true" />
                </div>
                <span className="mono st-n">Step {i + 1}</span>
                <h3 className="display">{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="ch" id="c1" data-ch="1" data-label="Any Android phone" aria-label="Any Android phone">
          <div className="stage sheet">
            <div className="lbl">
              <div className="mono" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Object</span>
                <span>VB-FLT-001</span>
              </div>
              <div className="no">#01</div>
              <h2 className="display">Any Android phone</h2>
              <div className="mono sub">Becomes an AI-operated unit</div>
              <svg className="bar fl-barcode" viewBox="0 0 240 44" preserveAspectRatio="none" aria-hidden="true" />
              <dl className="mono">
                <dt>Specs</dt>
                <dd>Accessibility · Live link · Cloud runtime · AI pilot</dd>
                <dt>Keys</dt>
                <dd>Bring your own (BYOK)</dd>
                <dt>Origin</dt>
                <dd>London, UK</dd>
              </dl>
            </div>
            <ul className="notes" aria-label="Unit notes">
              {NOTES.map(([k, title, body]) => (
                <li key={k}>
                  <b>{k}</b>
                  <span>
                    <strong>{title}</strong>
                    {body}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mono sheet-cap">Fig. 1 · Nothing to program on the phone. Move the cursor to turn it.</p>
          </div>
        </section>

        <section className="ch" id="c2" data-ch="2" data-label="The AI does the work" aria-label="What the AI does">
          <div className="stage mani">
            <div className="mani-txt">
              <p className="mono" style={{ color: 'var(--graphite)' }}>What the AI does</p>
              <h2 className="display">
                You type it.
                <br />
                <em>The AI taps it.</em>
              </h2>
              <div className="cols">
                <p>
                  You give the instruction the way you would brief a person. The AI looks at the screen, decides the
                  next tap and does it, step by step, until the task is done. If an app changes its layout, the AI
                  adapts instead of breaking.
                </p>
                <p>
                  No scripts to write and nothing to record. The same instruction works on one phone or on every phone
                  you own, at the same time. You bring your own AI key, so you pick the model and you own the cost.
                </p>
              </div>
              <div className="facts mono">
                <span><b>BYOK</b> · your own model keys</span>
                <span><b>Multilingual</b> · commands in any language</span>
                <span><b>Worldwide</b> · run from London, UK</span>
              </div>
            </div>
          </div>
        </section>

        <section className="ch" id="c3" data-ch="3" data-label="Unlimited devices" aria-label="One instruction, every phone">
          <div className="stage cmd">
            <div className="cmd-top">
              <p className="mono" style={{ color: 'var(--graphite)' }}>Unlimited devices</p>
              <h2 className="display">One instruction runs on every phone.</h2>
              <div className="prompt">
                <span>run checkout test on all devices</span>
                <span className="caret">&nbsp;</span>
              </div>
            </div>
            <div className="cmd-low">
              <p className="display count fl-count" aria-live="off">
                1<small>phone</small>
              </p>
              <div className="cmd-cap">
                <p className="fl-cap">One phone. Try the instruction here first.</p>
                <div className="status mono">
                  <span>Running <b className="fl-nrun">1</b></span>
                  <span>Done <b className="fl-ndone">0</b></span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="index" id="index" data-label="What you can automate" aria-label="What you can automate">
          <div className="ix-head">
            <h2 className="display">
              What you can
              <br />
              <em>automate</em>
            </h2>
            <p>If a person can do it with a thumb on the screen, FLEET can run it. These are the jobs teams hand over first.</p>
          </div>
          <ol className="ix">
            {OPERATIONS.map(([title, body, tag], i) => (
              <li key={title}>
                <span className="mono n">No. {String(i + 1).padStart(2, '0')}</span>
                <h3 className="display">{title}</h3>
                <p>{body}</p>
                <span className="mono tag">{tag}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* Real screens from the fleet; filled and shown only when approved shots exist. */}
        <section className="real" id="real" data-label="Real phones" aria-label="Real phones, real screens" hidden>
          <div className="real-head">
            <p className="mono" style={{ color: 'var(--graphite)' }}>Captured from the fleet</p>
            <h2 className="display">
              Real phones.
              <br />
              <em>Real screens.</em>
            </h2>
            <p>Every screen below was captured from a phone in our own test fleet: different brands, different Android versions, one platform.</p>
          </div>
          <div className="real-wall fl-real-wall" />
          <div className="real-apps fl-real-apps" />
        </section>

        <section className="runs" id="runs" data-label="Example runs" aria-label="Example runs">
          <div className="runs-head">
            <h2 className="display">
              Example
              <br />
              runs
            </h2>
            <p>Illustrative jobs, written the way operators type them. Each one is a single instruction sent to the whole fleet.</p>
          </div>
          <div className="grid">
            {RUNS.map((r, i) => (
              <article className="run" key={r.title}>
                <div className="run-top mono">
                  <span>Run {String(i + 1).padStart(2, '0')}</span>
                  <span>Example</span>
                </div>
                <div className="shot">
                  <canvas width={280} height={603} data-kind={r.kind} data-slot={`run-${i + 1}`} aria-hidden="true" />
                </div>
                <div>
                  <h3 className="display">{r.title}</h3>
                  <p>{r.body}</p>
                </div>
                <dl className="mono">
                  <div>
                    <dt>Devices</dt>
                    <dd>{r.devices}</dd>
                  </div>
                  <div>
                    <dt>Cadence</dt>
                    <dd>{r.cadence}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>

        <section className="close" id="close" data-label="Get started" aria-label="Get started">
          <p className="mono" style={{ color: '#64748B' }}>Get started</p>
          <h2 className="display">
            Start
            <br />
            <em>automating.</em>
          </h2>
          <div className="close-row">
            <p>
              Connect your first phone, add your own API key and send one instruction. When it works on one, send it
              to all of them.
            </p>
            <div className="auth">
              <Link className="ctl solid" to="/signup">Sign up with Google</Link>
              <Link className="ctl" to="/signup">Sign up with email</Link>
              <span className="mono">
                <small>Have an account?</small> <Link className="ctl" to="/login">Sign in</Link>
              </span>
            </div>
          </div>
          <div className="foot mono">
            <span>FLEET · by Vector Brain</span>
            <span>London, UK · Worldwide</span>
            <span>English + multilingual</span>
            <span>© {new Date().getFullYear()}</span>
          </div>
        </section>
      </main>
    </div>
  );
}
