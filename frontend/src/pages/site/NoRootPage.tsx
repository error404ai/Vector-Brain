import { Link } from 'react-router-dom';
import ProductPage, { type Faq } from '@/components/site/ProductPage';

const FAQ: Faq[] = [
  {
    q: 'Does FLEET need root access?',
    a: 'No. The Vector app uses Android’s accessibility service to read the screen and to tap, type and swipe, the same permission screen readers use. Nothing on the phone is rooted or modified.',
  },
  {
    q: 'Do I need ADB, USB debugging or a computer next to the phones?',
    a: 'No. Each phone connects to FLEET over its own Wi-Fi or mobile data. You pair it once with a code shown in the app; after that the phone can be anywhere with internet.',
  },
  {
    q: 'Which phones work?',
    a: 'Any brand on Android 10 or newer. Android 10 needs screen sharing turned on for screenshots, and Android turns that off after every restart; Android 11 and newer do not need it.',
  },
  {
    q: 'What can it not do without root?',
    a: 'It cannot install apps silently, unlock a secure lock screen or change system settings Android reserves for system apps. Play Store apps are installed by opening the listing and tapping Install, like a person would.',
  },
];

export default function NoRootPage() {
  return (
    <ProductPage
      path="/android-automation-without-root"
      h1="Android automation without root or ADB"
      lede={
        <p>
          Install one app, turn on its accessibility permission and pair the phone with a code. From then on you can tell the phone
          what to do in plain words, from a browser, wherever the phone is. No rooting, no USB cable, no developer options.
        </p>
      }
      spec={[
        ['Root', 'Not needed'],
        ['ADB / USB', 'Not needed'],
        ['Android', '10 and newer'],
        ['Connection', 'Wi-Fi or mobile data'],
      ]}
      faq={FAQ}
      related={[
        { to: '/how-it-works', label: 'How FLEET reads the screen and checks each step' },
        { to: '/android-fleet-automation', label: 'Send one task to many phones' },
        { to: '/docs', label: 'Pairing a phone, step by step' },
      ]}
    >
      <section aria-labelledby="how">
        <h2 id="how">How it works without root</h2>
        <p>
          Android lets an app with the accessibility permission read what is on screen — buttons, text fields, labels — and perform
          gestures for the user. The Vector app uses exactly that: it sends the screen’s element list to FLEET, an AI model decides the
          next action, and the app performs it and reads the screen again to check it worked.
        </p>
        <ul>
          <li>Taps, typing, swipes, scrolling, Back, Home and Recents.</li>
          <li>Opening apps, links, Play Store listings and settings pages directly, without tapping through menus.</li>
          <li>Screenshots when the element list is not enough, such as unlabelled icons and some web pages.</li>
        </ul>
      </section>

      <section aria-labelledby="setup">
        <h2 id="setup">What setting up a phone takes</h2>
        <ol>
          <li>Copy the Vector APK to the phone and install it; Android asks once to allow installs from that source.</li>
          <li>Turn on <strong>Use Vector</strong> under Accessibility. On Android 13 and newer, Android first asks you to allow restricted settings for apps installed from a file.</li>
          <li>Enter the pairing code shown on the phone in your FLEET account.</li>
          <li>Add the API key of the AI model you want to use.</li>
        </ol>
        <p>
          The <Link to="/docs">docs</Link> walk through each screen, including brand-specific steps for Xiaomi and Samsung.
        </p>
      </section>

      <section aria-labelledby="vs">
        <h2 id="vs">Compared with ADB-based tools</h2>
        <p>
          ADB tools such as scrcpy or Appium’s Android driver are excellent when the phone sits on a desk next to a computer. They need
          USB debugging, and usually a cable or the same local network. FLEET is built for phones that are spread out, on their own
          networks, and need to be told what to do rather than scripted. If you need scripted, deterministic tests in CI, see{' '}
          <Link to="/compare/appium">FLEET vs Appium</Link>.
        </p>
      </section>
    </ProductPage>
  );
}
