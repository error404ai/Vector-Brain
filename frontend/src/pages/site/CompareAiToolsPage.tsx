import { Link } from 'react-router-dom';
import ProductPage, { type Faq } from '@/components/site/ProductPage';

/**
 * AI Android automation tools, compared. Every claim about another product was
 * checked on its own site, docs or GitHub in October 2026 and links there;
 * anything a vendor does not state is written as "not stated", never guessed.
 * No prices: they change, and each row links to the vendor's own page.
 * Re-check before editing a row.
 */

const CHECKED = 'October 2026';

interface Tool {
  name: string;
  url: string;
  what: string;
  phones: string;
  control: string;
  needs: string;
  many: string;
  open: string;
  pricing: string;
  pick: string;
}

const TOOLS: Tool[] = [
  {
    name: 'FLEET by Vector Brain',
    url: '/',
    what: 'AI agent that runs plain-language tasks on a fleet of real Android phones',
    phones: 'Your own Android 10+ phones, anywhere with a connection',
    control: 'Plain-language tasks in the dashboard, Mission Control chat or Telegram',
    needs: 'The Vector app on each phone; no computer, root, ADB or USB',
    many: 'Yes: up to 1,000 phones in a fleet, up to 50 per mission, with proxy lanes',
    open: 'No',
    pricing: 'Free; you pay your own AI provider',
    pick: 'Many phones you own, signed-in accounts, long runs, watched live',
  },
  {
    name: 'Mobilerun (formerly DroidRun)',
    url: 'https://docs.mobilerun.ai/',
    what: 'Open-source framework for driving Android and iOS with LLM agents, plus a hosted cloud',
    phones: 'Your own phone, or their hosted virtual or physical phones',
    control: 'Natural-language tasks, Python, REST API, SDKs and MCP',
    needs: 'Framework: a computer with Python, ADB and USB debugging. Cloud personal phone: their app',
    many: 'Cloud pitched for fleet workflows on hosted devices; personal phones marked not scalable',
    open: 'Framework: MIT',
    pricing: 'Framework free; cloud per device per month',
    pick: 'Developers who want an open-source library or an API',
  },
  {
    name: 'HeyPico',
    url: 'https://heypico.ai/features/android-apps-automation',
    what: 'Personal AI assistant that can operate apps on a paired Android device',
    phones: 'Your own phone, or a companion tablet they sell',
    control: 'Typed or spoken requests, routines, and an MCP / JSON-RPC API',
    needs: 'Their companion app (sideloaded) with accessibility access; Android 8+',
    many: 'Not stated; setup describes one paired device',
    open: 'Not stated',
    pricing: 'Paid subscription with a free trial',
    pick: 'One person automating their own phone',
  },
  {
    name: 'PokeClaw',
    url: 'https://github.com/agents-io/PokeClaw',
    what: 'Open-source app where an AI on the phone itself operates that phone',
    phones: 'The phone it is installed on',
    control: 'Plain-language tasks; local Gemma model or your own cloud API key',
    needs: 'No computer or root; arm64 Android 9+ with 8 GB RAM or more for the local model',
    many: 'No: one phone',
    open: 'Apache 2.0',
    pricing: 'Not stated; local mode needs no account',
    pick: 'Fully on-device, private use of one capable phone',
  },
  {
    name: 'LaiCai Flow',
    url: 'https://www.laicaiapp.com/en/ai-android-automation/',
    what: 'Screen-mirroring desktop app with visual automation flows and an AI planner',
    phones: 'Real phones or emulators connected to your computer',
    control: 'Drag-and-drop flow nodes; the AI Planner or MCP drafts a flow',
    needs: 'A Windows or macOS computer; USB debugging for the USB route',
    many: 'Group control and batch actions from one computer',
    open: 'Not stated',
    pricing: 'Free plan (3 devices) and a paid plan',
    pick: 'Mirroring and scripting phones from a desktop',
  },
  {
    name: 'Momentic',
    url: 'https://momentic.ai/android-testing',
    what: 'AI QA platform that writes, runs and repairs end-to-end tests',
    phones: 'Hosted or local Android emulators; physical devices not supported today',
    control: 'YAML tests with plain-English steps, run from a CLI',
    needs: 'A computer with Android SDK tools (adb)',
    many: 'Parallel emulator sessions, by plan',
    open: 'Not stated',
    pricing: 'Free tier, usage-based credits, enterprise',
    pick: 'Testing your own app in CI',
  },
  {
    name: 'Sofy',
    url: 'https://sofy.ai/',
    what: 'No-code AI testing agents for mobile, web, API and ERP',
    phones: 'Their cloud of real iOS and Android devices',
    control: 'Test scenarios typed in plain English',
    needs: 'Not stated; the site says no device configuration',
    many: 'Parallel sessions, by plan',
    open: 'Not stated',
    pricing: 'Paid plans with a free trial; enterprise by quote',
    pick: 'QA teams testing on devices they do not own',
  },
  {
    name: 'Apptest.ai',
    url: 'https://apptest.ai/',
    what: 'AI app testing on real devices: autonomous runs and a no-code scenario builder',
    phones: 'Real devices',
    control: 'Autonomous AI runs or drag-and-drop steps',
    needs: 'Not stated; desktop and browser apps exist',
    many: 'Multiple devices on the team plan',
    open: 'Not stated',
    pricing: 'Free trial, team plan, enterprise by quote',
    pick: 'QA and DevOps teams wanting scriptless app tests',
  },
];

