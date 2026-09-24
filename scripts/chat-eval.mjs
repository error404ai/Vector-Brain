#!/usr/bin/env node
/**
 * Vector chat eval: sends real-life messages to the live chat model in DRY-RUN
 * mode (nothing is started or changed) and checks what it would do.
 *
 *   node scripts/chat-eval.mjs https://app.vectoragent.in you@mail.com 'password'
 *
 * Each case costs one to a few model calls (fractions of a cent).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const policyFlag = (args.find((a) => a.startsWith('--policy=')) || '').split('=')[1];
const positional = args.filter((a) => !a.startsWith('--'));
const [base, email, password] = positional;
if (!base || !email || !password) {
  console.error("usage: node scripts/chat-eval.mjs [--policy=v1|v2] <app url> <email> "<password>"
  process.exit(2);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(fs.readFileSync(path.join(here, 'chat-eval-cases.json'), 'utf8'));

const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }).then((r) => r.json());
const token = login?.data?.token ?? login?.data?.access_token;
if (!token) {
  console.error('login failed:', JSON.stringify(login).slice(0, 200));
  process.exit(2);
}

const matches = (call, want) =>
  call.name === want.name &&
  Object.entries(want.args ?? {}).every(([k, v]) => {
    const got = call.args?.[k];
    if (typeof v === 'string' && v.startsWith('~')) return new RegExp(v.slice(1), 'i').test(String(got ?? ''));
    return got === v;
  });

let passed = 0;
for (const c of cases) {
  const res = await fetch(`${base}/api/android/chat/dry-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: c.message, history: c.history ?? [], pending: c.pending ?? [], ...(policyFlag ? { policy: policyFlag } : {}) }),
  }).then((r) => r.json());
  const d = res?.data ?? {};
  const calls = d.calls ?? [];
  const problems = [];
  for (const want of c.expect_calls ?? []) if (!calls.some((call) => matches(call, want))) problems.push(`missing ${want.name} ${JSON.stringify(want.args ?? {})}`);
  for (const bad of c.forbid_calls ?? []) if (calls.some((call) => call.name === bad)) problems.push(`should not call ${bad}`);
  if (c.reply_matches && !new RegExp(c.reply_matches, 'i').test(d.text ?? '')) problems.push(`reply "${(d.text ?? '').slice(0, 80)}" !~ /${c.reply_matches}/`);
  if (c.reply_not && new RegExp(c.reply_not, 'i').test(d.text ?? '')) problems.push(`refused an ordinary task: "${(d.text ?? '').slice(0, 100)}"`);
  if (c.one_line && /\n/.test((d.text ?? '').trim())) problems.push(`refusal is longer than one line: "${(d.text ?? '').slice(0, 100)}"`);
  const ok = problems.length === 0;
  if (ok) passed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.message}`);
  if (!ok) {
    console.log(`      did: ${calls.map((x) => `${x.name}(${JSON.stringify(x.args)})`).join(', ') || 'no tools'} — "${(d.text ?? res?.message ?? '').slice(0, 100)}"`);
    for (const p of problems) console.log(`      ${p}`);
  }
}
console.log(`\n${passed}/${cases.length} passed${policyFlag ? ` (policy ${policyFlag})` : ''}`);
