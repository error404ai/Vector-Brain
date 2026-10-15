jest.mock('../../loaders/database', () => ({ AppDataSource: { getRepository: () => ({}) } }));
for (const [k, v] of Object.entries({ PORT: '1', MYSQLHOST: 'x', MYSQLUSERNAME: 'x', MYSQLPASSWORD: 'x', DATABASE: 'x', JWT_SECRET: 'x' })) process.env[k] ??= v;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { CommandChatService } = require('./CommandChatService') as typeof import('./CommandChatService');

type Item = { id: number; device_name: string; status: string; replaces_item_id: number | null; last_message: string | null; reason_text: string | null };

function service(items: Item[]) {
  const recorded: { text: string; reply: { kind: string; result?: { stopped?: { finished: number; total: number }; phones: { name: string; ok: boolean }[] } } }[] = [];
  const svc = Object.create(CommandChatService.prototype) as Record<string, unknown>;
  svc.messageRepo = {
    findOne: async (q: { where: { role: string } }) => (q.where.role === 'assistant' ? { id: 10, conversation_id: 3 } : { id: 9, text: 'price of the first 3 results?' }),
  };
  svc.missionService = { get: async () => ({ data: { items } }) };
  svc.agent = { writeTaskAnswer: async () => null };
  svc.gatewayService = { broadcastToUser: () => undefined };
  svc.record = async (_u: number, _r: string, text: string, reply: never) => void recorded.push({ text, reply });
  const post = (status: string) => (svc as unknown as { postTaskAnswer: (m: unknown) => Promise<void> }).postTaskAnswer({ id: 7, user_id: 1, status, prompt: 'p', request: 'r' });
  return { post, recorded };
}

const done = (id: number): Item => ({ id, device_name: `Phone ${id}`, status: 'SUCCEEDED', replaces_item_id: null, last_message: `Result ${id}: ₹899`, reason_text: null });
const stopped = (id: number): Item => ({ id, device_name: `Phone ${id}`, status: 'CANCELLED', replaces_item_id: null, last_message: null, reason_text: 'stopped by you' });

describe('answer card when the user stops a task', () => {
  it('answers from the phones that had finished and says it was stopped', async () => {
    const s = service([done(1), done(2), stopped(3)]);
    await s.post('CANCELLED');
    expect(s.recorded).toHaveLength(1);
    const result = s.recorded[0].reply.result!;
    expect(result.stopped).toEqual({ finished: 2, total: 3 });
    expect(result.phones.map((p) => p.ok)).toEqual([true, true, false]);
  });

  it('no card when no phone had finished', async () => {
    const s = service([stopped(1), stopped(2)]);
    await s.post('CANCELLED');
    expect(s.recorded).toHaveLength(0);
  });

  it('a finished task is not marked stopped', async () => {
    const s = service([done(1)]);
    await s.post('DONE');
    expect(s.recorded[0].reply.result!.stopped).toBeUndefined();
  });
});
