import { Link } from 'react-router-dom';
import ProductPage, { type Faq } from '@/components/site/ProductPage';

const FAQ: Faq[] = [
  {
    q: 'Does FLEET provide proxies?',
    a: 'No. You bring your own proxy provider and set the proxy in each phone’s own proxy app. FLEET groups phones that share a proxy into a lane, rotates the IP through your provider’s link when you ask it to, and shows what each phone’s network actually looks like.',
  },
  {
    q: 'How do I know a phone really appears to be in the right country?',
    a: 'Each phone reports its public IP and that IP’s country, the IP it would use without the proxy, its WebRTC IP, DNS, timezone, language and SIM country. FLEET flags a proxy that is not being used and settings that point to a different country than the IP.',
  },
  {
    q: 'Can I compare the same page across countries in one go?',
    a: 'Yes. Tag phones by country, for example #uk and #us, and send the same task to each tag. Every phone returns its final screenshot and what it read from the page, side by side in one mission.',
  },
];

export default function GeoTestingPage() {
  return (
    <ProductPage
      path="/use-cases/geo-testing"
      h1="See your app or site the way other countries see it"
      lede={
        <p>
          Prices, language, store availability, consent banners and ads change with the visitor’s country. Put real Android phones
          behind proxies in the countries you care about and ask each one, in plain words, what it sees.
        </p>
      }
      spec={[
        ['Devices', 'Real Android phones'],
        ['Network', 'Your own proxies'],
        ['Per phone', 'IP, country, locale'],
        ['Result', 'Final screen + answer'],
      ]}
      faq={FAQ}
      related={[
        { to: '/phone-farm-automation', label: 'Phone farm automation', note: 'lanes, rotation and network checks' },
        { to: '/use-cases/mobile-app-testing', label: 'AI app testing on real Android phones' },
        { to: '/docs', label: 'Network info: what each phone reports' },
      ]}
    >
      <section aria-labelledby="checks">
        <h2 id="checks">Checks people run</h2>
        <ul>
          <li>Is the app listed in the Play Store in this country, and at what price?</li>
          <li>Which language and currency does the checkout page show?</li>
          <li>Does the cookie or consent banner appear, and what does it say?</li>
          <li>Does a deep link open the right local page?</li>
        </ul>
        <p>
          Each phone answers in one line, and the mission’s answer card lists every phone’s value — a phone that failed shows
          “No answer”, never a guessed one.
        </p>
      </section>

      <section aria-labelledby="trust">
        <h2 id="trust">Trust the location before you trust the result</h2>
        <p>
          A geo check is only as good as the network under it. Before and after a mission, every phone reports its network, and FLEET
          flags the problems that quietly spoil results:
        </p>
        <ul>
          <li>A proxy is set but the public IP equals the direct IP — the proxy is not being used.</li>
          <li>The WebRTC IP differs from the public IP, so a site can see the real one.</li>
          <li>The phone’s timezone, language or region points to another country than its IP.</li>
          <li>The clock is off by more than a minute.</li>
        </ul>
      </section>

      <section aria-labelledby="use">
        <h2 id="use">Use it for checks, not for disguise</h2>
        <p>
          FLEET is for legitimate tasks on your own phones and accounts. It does not create accounts in bulk, build fake identities or
          help get around a service’s rules. See the acceptable-use section in the <Link to="/docs">docs</Link>.
        </p>
      </section>
    </ProductPage>
  );
}
