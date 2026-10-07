import { Link } from 'react-router-dom';
import ProductPage, { type Faq } from '@/components/site/ProductPage';

const FAQ: Faq[] = [
  {
    q: 'What is phone farm automation?',
    a: 'Running many real Android phones as one system: setting them up, keeping them online, checking their network, and sending them tasks from one place instead of handling each phone by hand.',
  },
  {
    q: 'Do I need ADB, a USB hub or a computer for each rack?',
    a: 'No. Each phone pairs with a code in the Vector app and connects over Wi-Fi or mobile data. There is no ADB, no USB debugging and no PC.',
  },
  {
    q: 'Which phones can I use?',
    a: 'Any Android phone on Android 10 or newer, from any brand. The setup checklist in the app shows the exact settings for Xiaomi, Samsung, OPPO, Vivo, Huawei and stock Android.',
  },
  {
    q: 'How do proxies work with FLEET?',
    a: 'You set the proxy in each phone’s own proxy app once. In FLEET you group those phones into a lane, choose how many run at once, and FLEET calls your provider’s rotation link to change the IP after a set number of tasks.',
  },
  {
    q: 'How many phones can one dashboard run?',
    a: 'Up to 1,000 phones in one fleet, with up to 50 phones in a single mission.',
  },
];

export default function PhoneFarmPage() {
  return (
    <ProductPage
      path="/phone-farm-automation"
      h1="Phone farm automation, without the cables"
      lede={
        <p>
          Run your own farm of real Android phones from one dashboard. Pair each phone with a code, keep every one online and
          checked, and send tasks in plain words to one phone or the whole farm. No ADB, no USB hubs, no scripts.
        </p>
      }
      spec={[
        ['Phones', 'Up to 1,000'],
        ['Connection', 'Wi-Fi or mobile data'],
        ['Network check', 'Every 15 min'],
        ['Cables', 'None'],
      ]}
      faq={FAQ}
      related={[
        { to: '/android-fleet-automation', label: 'Android fleet automation', note: 'missions across many phones' },
        { to: '/how-it-works', label: 'How FLEET works' },
        { to: '/docs', label: 'Setup guide and troubleshooting' },
      ]}
    >
      <section aria-labelledby="setup">
        <h2 id="setup">Set up a phone in minutes</h2>
        <ol className="st-steps">
          <li>Install the Vector app and enter the 6-character pairing code from the dashboard.</li>
          <li>Follow the checklist: screen control (accessibility), unrestricted battery, and autostart on phones that have it.</li>
          <li>The phone shows as Ready in the dashboard and can take tasks.</li>
        </ol>
      </section>

      <section aria-labelledby="health">
        <h2 id="health">See every phone’s state</h2>
        <ul>
          <li>
            Each phone shows <strong>Ready</strong>, <strong>Running</strong>, <strong>Waiting</strong>,{' '}
            <strong>Service needed</strong> (accessibility switched off) or <strong>Offline</strong>.
          </li>
          <li>Phones reconnect by themselves and start a fresh connection after two minutes offline.</li>
          <li>The app warns on the phone when a required setting is switched off.</li>
          <li>Send a new build of the Vector app to the whole farm as a file; each phone installs the update and reports its progress.</li>
        </ul>
      </section>

      <section aria-labelledby="network">
        <h2 id="network">Check every phone’s network</h2>
        <p>
          Each phone reports its public IP, its IP without the proxy, its WebRTC IP, DNS, language, region, SIM country, timezone
          and clock: on connect, every 15 minutes, after its proxy rotates and when you refresh. FLEET flags a proxy that is not
          being used, a timezone or language that does not match the IP, a WebRTC leak, a wrong clock, and phones that differ
          from the rest of their lane.
        </p>
      </section>

      <section aria-labelledby="lanes">
        <h2 id="lanes">Proxy lanes and IP rotation</h2>
        <p>
          Group phones that share a proxy into a lane, choose how many may run at once, and have FLEET call your provider’s
          rotation link after every task or every few tasks. Each rotation is followed by a fresh network reading, so you can see
          the new IP.
        </p>
      </section>

      <section aria-labelledby="tasks">
        <h2 id="tasks">Tasks in plain words</h2>
        <p>
          Write what each phone should do and send it to one phone, a tag or the whole farm. See{' '}
          <Link to="/android-fleet-automation">Android fleet automation</Link> for how missions, retries and live screens work.
        </p>
        <p>
          FLEET is for your own phones and your own accounts. It is not built for, and may not be used for, fake engagement or
          reviews, bulk account creation or getting around other services’ protections. See the <Link to="/terms">terms</Link>.
        </p>
      </section>
    </ProductPage>
  );
}
