import { Link } from 'react-router-dom';
import ProductPage from '@/components/site/ProductPage';
import { SITE } from '@/seo/site';

const UPDATED = '7 October 2026';
const Mail = () => <a href={`mailto:${SITE.email}`}>{SITE.email}</a>;

export function ContactPage() {
  return (
    <ProductPage
      path="/contact"
      h1="Contact"
      cta={false}
      lede={
        <p>
          FLEET is made by {SITE.org}. For questions, bugs, account help, or a request to export or delete your data, email{' '}
          <Mail />.
        </p>
      }
      related={[
        { to: '/docs', label: 'Documentation', note: 'most setup questions are answered here' },
        { to: '/privacy', label: 'Privacy policy' },
        { to: '/terms', label: 'Terms of service' },
      ]}
    >
      <section aria-labelledby="help">
        <h2 id="help">Before you write</h2>
        <ul>
          <li>
            Phone offline, “Service needed” or a run that failed: the <Link to="/docs#troubleshooting">troubleshooting guide</Link>{' '}
            covers the common causes.
          </li>
          <li>For a failed run, include the run’s reason and the phone’s model; it makes the answer much faster.</li>
        </ul>
      </section>
    </ProductPage>
  );
}

export function PrivacyPage() {
  return (
    <ProductPage
      path="/privacy"
      h1="Privacy policy"
      cta={false}
      lede={
        <p>
          Last updated {UPDATED}. This policy explains what {SITE.fullName}, run by {SITE.org} (“we”), collects when you use the
          website at app.vectoragent.in and the Vector app on your phones, and what happens to it. Questions: <Mail />.
        </p>
      }
    >
      <section aria-labelledby="account">
        <h2 id="account">Your account</h2>
        <ul>
          <li>Name, email address and a password, stored only as a salted hash; or, if you sign in with Google, your Google account ID, email, name and profile picture URL.</li>
          <li>One sign-in cookie (<code>RefreshToken</code>, HTTP-only, 30 days) that keeps you signed in. We set no advertising or analytics cookies.</li>
          <li>For each sign-in session, the browser’s user agent and IP address, kept for security.</li>
          <li>Your settings, such as your AI model choices and screenshot preference.</li>
        </ul>
      </section>

      <section aria-labelledby="keys">
        <h2 id="keys">Your AI provider keys</h2>
        <p>
          API keys you add are stored encrypted (AES-256-GCM) and are never shown back to the browser. They are used only to call
          the AI provider you chose, on your behalf, when you run a task or use the chat.
        </p>
      </section>

      <section aria-labelledby="phones">
        <h2 id="phones">Your phones</h2>
        <p>The Vector app sends us only what is needed to run your tasks and show you your fleet:</p>
        <ul>
          <li>
            <strong>Device details and status:</strong> manufacturer and model, Android version, an app-specific device ID,
            screen size, app version, and, every few seconds while paired, its battery level, connection status and which app
            is in front.
          </li>
          <li>
            <strong>Network details:</strong> the public IP address the phone connects from, its IP without the proxy, its WebRTC
            IP, local IP addresses, proxy setting, DNS, network type, languages, region, SIM and network country, timezone and
            clock. Countries are looked up from IP addresses on our own server. The app does not use GPS or location permission.
          </li>
          <li>
            <strong>During a task:</strong> what is on the screen (the element list and screenshots), the actions taken, text the
            AI typed, and anything a step reads back, such as notification text, the clipboard or the list of installed apps
            when the task asks for them. Email accounts signed in on a phone, when a task reads them, are kept with that phone
            until you clear them or unpair it.
          </li>
          <li><strong>Files</strong> you send to your phones from the dashboard.</li>
        </ul>
        <p>
          The phone’s screen is read through Android’s accessibility service while the Vector app is enabled: to carry out the
          tasks you send, and to show you the screen when you open a phone’s live view or ask for screenshots.
        </p>
      </section>

      <section aria-labelledby="ai">
        <h2 id="ai">What goes to your AI provider</h2>
        <p>
          To decide each step, the task, the screen’s element list, step results and, depending on your screenshot setting,
          screenshots are sent to the AI provider whose key you added (for example OpenAI, Anthropic, Google, DeepSeek, Groq or
          OpenRouter). Their handling of that data is governed by your agreement with them.
        </p>
      </section>

      <section aria-labelledby="others">
        <h2 id="others">Other services</h2>
        <ul>
          <li><strong>Google</strong>: its sign-in script loads on the sign-in and sign-up pages, and verifies your sign-in if you use it.</li>
          <li><strong>Google Play</strong>, to look up an app’s package name when a task installs an app.</li>
          <li><strong>Telegram</strong>, only if you link a Telegram chat, to send run updates and screenshots there.</li>
          <li><strong>STUN servers</strong> run by Google and Cloudflare, which the phone contacts to measure its WebRTC IP.</li>
          <li>The dashboard checks your internet connection by loading small icons from Google, Cloudflare, GitHub and Microsoft.</li>
          <li>We do not use third-party analytics or advertising trackers, and we do not sell your data.</li>
        </ul>
      </section>

      <section aria-labelledby="diag">
        <h2 id="diag">Error reports</h2>
        <p>
          When something goes wrong in the dashboard (an error, a crash, a hang or a failed request), your browser sends a
          technical report so we can fix it: the page, timings, memory, recent request paths and error messages, your user ID,
          browser and sign-in state — never request contents, screenshots or passwords. These are kept for about 30 days.
        </p>
      </section>

      <section aria-labelledby="retention">
        <h2 id="retention">How long we keep it</h2>
        <div className="st-table" role="region" tabIndex={0} aria-labelledby="retention">
          <table>
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Kept</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Task runs, their steps and screenshots</td><td>30 days, unless you save the run as a flow or share it</td></tr>
              <tr><td>Screenshots shown in the chat</td><td>7 days</td></tr>
              <tr><td>Files sent to phones</td><td>7 days</td></tr>
              <tr><td>Error reports</td><td>About 30 days</td></tr>
              <tr><td>Account, settings, chat conversations, missions, phones and their network details</td><td>Until you delete them or close your account</td></tr>
            </tbody>
          </table>
        </div>
        <p>You can delete runs, conversations and phones from the dashboard at any time.</p>
      </section>

      <section aria-labelledby="rights">
        <h2 id="rights">Your choices</h2>
        <ul>
          <li>
            Unpair a phone, or uninstall the Vector app, to stop it sending anything. Turning off its accessibility service stops
            tasks and screen reading, but the app still reports its status while paired.
          </li>
          <li>Set screenshots to Off to keep screenshots out of most AI calls.</li>
          <li>
            Email <Mail /> to get a copy of your data or to close your account and delete it. We will confirm the request comes
            from the account’s email address before acting on it.
          </li>
        </ul>
      </section>

      <section aria-labelledby="security">
        <h2 id="security">Security</h2>
        <p>
          Connections use HTTPS. Passwords are hashed, AI keys are encrypted, and sign-in tokens are short-lived. No system is
          perfectly secure; tell us at <Mail /> if you find a problem.
        </p>
      </section>

      <section aria-labelledby="changes">
        <h2 id="changes">Changes</h2>
        <p>We will update this page when what we collect changes, and change the date at the top.</p>
      </section>
    </ProductPage>
  );
}

