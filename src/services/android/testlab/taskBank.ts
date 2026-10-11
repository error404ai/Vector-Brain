import { TEST_SET } from '../testset/testSet';

/**
 * The Test Lab's task bank: everyday phone work of every kind, in the words
 * users type — English and Hinglish, short and long. The nightly run samples
 * from it, so over a week every kind is tried on every test phone.
 *
 * Rules for adding tasks:
 * - A kind of work, never a case the code knows about. No task is "fixed" by
 *   code that names it.
 * - Nothing that reaches other people or costs money: no messages or emails to
 *   real contacts, no purchases, no deletes, no public posts. Account actions
 *   (follow, like, save) stay at small numbers. Drafts instead of publishing.
 * - Keys never change meaning: results are compared night to night. To change a
 *   task, add a new key.
 * - needs: the app packages the task cannot run without. A phone without one is
 *   a setup gap, not an engine failure.
 */
export type BankKind =
  | 'open'
  | 'navigate'
  | 'settings'
  | 'read'
  | 'web'
  | 'search'
  | 'media'
  | 'count'
  | 'social'
  | 'install'
  | 'input'
  | 'form'
  | 'multi';

export interface BankTask {
  key: string;
  kind: BankKind;
  prompt: string;
  needs?: string[];
}

const YT = 'com.google.android.youtube';
const IG = 'com.instagram.android';
const CHROME = 'com.android.chrome';
const MAPS = 'com.google.android.apps.maps';
const PLAY = 'com.android.vending';
const GMAIL = 'com.google.android.gm';

/** The original fixed test set, kept with its keys so old and new results line up. */
const FROM_TEST_SET: BankTask[] = TEST_SET.map((t) => ({
  key: t.key,
  kind: t.kind,
  prompt: t.prompt,
  needs: /instagram/i.test(t.prompt) ? [IG] : /youtube/i.test(t.prompt) ? [YT] : /chrome/i.test(t.prompt) ? [CHROME] : /maps/i.test(t.prompt) ? [MAPS] : undefined,
}));

