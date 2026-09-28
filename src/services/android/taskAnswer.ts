/**
 * The answer card posted in the chat when a task started from it finishes:
 * the user's question answered from what each phone reported. Pure (no model,
 * no database) so the prompt, parsing and fallback can be tested.
 */

/** What one phone did, as the answer is built from it. */
export interface PhoneReport {
  name: string;
  ok: boolean;
  /** The phone's own final report, or why it failed. */
  report: string;
}

/** One row of the card. `ok` always comes from the task result, never from the model. */
export interface AnswerPhone {
  name: string;
  ok: boolean;
  /** The key fact for this phone, shown as a chip ("31.94.38.82"); empty when there is none. */
  value: string;
  detail: string;
}

export interface TaskAnswer {
  mission_id: number;
  question: string;
  answer: string;
  phones: AnswerPhone[];
}

const clip = (text: string, max: number) => {
  const t = String(text ?? '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : t;
};

/** The instruction for the one model call that writes the answer. */
export function answerPrompt(input: { question: string; task: string; language: string; phones: PhoneReport[] }): { system: string; user: string } {
  const system = [
    "You write the answer to the user's question after a task ran on their Android phones.",
    'Use ONLY the phone reports below. Never invent a value, IP, email, number or status. If a phone failed or its report does not contain the answer, say so for that phone.',
    'Return ONLY JSON, no code fence: {"answer": "...", "phones": [{"name": "...", "value": "...", "detail": "..."}]}',
    `- answer: one or two short plain sentences in ${input.language} that directly answer the question. No markdown, no emoji.`,
    '- phones: one entry per phone, name copied exactly. value: the key fact for that phone, at most 40 characters (an IP, an email, "Installed", "Not set"), or "" if there is none. detail: at most 120 characters of context or, for a failed phone, why it failed.',
  ].join('\n');
  const user = [
    `Question: ${input.question}`,
    `Task the phones ran: ${input.task}`,
    'Phone reports:',
    ...input.phones.map((p, i) => `${i + 1}. ${p.name} — ${p.ok ? 'finished' : 'FAILED'}: ${clip(p.report, 600) || '(no report)'}`),
  ].join('\n');
  return { system, user };
}

/** Parses the model's JSON; anything unusable returns null so the fallback is used. */
export function parseAnswer(raw: string, phones: PhoneReport[]): { answer: string; phones: AnswerPhone[] } | null {
  const text = String(raw ?? '').replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let data: { answer?: unknown; phones?: unknown };
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const answer = clip(String(data.answer ?? ''), 400);
  if (!answer) return null;
  const given = Array.isArray(data.phones) ? (data.phones as { name?: unknown; value?: unknown; detail?: unknown }[]) : [];
  return {
    answer,
    // Rows follow the real phones, in order; the model only fills value/detail.
    phones: phones.map((p) => {
      const row = given.find((g) => String(g?.name ?? '').trim().toLowerCase() === p.name.toLowerCase());
      return {
        name: p.name,
        ok: p.ok,
        value: p.ok ? clip(String(row?.value ?? ''), 40) : '',
        detail: clip(String(row?.detail ?? '') || p.report, 140),
      };
    }),
  };
}

/** The card without a model: counts and each phone's own report. */
export function fallbackAnswer(phones: PhoneReport[]): { answer: string; phones: AnswerPhone[] } {
  const done = phones.filter((p) => p.ok).length;
  const answer =
    phones.length === 1
      ? phones[0].ok
        ? clip(phones[0].report, 300) || 'Finished.'
        : `It did not finish: ${clip(phones[0].report, 200) || 'the task failed'}.`
      : `${done} of ${phones.length} phones finished.`;
  return { answer, phones: phones.map((p) => ({ name: p.name, ok: p.ok, value: '', detail: clip(p.report, 140) })) };
}