const COLUMNS: [keyof Tool, string][] = [
  ['what', 'What it is'],
  ['phones', 'Which phones'],
  ['control', 'How you drive it'],
  ['needs', 'What it needs'],
  ['many', 'Many phones at once'],
  ['open', 'Open source'],
  ['pricing', 'Pricing model'],
  ['pick', 'Best fit'],
];

const FAQ: Faq[] = [
  {
    q: 'Which tool is best for AI Android automation?',
    a: 'It depends on whose phones and what for. To test your own app in CI, a QA platform such as Momentic, Sofy or Apptest.ai fits. To build on an open-source library, Mobilerun. To automate one personal phone, HeyPico or, fully on-device, PokeClaw. To run plain-language tasks across many phones you own, watched live, FLEET.',
  },
  {
    q: 'Which of these run on my own real phones without a computer?',
    a: 'FLEET, HeyPico, PokeClaw and Mobilerun’s cloud personal-phone option each use an app on the phone instead of ADB from a computer. Of those, FLEET is the one built to run one task across a fleet of your own phones.',
  },
  {
    q: 'Is FLEET open source?',
    a: 'No. FLEET is free to use; you bring your own AI model key and pay your provider for the model calls. Mobilerun’s framework (MIT) and PokeClaw (Apache 2.0) are open source.',
  },
  {
    q: 'How current is this comparison?',
    a: `Each product was checked on its own website, documentation or GitHub in ${CHECKED}. Products change; follow the links for their current details and prices.`,
  },
];

export default function CompareAiToolsPage() {
  return (
    <ProductPage
      path="/compare/ai-android-automation-tools"
      h1="AI Android automation tools, compared"
      lede={
        <p>
          Eight tools that let an AI operate Android phones, side by side: whose phones they run on, how you drive them, what they
          need and how many phones they handle at once. Checked against each product’s own site in {CHECKED}; where a vendor does
          not say, the table says “not stated”.
        </p>
      }
      faq={FAQ}
      related={[
        { to: '/compare/appium', label: 'FLEET vs Appium', note: 'AI tasks vs test scripts' },
        { to: '/compare/cloud-device-farms', label: 'Own phones vs cloud device farms' },
        { to: '/android-automation-without-root', label: 'Android automation without root or ADB' },
      ]}
    >
      <section aria-labelledby="short">
        <h2 id="short">The short answer</h2>
        <ul>
          <li>
            <strong>Testing your own app:</strong> a QA platform: Momentic (emulators, CI), Sofy (their real devices) or Apptest.ai.
          </li>
          <li>
            <strong>Building with code:</strong> Mobilerun, an MIT-licensed framework with an API and SDKs.
          </li>
          <li>
            <strong>One personal phone:</strong> HeyPico, or PokeClaw to keep everything on the phone.
          </li>
          <li>
            <strong>Many phones you own, from one instruction:</strong> FLEET: up to 1,000 phones, no computer beside them, every
            screen live.
          </li>
        </ul>
      </section>

      <section aria-labelledby="table">
        <h2 id="table">Side by side</h2>
        <div className="st-table" role="region" tabIndex={0} aria-labelledby="table">
          <table>
            <thead>
              <tr>
                <th scope="col">Tool</th>
                {COLUMNS.map(([, label]) => (
                  <th scope="col" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TOOLS.map((tool) => (
                <tr key={tool.name}>
                  <th scope="row">
                    {tool.url.startsWith('/') ? (
                      <Link to={tool.url}>{tool.name}</Link>
                    ) : (
                      <a href={tool.url} target="_blank" rel="noopener noreferrer">
                        {tool.name}
                      </a>
                    )}
                  </th>
                  {COLUMNS.map(([key]) => (
                    <td key={key}>{tool[key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="fleet">
        <h2 id="fleet">Where FLEET is different</h2>
        <ul>
          <li>It is built for fleets: one plain-language instruction runs on many of your own phones, each checked and reported.</li>
          <li>No computer beside the phones: each runs the Vector app and connects over Wi-Fi or mobile data.</li>
          <li>Phones keep their apps and signed-in accounts between runs, and can sit behind your own proxies, grouped into lanes.</li>
          <li>
            Every screen streams live, and a finished run can be saved as a <Link to="/docs">flow</Link> that replays without AI calls.
          </li>
        </ul>
      </section>

      <section aria-labelledby="not">
        <h2 id="not">Where another tool fits better</h2>
        <ul>
          <li>iOS, or devices you do not own: Sofy’s device cloud or Mobilerun’s hosted phones.</li>
          <li>Tests wired into CI with a test file per flow: Momentic.</li>
          <li>An open-source library to build your own agent: Mobilerun.</li>
          <li>Everything on one phone with a local model: PokeClaw.</li>
        </ul>
      </section>
    </ProductPage>
  );
}
