import { claimsActivity, claimsStart, historyEntry, historyText, stripRecords } from './chatClaims';


describe('claims about tasks', () => {
  it('catches the replies that told the user a task was running when none was', () => {
    expect(claimsActivity('Started — installing Prime Video from the Play Store on OPPO CPH1933.')).toBe(true);
    expect(claimsActivity("The Prime Video install is still running — I'll report once it finishes.")).toBe(true);
    expect(claimsActivity('Task chal raha hai OPPO pe')).toBe(true);
  });

  it('leaves answers alone that claim nothing', () => {
    expect(claimsActivity('No task is running right now — everything is idle.')).toBe(false);
    expect(claimsActivity('3 phones are online, 1 offline.')).toBe(false);
    expect(claimsActivity('Nothing was started — tell me what to run.')).toBe(false);
  });

  it('gives the model the record of what each earlier reply really did', () => {
    expect(historyText({ role: 'assistant', text: 'Started — watch it below.', mission_id: 41 })).toMatch(/started mission #41 via run_mission/);
    expect(historyText({ role: 'assistant', text: 'Started — installing Prime Video on OPPO.', mission_id: null })).toMatch(/^Nothing was started/);
    expect(historyText({ role: 'assistant', text: '3 phones are online.' })).toBe('3 phones are online.');
    expect(historyText({ role: 'user', text: 'Started?' })).toBe('Started?');
  });
});

describe('made-up task starts', () => {
  it('catches the mission template and copied record lines', () => {
    expect(claimsStart('Running "Install the Facebook app from the Play Store" on both PhoneReady phones (motorola, OPPO).')).toBe(true);
    expect(claimsStart('Running "Open Chrome and Firefox if available" on both phones.\n[record: this reply started mission #130]')).toBe(true);
    expect(claimsStart('[record: this reply started mission #131]')).toBe(true);
    expect(claimsStart('Mission #129 is still running on 2 phones.')).toBe(false);
    expect(claimsStart('2 phones are running Chrome right now.')).toBe(false);
  });

  it('never shows record notes to the user', () => {
    expect(stripRecords('Running "X" on 2 phones.\n[record: this reply started mission #130]')).toBe('Running "X" on 2 phones.');
  });
});

describe('history the model learns from', () => {
  const reply = JSON.stringify({ kind: 'mission', mission: { id: 128, prompt: 'Install Facebook', items: [{ device_name: 'OPPO' }, { device_name: 'moto' }] } });

  it('replays a reply that started a mission as the run_mission call it was', () => {
    const entry = historyEntry({ role: 'assistant', text: 'Started — watch it below.\n[record: x]', mission_id: 128, reply });
    expect(entry.mission).toEqual({ id: 128, instruction: 'Install Facebook', phones: 'OPPO, moto' });
    expect(entry.text).toBe('Started — watch it below.');
  });

  it('replaces a reply that claimed a start without one', () => {
    const fake = historyEntry({ role: 'assistant', text: 'Running "Open Chrome" on both phones.\n[record: this reply started mission #130]', mission_id: null });
    expect(fake.mission).toBeUndefined();
    expect(fake.text).toMatch(/^Nothing was started/);
  });

  it('leaves ordinary answers and user messages as they are', () => {
    expect(historyEntry({ role: 'assistant', text: '3 phones are online.' })).toEqual({ role: 'assistant', text: '3 phones are online.' });
    expect(historyEntry({ role: 'user', text: 'open chrome' })).toEqual({ role: 'user', text: 'open chrome' });
  });
});
