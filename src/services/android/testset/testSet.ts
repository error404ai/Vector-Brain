/**
 * The fixed test set: one list of everyday phone tasks, run on a few phones
 * before a change goes out, so a fix for one kind of task cannot quietly break
 * another (Oct 9: a counting change for YouTube made 14 of 15 website runs fail).
 *
 * Each task is a kind of work users give the agent, in their own words — not a
 * case any code knows about. Keep the wording fixed: results are compared run to
 * run. To change a task, add a new key instead of editing an old one.
 *
 * Tasks that change an account (follow, like) are kept to small numbers.
 * Nothing here sends messages, buys, signs in or deletes.
 */
export interface TestTask {
  key: string;
  /** What kind of work it is, for grouping results. */
  kind: 'open' | 'navigate' | 'web' | 'search' | 'media' | 'count' | 'social' | 'install' | 'input' | 'read';
  prompt: string;
}

export const TEST_SET: readonly TestTask[] = [
  { key: 'open-youtube', kind: 'open', prompt: 'Open the YouTube app.' },
  { key: 'settings-battery', kind: 'navigate', prompt: 'Open Settings and go to the Battery page.' },
  { key: 'about-android-version', kind: 'read', prompt: 'Open Settings, find the About phone page and tell me which Android version this phone runs.' },
  { key: 'chrome-wikipedia', kind: 'web', prompt: 'Open Chrome and go to wikipedia.org.' },
  { key: 'google-weather', kind: 'search', prompt: 'Open Chrome, search Google for "weather in London" and open the first result.' },
  { key: 'youtube-search-play', kind: 'media', prompt: 'Open YouTube, search for "lofi hip hop" and play the first video.' },
  { key: 'youtube-random-song', kind: 'media', prompt: 'Open the YouTube app and play any random song.' },
  { key: 'visit-5-sites', kind: 'count', prompt: 'Open Chrome and visit 5 random websites, one after another, spending a short time on each.' },
  { key: 'reels-5-scrolls', kind: 'count', prompt: 'Open Instagram and scroll through Reels 5 times, pausing briefly on each reel.' },
  { key: 'shorts-5-swipes', kind: 'count', prompt: 'Open YouTube Shorts and swipe through 5 shorts.' },
  { key: 'instagram-like-2', kind: 'social', prompt: 'Open Instagram and like 2 posts in the home feed, then stop.' },
  { key: 'instagram-follow-2', kind: 'social', prompt: 'Open Instagram and follow 2 accounts from the suggestions, then stop.' },
  { key: 'playstore-search', kind: 'search', prompt: 'Open the Play Store and search for "calculator".' },
  { key: 'maps-coffee', kind: 'search', prompt: 'Open Google Maps and search for coffee shops near me.' },
  { key: 'calculator-multiply', kind: 'input', prompt: 'Open the Calculator app and calculate 245 × 18.' },
  { key: 'clock-timer', kind: 'input', prompt: 'Open the Clock app and start a timer for 1 minute.' },
  { key: 'chrome-search-box', kind: 'input', prompt: 'Open Chrome, type "android automation" in the address bar and search.' },
  { key: 'playstore-updates', kind: 'navigate', prompt: 'Open the Play Store and go to the page that shows app updates.' },
];
