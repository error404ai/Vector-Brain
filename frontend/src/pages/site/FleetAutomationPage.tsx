import { Link } from 'react-router-dom';
import ProductPage, { type Faq } from '@/components/site/ProductPage';

const FAQ: Faq[] = [
  {
    q: 'Can I control multiple Android phones at the same time?',
    a: 'Yes. One instruction in Mission Control can start the same task on up to 50 phones at once, and a fleet can hold up to 1,000 phones. Each phone reports its own result and final screenshot.',
  },
  {
    q: 'Do the phones need to be in one place or plugged into a computer?',
    a: 'No. Each phone runs the Vector app and connects over Wi-Fi or mobile data, so phones can be anywhere. There is no ADB, USB hub or PC involved.',
  },
  {
    q: 'Can different phones run different tasks?',
    a: 'Yes. Each mission targets the phones you name, tag or count, so separate groups can run separate tasks at the same time.',
  },
  {
    q: 'What happens if a phone goes offline during a run?',
    a: 'FLEET waits up to 10 minutes for it to reconnect (60 seconds in an “any N phones” mission, where another ready phone can take its place). Each phone gets up to three tries for temporary problems before it is marked failed with a reason.',
  },
  {
    q: 'Can I stop or pause everything at once?',
    a: 'Yes. Pause keeps each phone’s progress and Resume continues from where it stopped; Stop cancels the mission on every phone.',
  },
];

export default function FleetAutomationPage() {
  return (
    <ProductPage
      path="/android-fleet-automation"
      h1="Android fleet automation with AI"
      lede={
        <p>
          Send one plain-language instruction to dozens of real Android phones and watch each one do it. FLEET picks the phones by
          name, tag or count, runs the task on all of them, retries the ones that hit a temporary problem, and gives you a result
          for every phone.
        </p>
      }
      spec={[
        ['Phones per fleet', 'Up to 1,000'],
        ['Phones per mission', 'Up to 50'],
        ['Timed runs', 'Up to 12 h'],
        ['Tries per phone', '3'],
      ]}
      faq={FAQ}
      related={[
        { to: '/how-it-works', label: 'How FLEET works', note: 'the app, the AI and the checks' },
        { to: '/phone-farm-automation', label: 'Phone farm automation', note: 'running your own farm day to day' },
        { to: '/docs', label: 'Mission Control docs' },
      ]}
    >
      <section aria-labelledby="one">
        <h2 id="one">One instruction, every phone</h2>
        <p>Mission Control is a chat. Write the task the way you would say it, and name the phones:</p>
        <ul>
          <li>
            <strong>@name</strong> for one phone, <strong>#tag</strong> for every ready phone with that tag,{' '}
            <strong>all phones</strong>, or <strong>any 3 phones</strong>.
          </li>
          <li>
            Add a duration for ongoing work, such as <em>for 30 minutes</em>; each phone keeps going for that long, up to 12
            hours.
          </li>
          <li>Big runs (more than 5 phones, or 10 minutes or longer) wait for your confirmation, with a rough step estimate.</li>
        </ul>
      </section>

      <section aria-labelledby="watch">
        <h2 id="watch">Watch it, steer it</h2>
        <ul>
          <li>Every running phone streams its screen, with a step-by-step feed of what it is doing.</li>
          <li>Pause keeps progress; Resume continues each phone from where it stopped; Stop ends the mission everywhere.</li>
          <li>When a task started from the chat finishes, an answer card lists what each phone found, and failed phones can be retried in one click.</li>
        </ul>
      </section>

      <section aria-labelledby="reliable">
        <h2 id="reliable">Built for many phones at once</h2>
        <ul>
          <li>
            <strong>Retries:</strong> up to three tries per phone for temporary problems such as a phone going offline, a
            rate-limited AI provider or a server restart.
          </li>
          <li>
            <strong>Busy and offline phones</strong> wait their turn instead of failing.
          </li>
          <li>
            <strong>Tags</strong> group phones for targeting, for example <code>#uk</code> or <code>#samsung</code>.
          </li>
          <li>
            <strong>Proxy lanes</strong> group phones that share a proxy, limit how many run at once and rotate the IP after a set
            number of tasks.
          </li>
          <li>
            <strong>Files</strong> up to 100 MB go to up to 1,000 phones in one send; offline phones get them when they reconnect.
          </li>
          <li>
            <strong>Network checks</strong> flag phones whose IP or language differs from the rest of their lane, or whose
            timezone, region or clock does not match their IP.
          </li>
        </ul>
        <p>
          Read how a single run works on <Link to="/how-it-works">How FLEET works</Link>.
        </p>
      </section>
    </ProductPage>
  );
}
