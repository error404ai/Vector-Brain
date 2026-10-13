/**
 * What a task cannot take back, said on its Confirm card. The user decides what
 * the phones do; a task like this always waits for Confirm, whatever its size.
 */
export function irreversibleWarning(instruction: string): string | null {
  const t = instruction.toLowerCase();
  if (/\b(?:factory reset|reset (?:the |this |all )?phones? to factory|erase all data|wipe (?:the |all )?(?:phone|data))\b/.test(t)) {
    return 'FACTORY RESET erases everything on the phone, Vector included: the phone leaves your fleet until it is set up again by hand.';
  }
  if (/\b(?:power(?:ed)?[ -]?off|shut ?down|switch(?:ed)? off|turn(?:ed)? off)\b/.test(t) && /\b(?:phones?|devices?|mobiles?|it|them|all)\b/.test(t) && !/\b(?:wi-?fi|bluetooth|screen|flash|torch|data|hotspot|location|sound|notifications?|vpn|proxy|airplane|sync|dark mode)\b/.test(t)) {
    return 'POWER OFF: the phones go offline and cannot be switched back on from Vector. Someone has to press the power button on each one.';
  }
  if (/\b(?:delete|uninstall|remove|erase|clear)\b/.test(t)) {
    return 'This deletes something on the phones; it cannot be undone from Vector.';
  }
  return null;
}
