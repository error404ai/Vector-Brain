import { PLAIN_YES } from './plainYes';

describe('PLAIN_YES', () => {
  it.each(['ok', 'Ok Start NOW', 'OK!', 'haan chala do bhai', 'yes, run it', 'start now', 'okay go ahead', 'thik hai kar do', 'ok start', 'Haan ji'])(
    'confirms "%s"',
    (text) => expect(PLAIN_YES.test(text)).toBe(true),
  );

  it.each(['ok but only 1 phone', 'ok use samsung instead', 'no', 'stop', 'ok and also open youtube', 'start on 5 phones', 'what is running?'])(
    'leaves "%s" to the model',
    (text) => expect(PLAIN_YES.test(text)).toBe(false),
  );
});
