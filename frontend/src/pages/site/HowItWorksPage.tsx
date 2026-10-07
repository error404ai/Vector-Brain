import { Link } from 'react-router-dom';
import ProductPage, { type Faq } from '@/components/site/ProductPage';

const FAQ: Faq[] = [
  {
    q: 'How does FLEET control an Android phone?',
    a: 'Through the Vector app on the phone. It uses Android’s accessibility service to read what is on screen and to tap, type, swipe and scroll, the way a person would. An AI model decides each step from what the phone reports.',
  },
  {
    q: 'Does it need root, ADB or a USB cable?',
    a: 'No. The phone connects to FLEET over Wi-Fi or mobile data. There is no ADB, no USB debugging, no cable and no computer next to the phones.',
  },
  {
    q: 'Does it work on real Android devices or emulators?',
    a: 'It is built for real phones on Android 10 or newer, from any brand. An emulator that runs Android 10 or newer and the Vector app connects the same way.',
  },
  {
    q: 'What happens when automation gets stuck?',
    a: 'The run stops itself instead of tapping forever. If the screen stops changing, the same action repeats on an unchanged screen, or the phone or the AI provider goes silent, the run ends with a plain reason and the final screenshot.',
  },
  {
    q: 'Which AI models can I use?',
    a: 'Your own key from OpenAI, Anthropic, Google Gemini, DeepSeek, Groq or OpenRouter, or any OpenAI-compatible API at a public address. A backup model can take over when the main one is rate-limited.',
  },
  {
    q: 'Is FLEET free?',
    a: 'Yes, FLEET is free to use. You pay your AI provider directly for the model calls your runs make.',
  },
];

export default function HowItWorksPage() {
  return (
    <ProductPage
      path="/how-it-works"
      h1="How FLEET runs tasks on real phones"
      lede={
        <p>
          FLEET is an AI Android automation platform. You write a task in plain words, an AI model works out each step from what
          the phone’s screen shows, and the Vector app on the phone carries the step out. After every action FLEET reads the
          screen again, so the next step is based on what actually happened.
        </p>
      }
      spec={[
        ['Phones', 'Android 10+'],
        ['Setup', 'No root, ADB or USB'],
        ['After each action', 'Screen re-read'],
        ['Fleet size', 'Up to 1,000'],
      ]}
      faq={FAQ}
      related={[
        { to: '/android-fleet-automation', label: 'Android fleet automation', note: 'one instruction, many phones' },
        { to: '/compare/appium', label: 'FLEET vs Appium', note: 'plain language vs test scripts' },
        { to: '/docs', label: 'Documentation', note: 'setup, missions and troubleshooting' },
      ]}
    >
      <section aria-labelledby="parts">
        <h2 id="parts">Three parts</h2>
        <h3>The Vector app, on each phone</h3>
        <p>
          A small companion app that you install and pair with a 6-character code. It runs Android’s accessibility service, which
          gives it the screen’s element list (buttons, fields and text, with their positions) and lets it tap, type, swipe,
          scroll, go back and open apps or links. It also takes screenshots: through accessibility on Android 11 and newer, and
          through screen sharing on Android 10.
        </p>
        <h3>FLEET, in your browser</h3>
        <p>
          The dashboard where you send tasks, watch every phone’s screen live and read the results. Phones stay connected to it
          over the internet, so they can be anywhere with Wi-Fi or mobile data.
        </p>
        <h3>Your AI model</h3>
        <p>
          You add your own API key. The model receives the task, the screen’s element list and, when useful, a screenshot, and
          it chooses the next action. Keys are stored encrypted.
        </p>
      </section>

      <section aria-labelledby="loop">
        <h2 id="loop">One run, step by step</h2>
        <ol className="st-steps">
          <li>
            <strong>Read the screen.</strong> The phone sends its element list. A screenshot is added when the list cannot
            describe the screen, when the AI is stuck, or on every step if you choose.
          </li>
          <li>
            <strong>Choose an action.</strong> The model picks one: tap an element, type into a field, scroll a list, open an app
            or a link, go back.
          </li>
          <li>
            <strong>Do it on the phone.</strong> The Vector app performs the action through accessibility.
          </li>
          <li>
            <strong>Check what changed.</strong> The screen is read again. If nothing changed, the model is told so instead of
            tapping the same spot again.
          </li>
          <li>
            <strong>Finish with a result.</strong> The model reports the task done, or not done and why, and FLEET saves the
            final screenshot and every step with the result.
          </li>
        </ol>
      </section>

      <section aria-labelledby="recovery">
        <h2 id="recovery">When things go wrong</h2>
        <ul>
          <li>
            <strong>Common pop-ups</strong> such as permission requests, “rate this app”, update prompts and network-retry
            dialogs are cleared automatically before the AI spends a step on them.
          </li>
          <li>
            <strong>Stuck runs stop themselves.</strong> A screen that stops changing, a loop of the same action, or minutes with
            no response from the phone or the AI provider ends the run with a reason.
          </li>
          <li>
            <strong>Temporary failures are retried.</strong> A phone that went offline, a rate-limited provider or a server
            restart gets up to three tries per phone; a busy phone waits its turn.
          </li>
          <li>
            <strong>Text-only models still see the screen.</strong> A separate vision model can read screenshots for a model that
            cannot, so it taps listed items instead of guessing.
          </li>
        </ul>
      </section>

      <section aria-labelledby="limits">
        <h2 id="limits">What it does not do</h2>
        <ul>
          <li>It does not unlock a PIN, pattern, password or fingerprint lock screen.</li>
          <li>It does not install apps silently. Play Store apps are installed by opening the listing and tapping Install.</li>
          <li>It does not solve CAPTCHAs; human-only steps are for you to do on the phone.</li>
          <li>
            It is not perfect. Apps change and runs can fail; when one does, you get the reason, the final screenshot and the
            step-by-step log. See <Link to="/docs">the docs</Link> for troubleshooting.
          </li>
        </ul>
      </section>
    </ProductPage>
  );
}
