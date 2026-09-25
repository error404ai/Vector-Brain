/**
 * Stand-in phone screens for the landing page, painted on 2D canvases (560 × 1206,
 * a phone's aspect). The 3D scene uses them as screen textures and the page uses
 * them in the step cards and example runs. Real device screenshots replace these later.
 */
export const C = { paper: '#F6F8FB', ink: '#111827', graphite: '#6B7280', clay: '#2563EB', bone: '#E5E7EB', mute: '#9CA3AF', ok: '#059669' };
const FD = "'Archivo','Arial Narrow',Arial,sans-serif";
const FM = "'IBM Plex Mono',Menlo,monospace";

export type ScreenKind = 'command' | 'checkout' | 'status' | 'apps' | 'monitor' | 'mail' | 'onboard' | 'settings' | 'update';
type Ctx = CanvasRenderingContext2D;
type Painter = (ctx: Ctx, W: number, H: number) => void;

export const SCREEN_W = 560;
export const SCREEN_H = 1206;

function setFont(ctx: Ctx, weight: number, size: number, fam: string, cond = false) {
  ctx.font = `${weight} ${size}px ${fam}`;
  if ('fontStretch' in ctx) ctx.fontStretch = cond ? 'extra-condensed' : 'normal';
}
function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}
function statusBar(ctx: Ctx, W: number, fg: string) {
  setFont(ctx, 500, 22, FM); ctx.fillStyle = fg; ctx.textBaseline = 'alphabetic';
  ctx.fillText('09:41', 40, 58); ctx.textAlign = 'right'; ctx.fillText('5G ▮▮▮', W - 40, 58); ctx.textAlign = 'left';
}

