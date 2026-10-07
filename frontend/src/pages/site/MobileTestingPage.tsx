import { Link } from 'react-router-dom';
import ProductPage, { type Faq } from '@/components/site/ProductPage';

const FAQ: Faq[] = [
  {
    q: 'Do I need to write test scripts or selectors?',
    a: 'No. A check is a sentence describing what should happen. The AI reads the current screen, so a moved button does not break the check the way a stale selector would.',
  },
  {
    q: 'Can I run the same check on many phone models?',
    a: 'Yes. Send it to every phone you own, or to a tag such as #android13, and each phone reports its own result, final screenshot and step log.',
  },
  {
    q: 'Can a check be replayed without AI costs?',
    a: 'Yes. A finished run can be saved as a flow and replayed with no model calls. Flows replay screen positions, so they suit phones with the same screen size, and typed text is not replayed.',
  },
  {
    q: 'Does FLEET integrate with CI pipelines or test iOS?',
    a: 'Not today. FLEET has no public API for CI and runs only on Android. For CI-driven, deterministic suites and iOS, a framework such as Appium is the better fit.',
  },
];

export default function MobileTestingPage() {
  return (
    <ProductPage
      path="/use-cases/mobile-app-testing"
      h1="AI app testing on real Android phones"
      lede={
        <p>
          Describe a check in plain words and run it on every Android phone you own, across brands, models and Android versions.
          Each phone comes back with a result, the screen it ended on and every step it took.
        </p>
      }
      spec={[
        ['Test steps', 'Plain language'],
        ['Devices', 'Real phones, Android 10+'],
        ['Per phone', 'Result + final screen'],
        ['Replays', 'No AI cost'],
      ]}
      faq={FAQ}
      related={[
        { to: '/compare/appium', label: 'FLEET vs Appium', note: 'when to use which' },
        { to: '/android-fleet-automation', label: 'Run on many phones at once' },
        { to: '/how-it-works', label: 'How a run is checked step by step' },
      ]}
    >
      <section aria-labelledby="what">
        <h2 id="what">What you can check</h2>
        <ul>
          <li>Sign-in, onboarding and first-launch permissions on a fresh install.</li>
          <li>That a new build installs and opens on every model.</li>
          <li>A settings screen or a key flow, read back from every phone.</li>
          <li>Anything a person could check by looking at the screen and tapping through the app.</li>
        </ul>
      </section>

      <section aria-labelledby="results">
        <h2 id="results">Results you can trust</h2>
        <ul>
          <li>After every action the screen is read again; a tap that changed nothing is caught, not assumed.</li>
          <li>Each phone keeps its final screenshot and full step log, so a failure shows exactly where it stopped.</li>
          <li>Runs that get stuck end with a plain reason instead of hanging.</li>
          <li>The answer card summarises what every phone reported, with failed phones marked as failed — never given a made-up value.</li>
        </ul>
      </section>

      <section aria-labelledby="limits">
        <h2 id="limits">Where it is not the right tool</h2>
        <p>
          AI-driven checks are flexible but not deterministic assertions, FLEET has no CI integration yet, and it does not run on
          iOS. If you need those, read <Link to="/compare/appium">FLEET vs Appium</Link>.
        </p>
      </section>
    </ProductPage>
  );
}
