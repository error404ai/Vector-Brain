import { Link } from 'react-router-dom';
import ProductPage, { type Faq } from '@/components/site/ProductPage';

const ROWS: [string, string, string][] = [
  ['Whose phones', 'The provider’s devices, rented by the minute or by plan', 'Your own Android phones, wherever they are'],
  ['Accounts and data', 'Devices are wiped between sessions', 'Phones keep their apps, accounts and settings between runs'],
  ['Device range', 'Large catalogues of models, Android and iOS', 'The Android 10+ phones you own'],
  ['Network', 'The provider’s data-centre network, sometimes with location options', 'Each phone’s own Wi-Fi, mobile data or proxy'],
  ['How you drive them', 'Test frameworks, scripts and manual remote sessions', 'Plain-language tasks run by an AI agent'],
  ['CI integration', 'Usually built in', 'No public API or CI integration yet'],
  ['Cost model', 'Subscription or per-minute device time', 'Free to use; you pay your AI provider for model calls and own the hardware'],
];

const FAQ: Faq[] = [
  {
    q: 'When is a cloud device farm the better choice?',
    a: 'When you need many models you do not own, iOS devices, clean devices for every test, or a test framework wired into CI. Services such as Firebase Test Lab, AWS Device Farm and BrowserStack are built for that.',
  },
  {
    q: 'When are your own phones the better choice?',
    a: 'When the work needs phones that stay signed in, keep their data, sit on specific networks or run for hours every day — and when describing a task in words is faster than scripting it.',
  },
  {
    q: 'Can I use both?',
    a: 'Yes. Many teams test release builds on a cloud farm and use their own phones for long-running or account-based work.',
  },
];

export default function CompareDeviceFarmsPage() {
  return (
    <ProductPage
      path="/compare/cloud-device-farms"
      h1="Your own phones vs a cloud device farm"
      lede={
        <p>
          Cloud device farms rent you clean devices for testing. FLEET runs plain-language tasks on phones you own and keep. They
          answer different needs; this page sets out which fits which job.
        </p>
      }
      faq={FAQ}
      related={[
        { to: '/compare/appium', label: 'FLEET vs Appium', note: 'AI tasks vs test scripts' },
        { to: '/phone-farm-automation', label: 'Run your own phone farm' },
        { to: '/android-automation-without-root', label: 'Android automation without root or ADB' },
      ]}
    >
      <section aria-labelledby="table">
        <h2 id="table">Side by side</h2>
        <div className="st-table" role="region" tabIndex={0} aria-labelledby="table">
          <table>
            <thead>
              <tr>
                <th scope="col"> </th>
                <th scope="col">Cloud device farm</th>
                <th scope="col">FLEET on your phones</th>
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

      <section aria-labelledby="own">
        <h2 id="own">What owning the phones gives you</h2>
        <ul>
          <li>Phones that stay signed in to your accounts between runs.</li>
          <li>Tasks that run for hours — a mission can keep phones working for up to 12 hours.</li>
          <li>Control over each phone’s network, including your own proxies grouped into lanes.</li>
          <li>A live screen and step log for every phone, in one dashboard.</li>
        </ul>
      </section>

      <section aria-labelledby="costs">
        <h2 id="costs">What it costs you instead</h2>
        <ul>
          <li>Buying, charging and looking after the phones.</li>
          <li>Only Android, and only the models you have.</li>
          <li>AI model costs per run, paid to your own AI provider. Saved <Link to="/docs">flows</Link> can replay a task without model calls.</li>
        </ul>
      </section>
    </ProductPage>
  );
}
