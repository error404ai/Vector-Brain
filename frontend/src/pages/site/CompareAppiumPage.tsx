import ProductPage, { type Faq } from '@/components/site/ProductPage';

const ROWS: [string, string, string][] = [
  ['How you describe a task', 'Code against the WebDriver API, with locators for each element', 'A sentence in plain words'],
  ['When the screen changes', 'Locators can break and need updating', 'The AI reads the current screen each step; a moved button is usually still found'],
  ['Platforms', 'Android, iOS and more', 'Android 10 and newer only'],
  ['Connecting devices', 'An Appium server plus drivers; Android devices over ADB, or a cloud device farm', 'The Vector app on each phone, over Wi-Fi or mobile data; no ADB'],
  ['Determinism', 'Same script, same steps, explicit assertions', 'The AI chooses steps live, reading the screen after each one; two runs can take different steps'],
  ['CI / API', 'Mature, used in CI pipelines', 'No public API or CI integration yet'],
  ['Many devices', 'Parallel sessions you set up and manage', 'One instruction to up to 50 phones per mission, live screens in one dashboard'],
  ['Cost', 'Open source', 'Free to use; you pay your AI provider for model calls'],
];

const FAQ: Faq[] = [
  {
    q: 'Is FLEET a replacement for Appium?',
    a: 'For some work. FLEET suits tasks you can describe in words and want run on many real phones without writing code. Appium remains the better fit for deterministic test suites in CI and for iOS.',
  },
  {
    q: 'Can I use both?',
    a: 'Yes. They do not conflict: Appium for scripted regression suites in CI, FLEET for exploratory checks, fleet-wide routines and tasks that change too often to script.',
  },
];

export default function CompareAppiumPage() {
  return (
    <ProductPage
      path="/compare/appium"
      h1="FLEET vs Appium"
      lede={
        <p>
          Appium is the open-source standard for scripted mobile automation. FLEET is an AI agent that does tasks on real Android
          phones from a plain-language instruction. They solve different problems; here is where each one fits.
        </p>
      }
      faq={FAQ}
      related={[
        { to: '/use-cases/mobile-app-testing', label: 'AI app testing on real Android phones' },
        { to: '/how-it-works', label: 'How FLEET works' },
      ]}
    >
      <section aria-labelledby="table">
        <h2 id="table">Side by side</h2>
        <div className="st-table" role="region" tabIndex={0} aria-labelledby="table">
          <table>
            <thead>
              <tr>
                <th scope="col"> </th>
                <th scope="col">Appium</th>
                <th scope="col">FLEET</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([k, a, f]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>{a}</td>
                  <td>{f}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="appium">
        <h2 id="appium">Choose Appium when</h2>
        <ul>
          <li>You need the same steps and assertions on every run, inside a CI pipeline.</li>
          <li>You test on iOS as well as Android.</li>
          <li>Your team writes and maintains test code already.</li>
        </ul>
      </section>

      <section aria-labelledby="fleet">
        <h2 id="fleet">Choose FLEET when</h2>
        <ul>
          <li>You want to describe a task in words rather than write and maintain code.</li>
          <li>The task must run on many real Android phones at once, with every screen visible live.</li>
          <li>The app changes often enough that keeping locators up to date costs more than the task is worth.</li>
          <li>The phones are spread out and cannot all be connected to a computer over ADB.</li>
        </ul>
      </section>
    </ProductPage>
  );
}
