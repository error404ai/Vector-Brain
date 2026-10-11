import { Link } from 'react-router-dom';
import ProductPage, { type Faq } from '@/components/site/ProductPage';

const FAQ: Faq[] = [
  {
    q: 'Can FLEET install apps without a Google account on the phone?',
    a: 'Not from the Play Store. Google Play needs a signed-in Google account before it shows an Install button. Phones without one report that clearly instead of failing silently; sign in once on the phone, then run the install again.',
  },
  {
    q: 'Can it install paid apps or apps that need payment approval?',
    a: 'No. Paid apps, payment screens and sign-ins are left to you. FLEET installs free apps from their store listing.',
  },
  {
    q: 'How do I know an install really worked?',
    a: 'After tapping Install, FLEET waits for the download and then checks that the app is actually in the phone’s list of installed apps. A phone where it is missing is reported as failed, with its final screenshot.',
  },
  {
    q: 'Can I install my own APK file?',
    a: 'You can send an APK to many phones at once; it lands in Downloads/VectorAutomation on each phone. Android asks a person to confirm installing a file, so that last tap is yours.',
  },
];

export default function InstallAppsPage() {
  return (
    <ProductPage
      path="/use-cases/install-apps-on-many-phones"
      h1="Install an app on many Android phones at once"
      lede={
        <p>
          Type <em>“install WhatsApp from the Play Store on all phones”</em> and every phone opens the store listing, taps Install and
          waits for it to finish. Each phone then reports whether the app is really installed.
        </p>
      }
      spec={[
        ['Per mission', 'Up to 50 phones'],
        ['Source', 'Play Store listing'],
        ['Checked', 'Installed app list'],
        ['Per phone', 'Result + final screen'],
      ]}
      faq={FAQ}
      related={[
        { to: '/android-fleet-automation', label: 'Android fleet automation', note: 'tags, lanes and retries' },
        { to: '/use-cases/mobile-app-testing', label: 'Check that a new build opens on every model' },
        { to: '/docs', label: 'Sending files and app updates to phones' },
      ]}
    >
      <section aria-labelledby="how">
        <h2 id="how">How an install runs</h2>
        <ol>
          <li>The phone opens the app’s Play Store listing directly, instead of searching and scrolling.</li>
          <li>It taps Install and handles the usual prompts, such as Play’s “Complete account setup” sheet.</li>
          <li>It waits for the download to finish rather than polling the AI every few seconds.</li>
          <li>It checks the phone’s installed apps for the package. Only then is the phone marked done.</li>
        </ol>
      </section>

      <section aria-labelledby="target">
        <h2 id="target">Choose which phones</h2>
        <ul>
          <li><strong>all phones</strong>, a single <strong>@phone</strong>, or <strong>on 3 phones</strong>.</li>
          <li>A <strong>#tag</strong>, such as <code>#android13</code> or <code>#uk</code>, for every ready phone with that tag.</li>
          <li>Phones that are offline are waited for up to 10 minutes; busy phones wait their turn.</li>
        </ul>
        <p>
          Missions on more than 5 phones wait for your confirmation first, with a step and cost estimate.
        </p>
      </section>

      <section aria-labelledby="limits">
        <h2 id="limits">Limits</h2>
        <ul>
          <li>Each phone needs a Google account signed in to the Play Store.</li>
          <li>No silent installs: Android does not allow a normal app to install other apps without the store or a person confirming.</li>
          <li>Phones with too little storage, or apps not available in the phone’s country, are reported as failed with the reason shown on screen.</li>
        </ul>
        <p>
          See <Link to="/android-automation-without-root">how FLEET works without root</Link> for why these limits exist.
        </p>
      </section>
    </ProductPage>
  );
}
