import { askFromText, asksForPhones, phoneOptions } from './askButtons';

// The reply from the chat on 7 Oct: a question with bullet options, as text.
const REPLY = `I'd be happy to open a browser and navigate to that URL on your phones. Which phones should I do this on?
- **All online phones** (21 phones across EE &UK and Vodafone lanes)
- **A specific lane** (EE &UK or Vodafone)
- **Specific phone(s)** (name them)
Let me know and I'll get started!`;

describe('buttons for a question written as text', () => {
  it('reads the question and its bullet options', () => {
    expect(askFromText(REPLY)).toEqual({
      question: "I'd be happy to open a browser and navigate to that URL on your phones. Which phones should I do this on?",
      options: ['All online phones', 'A specific lane', 'Specific phone(s)'],
    });
  });

  it('knows a "which phones" question, in English or Hinglish, and not a report that names phones', () => {
    expect(asksForPhones(REPLY)).toBe(true);
    expect(asksForPhones('Kaunse phones par chalaun?')).toBe(true);
    expect(asksForPhones('21 phones are online. Which phones are busy: none.')).toBe(false);
  });

  it('builds phone buttons from the fleet, not from the model', () => {
    expect(phoneOptions({ online: 21, lanes: [{ lane: 'EE &UK', online: 11 }, { lane: 'Vodafone', online: 10 }, { lane: 'no lane', online: 2 }], hasLast: true })).toEqual([
      'All online phones (21)',
      'All phones in EE &UK (11)',
      'All phones in Vodafone (10)',
      'Same phones as the last task',
    ]);
  });

  it('leaves alone a report that lists things and ends with a question, and plain answers', () => {
    const report = 'Status:\n- 18 done\n- 2 failed\nThe failed ones had accessibility off.\nWant me to retry them?';
    expect(askFromText(report)).toBeNull();
    expect(askFromText('Done — opened Chrome on 3 phones.')).toBeNull();
    expect(askFromText('Which phone?\n- only one')).toBeNull();
  });
});
