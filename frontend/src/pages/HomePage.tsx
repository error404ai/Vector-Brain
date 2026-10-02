import { useEffect, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { startFleetLanding } from '@/components/landing/fleetLanding';
import type { ScreenKind } from '@/components/landing/screens';
import '@/components/landing/fleet.css';

const STEPS: { kind: ScreenKind; title: string; body: string }[] = [
  {
    kind: 'status',
    title: 'Install the app',
    body: 'Put the FLEET app on each phone, turn on accessibility and enter the pairing code. No ADB, no USB cable, no root. Any Android 10 or newer.',
  },
  {
    kind: 'command',
    title: 'Add your key, type the task',
    body: 'Add your own AI key (OpenAI, Anthropic, Google and more), then write what you want done in plain words. Choose one phone, a group, or every phone.',
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

/** Live fleet wall: stock footage standing in for phone screens while they work. */
const LIVE: { id: string; task: string; status: 'Playing' | 'Scrolling' | 'Checking' | 'Done'; tone: 'run' | 'done' }[] = [
  { id: 'PH-01', task: 'Play', status: 'Playing', tone: 'run' },
  { id: 'PH-02', task: 'Scroll', status: 'Scrolling', tone: 'run' },
  { id: 'PH-03', task: 'Check', status: 'Checking', tone: 'run' },
  { id: 'PH-04', task: 'Play', status: 'Playing', tone: 'run' },
  { id: 'PH-05', task: 'Open', status: 'Done', tone: 'done' },
  { id: 'PH-06', task: 'Loop', status: 'Playing', tone: 'run' },
];

/** FAQ: only answers the product actually backs (see the pairing, BYOK, flows and proxy code). */
const FAQ: { q: string; a: string }[] = [
  {
    q: 'Why real phones instead of emulators or a cloud device farm?',
    a: 'Apps that refuse to run on emulators work normally on a real phone, and the accounts already signed in on it stay signed in. The phones are yours, so there are no rented seats and nothing is billed per minute.',
  },
  {
    q: 'Do I need to know Appium or write code?',
    a: 'No. A task is a sentence describing what should happen. Nobody has to learn a mobile automation framework or maintain selectors when a screen changes.',
  },
  {
    q: 'Which phones work?',
    a: 'Any Android phone on Android 10 or newer, from any brand. Install the companion app, turn on accessibility, enter the pairing code and the phone joins your fleet.',
  },
  {
    q: 'Do I need ADB, USB debugging or a computer next to the phones?',
    a: 'No. The FLEET app on each phone connects to the cloud over Wi-Fi or mobile data. There is no ADB, no USB cable and no PC to keep plugged in; the phones can sit anywhere with a connection.',
  },
  {
    q: 'Which apps can it use?',
    a: 'Any app installed on the phone. FLEET works through the screen the way a person does, so there is no SDK to add and nothing to change in the app.',
  },
  {
    q: 'Does it need root or device-owner access?',
    a: 'No. The companion app works through Android accessibility, so an ordinary phone that is not rooted and not enrolled as a managed device works as it is. Root or device-owner access may unlock optional advanced features later, but nothing requires them.',
  },
  {
    q: 'How many phones can I run?',
    a: 'As many as you pair. There is no per-device limit; the ceiling is the number of phones you have connected.',
  },
  {
    q: 'Which AI models does it use?',
    a: 'Your own. Add a key from OpenAI, Anthropic, Google, DeepSeek, Groq or OpenRouter; you pay your provider directly and can run a different model on each phone.',
  },
  {
    q: 'What happens when an app updates and the screen changes?',
    a: 'An AI run reads whatever is on screen right now, so a moved button does not break it. A saved flow replays fixed steps, so a changed screen is caught there and can be handed back to the AI.',
  },
  {
    q: 'Can I watch a run and stop it?',
    a: 'Yes. Every phone streams its screen while it works, and Stop ends a run at once, on one phone or on all of them.',
  },
  {
    q: 'What happens if a task gets stuck?',
    a: 'The run stops itself instead of tapping forever. If the screen stops changing after repeated actions, the same action keeps repeating on an unchanged screen, or the phone or the AI provider goes silent for a few minutes, the task ends and the reason is written in the results. You can also press Stop at any time.',
  },
  {
    q: 'Can I repeat a task without paying for the AI again?',
    a: 'Yes. Save a finished run as a flow and it replays with no model calls, doing the same steps every time.',
  },
  {
    q: 'Can I put phones behind my own proxies?',
    a: 'Yes. Group phones into proxy lanes and choose how often the IP rotates, for example after every task.',
  },
  {
    q: 'Can I start a run without opening the dashboard?',
    a: 'Yes. Link a Telegram chat and send the task there. The result and a picture of the final screen come back in the same chat.',
  },
];

/** Mobile browser section: what the agent does in the phone's own Chrome (see eko/AndroidAgent open_url). */
const BROWSER: [string, string][] = [
  ['Real Chrome', 'Pages open in the Chrome already on the phone, with the logins and cookies that are on it.'],
  ['Any web task', 'Search, sign in, fill a form, compare prices, download a file. Written in plain words.'],
  ['Reads the page', 'The AI reads the page like a screen reader, and looks at a screenshot when a site hides its content.'],
  ['Every phone', 'Send one browser task to one phone, a group, or the whole farm at the same time.'],
];

const BROWSER_LOG: [string, string][] = [
  ['Open', 'google.com/search?q=wireless+earbuds+under+50'],
  ['Read', '10 results on screen'],
  ['Tap', 'Shopping'],
  ['Read', 'Prices from 4 stores'],
  ['Done', 'Cheapest: £34.99 · 12s'],
];

/** Dashboard controls, each backed by a real page or fleet-chat tool. */
const FARM: [string, string, string][] = [
  ['A', 'Fleet', 'Every phone in the farm with its state, battery and app version. See at a glance which ones need setup.'],
  ['B', 'AI chat', 'Type "run the sign-in check on every Samsung". The AI picks the phones and plans the run; you press Confirm.'],
  ['C', 'Live screens', 'Watch every phone while it works and stop one, a group or the whole farm at once.'],
  ['D', 'Flows & schedules', 'Save a run and replay it with no AI cost, or set it to run on a schedule.'],
  ['E', 'Proxy lanes', 'Group phones behind your proxies, rotate the IP and choose how many run at the same time.'],
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
          href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,300..900&family=IBM+Plex+Mono:wght@400;500&family=Instrument+Serif:ital@1&display=swap"
        />
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
          })}
        </script>
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
          <a className="ctl" href="#dashboard">Dashboard</a>
          <a className="ctl" href="#c3">Scale</a>
          <a className="ctl" href="#faq">FAQ</a>
          <Link className="ctl ghost" to="/login">Sign in</Link>
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
        <span>Worldwide</span> · <b className="fl-clock">00:00:00</b> UTC
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
              <p className="mono kicker">No ADB · No USB cable · No root</p>
              <h1 className="display h-word">
                AI that automates <em>unlimited</em> Android phones.
              </h1>
              <p className="h-sub">
                Install our app on any Android phone, add your own AI key and type what you want done. The AI opens
                apps, taps, types and swipes on every connected phone, the way a person would. One phone or 10,000.
              </p>
              <div className="hctl">
                <Link className="ctl solid cta" to="/signup">Start automating</Link>
                <button className="ctl fl-watch" type="button">Watch 12s</button>
              </div>
              <ol className="mono setup-strip" aria-label="Setup in three steps">
                <li><b>01</b> Install the app</li>
                <li><b>02</b> Add your AI key</li>
                <li><b>03</b> Type the task</li>
              </ol>
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
                <dt>Runs</dt>
                <dd>Worldwide</dd>
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
                <span><b>Worldwide</b> · run from anywhere</span>
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

        <section className="live" id="live" data-label="Every screen, live" aria-label="Every screen, live">
          <div className="live-head">
            <div>
              <p className="mono live-eyebrow">
                <i className="live-dot" /> Live fleet
              </p>
              <h2 className="display">
                Every screen,
                <br />
                <em>live.</em>
              </h2>
            </div>
            <p>
              Each phone streams its screen back while it works. Open an app, play a video, scroll a feed and check the
              result on every device at the same time, and watch all of it from one page.
            </p>
          </div>
          <div className="live-body">
            <div className="live-row">
              {LIVE.map((t, i) => (
                <figure className="live-tile" key={t.id}>
                  <video
                    className="fl-live-video"
                    src={`/landing/live/l${i + 1}.mp4`}
                    poster={`/landing/live/l${i + 1}.jpg`}
                    muted
                    loop
                    playsInline
                    preload="none"
                    aria-hidden="true"
                  />
                  <figcaption>
                    <span className="mono live-top">
                      <span>{t.id}</span>
                      <span>{t.task}</span>
                    </span>
                    <span className="mono live-bottom">
                      <i className={`live-state is-${t.tone}`} />
                      {t.status}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
            <aside className="live-side" aria-label="Activity">
              <div className="live-stats mono">
                <div>
                  <span>Phones</span>
                  <b>6</b>
                </div>
                <div>
                  <span>Running</span>
                  <b>5</b>
                </div>
                <div>
                  <span>Done</span>
                  <b>1</b>
                </div>
              </div>
              <p className="mono live-feed-h">Activity</p>
              <ol className="live-feed fl-live-feed" aria-live="off">
                <li><b>PH-05</b> Task done in 41s</li>
                <li><b>PH-03</b> Checked the result on screen</li>
                <li><b>PH-02</b> Scrolled the feed</li>
                <li><b>PH-01</b> Opened the video app</li>
              </ol>
              <p className="mono live-note">Illustrative feed · stock footage</p>
            </aside>
          </div>
        </section>

        <section className="farm" id="dashboard" data-label="Phone farm control" aria-labelledby="farm-title">
          <div className="farm-head">
            <p className="mono farm-eyebrow">Phone farm control</p>
            <h2 className="display" id="farm-title">
              Your phone farm.
              <br />
              <em>One dashboard.</em>
            </h2>
            <p>
              Install the FLEET app on every phone in your farm and pair it with a code. It shows up in your dashboard,
              and from there the AI runs them: you type what you want, it plans the run, you confirm.
            </p>
          </div>
          <div className="farm-body">
            <figure className="farm-shot">
              <div className="farm-bar" aria-hidden="true">
                <i />
                <i />
                <i />
                <span className="mono">app.vectoragent.in / mission-control</span>
              </div>
              <div className="farm-img fl-farm-img">
                <div className="farm-ph mono" aria-hidden="true">
                  <span>Dashboard screenshot</span>
                  <small>Preview · the real screen appears here once approved</small>
                </div>
              </div>
            </figure>
            <ol className="farm-notes">
              {FARM.map(([k, title, body]) => (
                <li key={k}>
                  <b className="mono">{k}</b>
                  <span>
                    <strong className="mono">{title}</strong>
                    {body}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <p className="mono farm-foot">Install the app · Pair with a code · No ADB, no cable, no root</p>
        </section>

        <section className="web" id="browser" data-label="Mobile browser" aria-labelledby="web-title">
          <div className="web-grid">
            <div className="web-txt">
              <p className="mono web-eyebrow">Mobile browser</p>
              <h2 className="display" id="web-title">
                Control your mobile browser
                <br />
                <em>with AI.</em>
              </h2>
              <p className="web-lede">
                Any browser task, typed the way you would ask a person. The AI opens the site in the phone&apos;s own
                Chrome, reads the page and does the taps, on one phone or every phone in the farm.
              </p>
              <ul className="web-list">
                {BROWSER.map(([title, body]) => (
                  <li key={title}>
                    <strong className="mono">{title}</strong>
                    <span>{body}</span>
                  </li>
                ))}
              </ul>
            </div>
            <figure className="web-demo" aria-label="Example browser task">
              <div className="web-ask mono">
                <span>Task</span>
                Find the cheapest wireless earbuds under £50
              </div>
              <div className="web-phone fl-web-phone" aria-hidden="true">
                <div className="web-url mono">
                  <i />
                  google.com/search
                </div>
                <div className="web-page">
                  <b />
                  <b />
                  <b className="hit" />
                  <b />
                  <b />
                </div>
              </div>
              <ol className="web-log mono">
                {BROWSER_LOG.map(([verb, text], i) => (
                  <li key={verb + i} style={{ animationDelay: `${0.4 + i * 0.45}s` }}>
                    <b>{verb}</b>
                    {text}
                  </li>
                ))}
              </ol>
              <figcaption className="mono">Illustrative run</figcaption>
            </figure>
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
            <p>
              <span className="mono runs-flag">Illustrative examples</span>
              Jobs written the way operators type them. Each one is a single instruction sent to the whole fleet; device
              counts and cadence show the shape of a run, not results from a customer.
            </p>
          </div>
          <div className="grid">
            {RUNS.map((r, i) => (
              <article className="run" key={r.title}>
                <div className="run-top mono">
                  <span>Run {String(i + 1).padStart(2, '0')}</span>
                  <span className="run-flag">Illustrative</span>
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

        <section className="faq" id="faq" data-label="FAQ" aria-labelledby="faq-title">
          <p className="mono faq-eyebrow">FAQ</p>
          <h2 className="faq-title" id="faq-title">
            <span className="display">The questions</span>
            <em>operators actually ask.</em>
          </h2>
          <div className="faq-list">
            {FAQ.map((item) => (
              <details className="faq-item" key={item.q}>
                <summary>
                  <span>{item.q}</span>
                  <i aria-hidden="true" />
                </summary>
                <p>{item.a}</p>
              </details>
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
              <div className="auth-row">
                <Link className="ctl solid cta" to="/signup">Get started</Link>
                <a className="ctl cta-alt" href="#how">See how it works</a>
              </div>
              <p className="mono auth-note">Connect one phone first. Scale when it works.</p>
              <span className="mono">
                <small>Google or email · Have an account?</small> <Link className="ctl" to="/login">Sign in</Link>
              </span>
            </div>
          </div>
          <div className="foot mono">
            <span>FLEET · by Vector Brain</span>
            <span className="foot-links">
              <Link to="/docs">Docs</Link>
              <a href="/llms.txt">llms.txt</a>
            </span>
            <span>Worldwide</span>
            <span>English + multilingual</span>
            <span>© {new Date().getFullYear()}</span>
          </div>
        </section>
      </main>
    </div>
  );
}