export const SCREENS: Record<ScreenKind, Painter> = {
  command(ctx, W, H) {
    ctx.fillStyle = '#0B1220'; ctx.fillRect(0, 0, W, H); statusBar(ctx, W, C.mute);
    setFont(ctx, 500, 20, FM); ctx.fillStyle = '#60A5FA'; ctx.fillText('FLEET · OPERATOR', 40, 130);
    ctx.fillStyle = C.mute; ctx.fillText('NEW COMMAND', 40, 160);
    setFont(ctx, 800, 92, FD, true); ctx.fillStyle = C.paper;
    ['RUN CHECKOUT', 'TEST ON ALL', 'DEVICES'].forEach((l, i) => ctx.fillText(l, 38, 270 + i * 86));
    ctx.fillStyle = C.clay; ctx.fillRect(40, 470, 64, 5);
    setFont(ctx, 500, 20, FM); ctx.fillStyle = C.mute; ctx.fillText('TARGET  ALL · 1,000 PHONES', 40, 530);
    ctx.fillText('MODEL   YOUR KEY (BYOK)', 40, 562);
    const rows = [['PX-0001', 'done'], ['PX-0002', 'done'], ['SM-0147', 'pay'], ['OP-0388', 'cart'], ['MI-0512', 'open'], ['PX-0999', 'queue']];
    rows.forEach((r, i) => {
      const y = 640 + i * 78; ctx.strokeStyle = 'rgba(229,231,235,.14)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(40, y - 44); ctx.lineTo(W - 40, y - 44); ctx.stroke();
      ctx.fillStyle = C.bone; setFont(ctx, 500, 22, FM); ctx.fillText(r[0], 40, y);
      const done = r[1] === 'done'; ctx.fillStyle = done ? C.ok : C.clay; ctx.textAlign = 'right'; ctx.fillText(done ? 'DONE ✓' : r[1].toUpperCase(), W - 40, y); ctx.textAlign = 'left';
      const pw = done ? 1 : [0, 0, .82, .55, .25, .05][i]; ctx.fillStyle = 'rgba(229,231,235,.12)'; ctx.fillRect(40, y + 14, W - 80, 4); ctx.fillStyle = done ? C.ok : C.clay; ctx.fillRect(40, y + 14, (W - 80) * pw, 4);
    });
    rr(ctx, 40, H - 150, W - 80, 86, 43); ctx.fillStyle = C.paper; ctx.fill();
    setFont(ctx, 500, 22, FM); ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.fillText('STOP ALL', W / 2, H - 99); ctx.textAlign = 'left';
  },
  checkout(ctx, W, H) {
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H); statusBar(ctx, W, C.ink);
    setFont(ctx, 700, 40, FD, true); ctx.fillStyle = C.ink; ctx.fillText('CHECKOUT', 40, 150);
    ctx.fillStyle = '#E3EAF5'; ctx.fillRect(40, 190, W - 80, 360);
    ctx.fillStyle = C.clay; ctx.beginPath(); ctx.arc(W / 2, 370, 96, 0, Math.PI * 2); ctx.fill();
    setFont(ctx, 500, 26, FM); ctx.fillStyle = C.ink; ctx.fillText('Ceramic cup', 40, 610); ctx.textAlign = 'right'; ctx.fillText('£24.00', W - 40, 610); ctx.textAlign = 'left';
    ctx.fillStyle = C.graphite; setFont(ctx, 400, 22, FM); ['Delivery', 'Total'].forEach((l, i) => { ctx.fillText(l, 40, 680 + i * 50); ctx.textAlign = 'right'; ctx.fillText(i ? '£27.50' : '£3.50', W - 40, 680 + i * 50); ctx.textAlign = 'left'; });
    rr(ctx, 40, H - 250, W - 80, 100, 14); ctx.fillStyle = C.ink; ctx.fill();
    setFont(ctx, 700, 36, FD, true); ctx.fillStyle = C.paper; ctx.textAlign = 'center'; ctx.fillText('PAY NOW', W / 2, H - 186); ctx.textAlign = 'left';
    ctx.strokeStyle = C.clay; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(W / 2 + 130, H - 200, 34, 0, Math.PI * 2); ctx.stroke();
  },
  status(ctx, W, H) {
    ctx.fillStyle = '#0F172A'; ctx.fillRect(0, 0, W, H); statusBar(ctx, W, C.mute);
    setFont(ctx, 700, 40, FD, true); ctx.fillStyle = C.bone; ctx.fillText('DEVICES', 40, 150);
    for (let i = 0; i < 24; i++) { const c = i % 4, r = Math.floor(i / 4), x = 40 + c * ((W - 80) / 4), y = 200 + r * 150;
      rr(ctx, x + 6, y, (W - 80) / 4 - 12, 130, 12); ctx.fillStyle = i % 7 === 3 ? C.clay : i % 5 === 1 ? '#334155' : C.bone; ctx.fill(); }
    setFont(ctx, 500, 20, FM); ctx.fillStyle = C.mute; ctx.fillText('24 ONLINE · 3 RUNNING', 40, H - 90);
  },
  apps(ctx, W, H) {
    ctx.fillStyle = '#EEF2F7'; ctx.fillRect(0, 0, W, H); statusBar(ctx, W, C.ink);
    const cols = ['#111827', '#2563EB', '#0F766E', '#93C5FD', '#A5F3EC', '#C7B8F5'];
    for (let i = 0; i < 20; i++) { const c = i % 4, r = Math.floor(i / 4), s = 92, gx = (W - 4 * s) / 5;
      rr(ctx, gx + c * (s + gx), 170 + r * 170, s, s, 26); ctx.fillStyle = cols[(i * 5 + r) % cols.length]; ctx.fill(); }
    rr(ctx, 40, H - 150, W - 80, 80, 40); ctx.fillStyle = '#FFFFFF'; ctx.fill();
  },
  monitor(ctx, W, H) {
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H); statusBar(ctx, W, C.ink);
    setFont(ctx, 700, 40, FD, true); ctx.fillStyle = C.ink; ctx.fillText('NIGHTLY CHECK', 40, 150);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 4; ctx.beginPath();
    for (let i = 0; i <= 30; i++) { const x = 40 + i * (W - 80) / 30, y = 430 - Math.sin(i * .6) * 60 - (i > 22 ? (i - 22) * 14 : 0); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke(); ctx.fillStyle = C.clay; ctx.beginPath(); ctx.arc(W - 40, 318, 12, 0, 7); ctx.fill();
    setFont(ctx, 500, 22, FM); ['Opened app', 'Read home screen', 'Compared to last run', '2 changes found'].forEach((l, i) => { ctx.fillStyle = i === 3 ? C.clay : C.graphite; ctx.fillText((i === 3 ? '! ' : '✓ ') + l, 40, 620 + i * 64); });
  },
  mail(ctx, W, H) {
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H); statusBar(ctx, W, C.ink);
    setFont(ctx, 700, 40, FD, true); ctx.fillStyle = C.ink; ctx.fillText('ACCOUNTS', 40, 150);
    for (let i = 0; i < 7; i++) { const y = 210 + i * 110; ctx.fillStyle = ['#111827', '#2563EB', '#0F766E'][i % 3]; ctx.beginPath(); ctx.arc(80, y + 36, 32, 0, 7); ctx.fill();
      ctx.fillStyle = '#D6DCE6'; ctx.fillRect(140, y + 16, 260 - i * 14, 16); ctx.fillRect(140, y + 46, 180, 12); }
  },
  onboard(ctx, W, H) {
    ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, H); statusBar(ctx, W, C.mute);
    ctx.strokeStyle = C.bone; ctx.lineWidth = 3; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(W / 2, 480, 60 + i * 50, 0, 7); ctx.stroke(); }
    setFont(ctx, 800, 70, FD, true); ctx.fillStyle = C.paper; ctx.textAlign = 'center'; ctx.fillText('WELCOME', W / 2, 820);
    setFont(ctx, 500, 22, FM); ctx.fillStyle = C.mute; ctx.fillText('ALLOW NOTIFICATIONS?', W / 2, 880);
    rr(ctx, 40, H - 170, W - 80, 90, 45); ctx.fillStyle = C.clay; ctx.fill(); ctx.fillStyle = C.paper; ctx.fillText('ALLOW', W / 2, H - 116); ctx.textAlign = 'left';
  },
  settings(ctx, W, H) {
    ctx.fillStyle = '#EEF2F7'; ctx.fillRect(0, 0, W, H); statusBar(ctx, W, C.ink);
    setFont(ctx, 700, 40, FD, true); ctx.fillStyle = C.ink; ctx.fillText('SETTINGS', 40, 150);
    ['Wi-Fi', 'Display', 'Battery', 'Storage', 'Updates', 'Accessibility', 'Language'].forEach((l, i) => { const y = 240 + i * 108;
      setFont(ctx, 500, 26, FM); ctx.fillStyle = C.ink; ctx.fillText(l, 40, y);
      rr(ctx, W - 130, y - 32, 90, 46, 23); ctx.fillStyle = i % 3 === 1 ? '#CBD5E1' : C.ink; ctx.fill();
      ctx.fillStyle = C.paper; ctx.beginPath(); ctx.arc(i % 3 === 1 ? W - 107 : W - 63, y - 9, 17, 0, 7); ctx.fill(); });
  },
  update(ctx, W, H) {
    ctx.fillStyle = '#0F172A'; ctx.fillRect(0, 0, W, H); statusBar(ctx, W, C.mute);
    setFont(ctx, 800, 120, FD, true); ctx.fillStyle = C.paper; ctx.fillText('v4.2', 40, 360);
    setFont(ctx, 500, 22, FM); ctx.fillStyle = C.mute; ctx.fillText('INSTALLED · OPENED · OK', 40, 420);
    ctx.fillStyle = 'rgba(229,231,235,.14)'; ctx.fillRect(40, 520, W - 80, 10); ctx.fillStyle = C.clay; ctx.fillRect(40, 520, (W - 80) * .86, 10);
    setFont(ctx, 500, 22, FM); ctx.fillStyle = C.bone; ctx.fillText('430 / 500 CONFIRMED', 40, 590);
  }
};

/** Paint a screen at full texture size onto `canvas`, scaled to whatever size the canvas is. */
export function paintScreen(canvas: HTMLCanvasElement, kind: ScreenKind) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(canvas.width / SCREEN_W, 0, 0, canvas.height / SCREEN_H, 0, 0);
  SCREENS[kind](ctx, SCREEN_W, SCREEN_H);
}
