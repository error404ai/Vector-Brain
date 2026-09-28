import { answerPrompt, fallbackAnswer, parseAnswer, type PhoneReport } from './taskAnswer';

const phones: PhoneReport[] = [
  { name: 'motorola moto g(9) power', ok: true, report: '**Proxy check result: NO proxy is configured on this phone.** Public IP 31.94.38.82' },
  { name: 'OPPO CPH1933', ok: false, report: 'got stuck — the screen stopped changing' },
];

describe('task answer', () => {
  it('asks for an answer from the reports only, with each phone and its status', () => {
    const { system, user } = answerPrompt({ question: 'tell me both devices proxy IP', task: 'Find the proxy', language: 'English', phones });
    expect(system).toMatch(/ONLY the phone reports/);
    expect(user).toMatch(/motorola moto g\(9\) power — finished/);
    expect(user).toMatch(/OPPO CPH1933 — FAILED/);
  });

  it('keeps the real phones and statuses whatever the model says', () => {
    const raw = '```json\n{"answer":"motorola uses 31.94.38.82; OPPO did not finish.","phones":[{"name":"OPPO CPH1933","value":"1.2.3.4","detail":"stuck"},{"name":"MOTOROLA MOTO G(9) POWER","value":"31.94.38.82","detail":"no Wi-Fi proxy"}]}\n```';
    const out = parseAnswer(raw, phones)!;
    expect(out.answer).toBe('motorola uses 31.94.38.82; OPPO did not finish.');
    expect(out.phones.map((p) => [p.name, p.ok, p.value])).toEqual([
      ['motorola moto g(9) power', true, '31.94.38.82'],
      // A failed phone never gets a value, even if the model made one up.
      ['OPPO CPH1933', false, ''],
    ]);
  });

  it('rejects output that is not usable JSON', () => {
    expect(parseAnswer('The IP is 31.94.38.82', phones)).toBeNull();
    expect(parseAnswer('{"answer": ""}', phones)).toBeNull();
  });

  it('falls back to counts and the phones own reports', () => {
    const out = fallbackAnswer(phones);
    expect(out.answer).toBe('1 of 2 phones finished.');
    expect(out.phones[0].detail).not.toMatch(/\*\*/);
  });
});
