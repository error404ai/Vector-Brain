import { claimsActivity, historyText } from './chatClaims';


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
    expect(historyText({ role: 'assistant', text: 'Started — watch it below.', mission_id: 41 })).toMatch(/\[record: this reply started mission #41\]/);
    expect(historyText({ role: 'assistant', text: 'Started — installing Prime Video on OPPO.', mission_id: null })).toMatch(/did NOT start any task/);
    expect(historyText({ role: 'assistant', text: '3 phones are online.' })).toBe('3 phones are online.');
    expect(historyText({ role: 'user', text: 'Started?' })).toBe('Started?');
  });
});