export function TermsPage() {
  return (
    <ProductPage
      path="/terms"
      h1="Terms of service"
      cta={false}
      lede={
        <p>
          Last updated {UPDATED}. These terms apply to {SITE.fullName}, provided by {SITE.org} (“we”). By creating an account or
          using the service you agree to them. Questions: <Mail />.
        </p>
      }
    >
      <section aria-labelledby="service">
        <h2 id="service">The service</h2>
        <p>
          FLEET lets you run tasks on Android phones you control, using an AI model you choose, through the Vector app and the
          dashboard. FLEET is currently free to use. We may change, add or remove features, and we will give notice on this
          site before introducing paid plans.
        </p>
      </section>

      <section aria-labelledby="you">
        <h2 id="you">Your responsibilities</h2>
        <ul>
          <li>Use FLEET only on phones you own or are authorised to control, and with accounts you own or are authorised to use.</li>
          <li>Keep your sign-in details and your AI provider keys secure. You are responsible for the AI provider costs your runs create.</li>
          <li>Follow the terms of the apps and websites your tasks use. FLEET acts on your instructions; what it does on your phones is your responsibility.</li>
          <li>Check important results yourself. AI-driven runs can make mistakes.</li>
        </ul>
      </section>

      <section aria-labelledby="aup">
        <h2 id="aup">Acceptable use</h2>
        <p>You may not use FLEET to:</p>
        <ul>
          <li>create accounts in bulk, or fan account creation out across phones or proxies;</li>
          <li>create fabricated identities or fake account history;</li>
          <li>produce fake engagement, reviews, ratings or followers;</li>
          <li>solve or bypass CAPTCHAs or other security protections;</li>
          <li>access accounts, phones or data you are not authorised to access, or commit fraud or any other unlawful act.</li>
        </ul>
        <p>We may suspend or close accounts that break these rules.</p>
      </section>

      <section aria-labelledby="data">
        <h2 id="data">Your data</h2>
        <p>
          You keep the rights to your data. We use it only to provide the service, as described in the{' '}
          <Link to="/privacy">privacy policy</Link>.
        </p>
      </section>

      <section aria-labelledby="warranty">
        <h2 id="warranty">No warranty, limited liability</h2>
        <p>
          FLEET is provided “as is”, without warranties of any kind. Runs can fail, apps can change, and the service can be
          interrupted. To the extent the law allows, we are not liable for indirect or consequential losses, lost data, lost
          accounts, or AI provider costs arising from your use of FLEET.
        </p>
      </section>

      <section aria-labelledby="end">
        <h2 id="end">Ending</h2>
        <p>
          You can stop using FLEET at any time and ask us to delete your account at <Mail />. We may update these terms; the date
          at the top shows the latest version, and continuing to use FLEET means you accept it.
        </p>
      </section>
    </ProductPage>
  );
}