const MORE: BankTask[] = [
  // Open and navigate
  { key: 'open-chrome-hinglish', kind: 'open', prompt: 'chrome kholo', needs: [CHROME] },
  { key: 'open-playstore', kind: 'open', prompt: 'Open the Play Store.', needs: [PLAY] },
  { key: 'open-camera', kind: 'open', prompt: 'Open the camera app.' },
  { key: 'open-gallery', kind: 'open', prompt: 'Open the photo gallery app.' },
  { key: 'open-then-home', kind: 'navigate', prompt: 'Open YouTube, then go back to the home screen.', needs: [YT] },
  { key: 'recent-apps', kind: 'navigate', prompt: 'Show the recent apps screen.' },
  { key: 'notifications-shade', kind: 'navigate', prompt: 'Pull down the notification shade and tell me how many notifications are there.' },
  { key: 'close-chrome', kind: 'navigate', prompt: 'Open Chrome and then close it.', needs: [CHROME] },
  { key: 'youtube-library', kind: 'navigate', prompt: 'Open YouTube and go to the You / Library tab.', needs: [YT] },
  { key: 'instagram-profile', kind: 'navigate', prompt: 'Instagram kholo aur apni profile pe jao.', needs: [IG] },
  { key: 'playstore-my-apps', kind: 'navigate', prompt: 'Open the Play Store and go to Manage apps & device.', needs: [PLAY] },

  // Settings
  { key: 'settings-wifi-state', kind: 'settings', prompt: 'Check whether Wi-Fi is on or off and tell me.' },
  { key: 'settings-bluetooth-state', kind: 'settings', prompt: 'Is Bluetooth on? Check in Settings and tell me.' },
  { key: 'settings-brightness', kind: 'settings', prompt: 'Open Settings and go to the Display page.' },
  { key: 'settings-storage', kind: 'settings', prompt: 'How much storage is used on this phone? Check in Settings.' },
  { key: 'settings-language', kind: 'settings', prompt: 'Find which language the phone is set to and tell me.' },
  { key: 'settings-date-time', kind: 'settings', prompt: 'Open the Date & time settings and tell me the time zone.' },
  { key: 'settings-app-info-chrome', kind: 'settings', prompt: 'Open the app info page for Chrome.', needs: [CHROME] },
  { key: 'settings-dnd-check', kind: 'settings', prompt: 'Check if Do Not Disturb is on.' },
  { key: 'settings-airplane-hinglish', kind: 'settings', prompt: 'settings mein dekh ke batao airplane mode on hai ya off' },
  { key: 'settings-ringtone', kind: 'settings', prompt: 'Open Settings and find the current ringtone name.' },
  { key: 'settings-battery-percent', kind: 'read', prompt: 'What is the battery percentage right now?' },

  // Read and report
  { key: 'read-model-name', kind: 'read', prompt: 'Tell me the model name of this phone from Settings.' },
  { key: 'read-playstore-version', kind: 'read', prompt: 'Which version of the Play Store app is installed?', needs: [PLAY] },
  { key: 'read-chrome-version', kind: 'read', prompt: 'Find the installed Chrome version.', needs: [CHROME] },
  { key: 'read-yt-first-title', kind: 'read', prompt: 'Open YouTube and tell me the title of the first video on the home feed.', needs: [YT] },
  { key: 'read-wikipedia-fact', kind: 'read', prompt: 'Open the Wikipedia page for the Eiffel Tower in Chrome and tell me its height.', needs: [CHROME] },
  { key: 'read-google-currency', kind: 'read', prompt: 'Search Google for 100 USD to INR and tell me the result.', needs: [CHROME] },

  // Web
  { key: 'web-bbc', kind: 'web', prompt: 'Open bbc.co.uk in Chrome.', needs: [CHROME] },
  { key: 'web-url-path', kind: 'web', prompt: 'Go to https://en.wikipedia.org/wiki/Android_(operating_system) in Chrome.', needs: [CHROME] },
  { key: 'web-scroll-article', kind: 'web', prompt: 'Open any news website in Chrome, open one article and scroll to the end of it.', needs: [CHROME] },
  { key: 'web-new-tab', kind: 'web', prompt: 'Open a new tab in Chrome and go to github.com.', needs: [CHROME] },
  { key: 'web-uk-sites-3', kind: 'count', prompt: 'Open Chrome and visit 3 UK news websites one by one.', needs: [CHROME] },
  { key: 'web-hinglish-sites', kind: 'count', prompt: 'chrome mein 4 alag alag websites kholo ek ek karke', needs: [CHROME] },
  { key: 'web-cookie-banner', kind: 'web', prompt: 'Open theguardian.com in Chrome and get past any cookie banner to the front page.', needs: [CHROME] },
  { key: 'web-close-tabs', kind: 'web', prompt: 'Close all tabs in Chrome.', needs: [CHROME] },

  // Search
  { key: 'search-yt-channel', kind: 'search', prompt: 'Search YouTube for the channel "Kurzgesagt" and open it.', needs: [YT] },
  { key: 'search-playstore-app-page', kind: 'search', prompt: 'Find the Telegram app page in the Play Store (do not install it).', needs: [PLAY] },
  { key: 'search-maps-route', kind: 'search', prompt: 'Open Google Maps and show the route from India Gate to Qutub Minar.', needs: [MAPS] },
  { key: 'search-google-images', kind: 'search', prompt: 'Search Google Images for "red panda".', needs: [CHROME] },
  { key: 'search-instagram-hashtag', kind: 'search', prompt: 'Instagram pe #travel search karo aur results kholo.', needs: [IG] },
  { key: 'search-yt-hinglish', kind: 'search', prompt: 'youtube pe "arijit singh songs" search karo', needs: [YT] },

  // Media
  { key: 'media-yt-pause', kind: 'media', prompt: 'Play any video on YouTube, then pause it.', needs: [YT] },
  { key: 'media-yt-fullscreen', kind: 'media', prompt: 'Play a YouTube video and make it full screen.', needs: [YT] },
  { key: 'media-yt-captions', kind: 'media', prompt: 'Play a YouTube video and turn on captions.', needs: [YT] },
  { key: 'media-yt-next', kind: 'media', prompt: 'Play a lofi music video on YouTube and then skip to the next video.', needs: [YT] },
  { key: 'media-yt-music-hinglish', kind: 'media', prompt: 'youtube pe koi bhi punjabi gaana chala do', needs: [YT] },
  { key: 'media-ig-reel-watch', kind: 'media', prompt: 'Open Instagram Reels and watch one reel for about 20 seconds.', needs: [IG] },

  // Counts
  { key: 'count-shorts-3-hinglish', kind: 'count', prompt: 'youtube shorts kholo aur 3 shorts swipe karo', needs: [YT] },
  { key: 'count-reels-10', kind: 'count', prompt: 'Scroll through 10 reels on Instagram.', needs: [IG] },
  { key: 'count-feed-scroll-4', kind: 'count', prompt: 'Open Instagram and scroll the home feed 4 times.', needs: [IG] },
  { key: 'count-wikipedia-random-3', kind: 'count', prompt: 'Open 3 random Wikipedia articles using Special:Random in Chrome.', needs: [CHROME] },
  { key: 'count-yt-videos-2', kind: 'count', prompt: 'Watch 2 different YouTube videos for about 15 seconds each.', needs: [YT] },

  // Social (small numbers, reversible)
  { key: 'social-like-reel-1', kind: 'social', prompt: 'Like 1 reel on Instagram.', needs: [IG] },
  { key: 'social-like-3-hinglish', kind: 'social', prompt: 'instagram pe feed ki 3 posts like karo', needs: [IG] },
  { key: 'social-save-post', kind: 'social', prompt: 'Save one post from the Instagram home feed to your saved items.', needs: [IG] },
  { key: 'social-yt-like', kind: 'social', prompt: 'Play any music video on YouTube and like it.', needs: [YT] },
  { key: 'social-yt-watch-later', kind: 'social', prompt: 'Add any YouTube video to Watch Later.', needs: [YT] },
  { key: 'social-follow-1', kind: 'social', prompt: 'Follow 1 suggested account on Instagram.', needs: [IG] },

  // Install (small, common, safe)
  { key: 'install-calculator-check', kind: 'install', prompt: 'Is a calculator app installed? If not, install Google Calculator from the Play Store.', needs: [PLAY] },
  { key: 'install-telegram', kind: 'install', prompt: 'Install Telegram from the Play Store.', needs: [PLAY] },
  { key: 'install-hinglish', kind: 'install', prompt: 'play store se "Files by Google" install karo', needs: [PLAY] },

  // Input
  { key: 'input-notes', kind: 'input', prompt: 'Open a notes app (Keep or any notes app) and write a note "test lab check".' },
  { key: 'input-calc-percent', kind: 'input', prompt: 'Use the calculator to work out 18% of 2450 and tell me the answer.' },
  { key: 'input-alarm', kind: 'input', prompt: 'Set an alarm for 6:30 AM in the Clock app.' },
  { key: 'input-stopwatch', kind: 'input', prompt: 'Start the stopwatch in the Clock app, let it run about 5 seconds, then stop it.' },
  { key: 'input-chrome-find', kind: 'input', prompt: 'Open wikipedia.org/wiki/India in Chrome and use Find in page to search for "monsoon".', needs: [CHROME] },
  { key: 'input-yt-search-long', kind: 'input', prompt: 'Search YouTube for "how to make masala chai at home step by step".', needs: [YT] },

  // Forms (web forms with fields, limits and validation; nothing is submitted for real)
  { key: 'form-gmail-draft', kind: 'form', prompt: 'Open Gmail and write a draft email to test@example.com with subject "Hello" and body "Just testing". Do not send it.', needs: [GMAIL] },
  { key: 'form-google-form-fill', kind: 'form', prompt: 'Open https://www.w3schools.com/html/html_forms.asp in Chrome and type "Tarun" in the first name field of the example form.', needs: [CHROME] },
  { key: 'form-blogger-draft', kind: 'form', prompt: 'On blogger.com, start a new post with a short title and two lines of text about travel, and keep it as a draft (do not publish).', needs: [CHROME] },
  { key: 'form-maps-save-home', kind: 'form', prompt: 'In Google Maps, search for "Sukhna Lake, Chandigarh" and open its details.', needs: [MAPS] },

  // Multi-part
  { key: 'multi-yt-then-chrome', kind: 'multi', prompt: 'Open YouTube and search "news", then open Chrome and go to bbc.com.', needs: [YT, CHROME] },
  { key: 'multi-read-then-search', kind: 'multi', prompt: 'Find this phone\'s Android version, then search Google for what is new in that version.', needs: [CHROME] },
  { key: 'multi-ig-yt-hinglish', kind: 'multi', prompt: 'pehle instagram pe 2 reels dekho fir youtube pe lofi search karo', needs: [IG, YT] },
  { key: 'multi-install-open', kind: 'multi', prompt: 'Install Telegram if it is not installed, then open it.', needs: [PLAY] },
  { key: 'multi-settings-back-home', kind: 'multi', prompt: 'Open Settings, check the Wi-Fi network name, then go back to the home screen and tell me the name.' },
  { key: 'multi-close-two', kind: 'multi', prompt: 'Open YouTube and Chrome, then close both.', needs: [YT, CHROME] },
];

export const TASK_BANK: readonly BankTask[] = [...FROM_TEST_SET, ...MORE];

export function bankTask(key: string): BankTask | undefined {
  return TASK_BANK.find((t) => t.key === key);
}
