/** Words that on their own mean "yes" (English and Hinglish). */
const YES = [
  'yes', 'yeah', 'yep', 'y', 'ok', 'okay', 'okk', 'k', 'confirm', 'confirmed', 'go', 'go ahead', 'do it', 'sure',
  'haan', 'han', 'ha', 'haa', 'hanji', 'haan ji', 'ji', 'kar do', 'kardo', 'karo', 'chalo', 'chala do', 'theek hai', 'thik hai',
  'start', 'start it', 'start now', 'run it', 'shuru karo', 'shuru kar do',
];

/**
 * Words that only urge the yes on ("ok start NOW", "haan chala do bhai").
 * Nothing here changes what runs, so a message made of them is still a plain
 * yes. Anything else ("ok but only 1 phone") is left to the model.
 */
const URGE = [
  ...YES, 'now', 'abhi', 'right now', 'run', 'please', 'pls', 'plz', 'bhai', 'bro', 'jaldi', 'fast', 'quickly',
  'chalao', 'shuru', 'go on', 'kar', 'de', 'do', 'it', 'na', 'yaar',
];

const alt = (words: string[]) =>
  [...new Set(words)]
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'))
    .join('|');

/** A message that is nothing but a yes, however it is urged on. */
export const PLAIN_YES = new RegExp(`^(?:${alt(YES)})(?:[\\s,.!]+(?:${alt(URGE)}))*[\\s,.!]*$`, 'i');
