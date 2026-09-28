import crypto from 'crypto';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { FileDiskCache } from './fileDiskCache';

const sha = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex');

async function* slices(buf: Buffer, size = 3) {
  for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size);
}

describe('FileDiskCache', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vb-cache-test-'));
  });
  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('reads the source once, however many phones ask at the same time', async () => {
    const body = Buffer.from('the same video for every phone');
    let reads = 0;
    const cache = new FileDiskCache(dir, 1024);
    const read = () => {
      reads += 1;
      return slices(body);
    };

    const paths = await Promise.all(Array.from({ length: 25 }, () => cache.get(sha(body), body.length, read)));
    const again = await cache.get(sha(body), body.length, read);

    expect(reads).toBe(1);
    expect(new Set([...paths, again]).size).toBe(1);
    expect(await fsp.readFile(again as string)).toEqual(body);
  });

  it('refuses a copy whose digest does not match, so the caller falls back', async () => {
    const body = Buffer.from('real bytes');
    const cache = new FileDiskCache(dir, 1024);
    const result = await cache.get(sha(Buffer.from('other bytes')), body.length, () => slices(body));
    expect(result).toBeNull();
    expect(await fsp.readdir(dir)).toEqual([]);
  });

  it('returns null when the source read fails', async () => {
    const cache = new FileDiskCache(dir, 1024);
    async function* broken() {
      yield Buffer.from('abc');
      throw new Error('database went away');
    }
    expect(await cache.get('a'.repeat(64), 10, broken)).toBeNull();
  });

  it('evicts the least recently used copy to stay under the cap', async () => {
    const a = Buffer.alloc(40, 1);
    const b = Buffer.alloc(40, 2);
    const c = Buffer.alloc(40, 3);
    const cache = new FileDiskCache(dir, 100);
    await cache.get(sha(a), a.length, () => slices(a, 16));
    await new Promise((r) => setTimeout(r, 15));
    await cache.get(sha(b), b.length, () => slices(b, 16));
    await new Promise((r) => setTimeout(r, 15));
    await cache.get(sha(c), c.length, () => slices(c, 16));

    const left = await fsp.readdir(dir);
    expect(left.sort()).toEqual([sha(b), sha(c)].sort());
  });

  it('skips files larger than the cap', async () => {
    const big = Buffer.alloc(200, 7);
    const cache = new FileDiskCache(dir, 100);
    expect(await cache.get(sha(big), big.length, () => slices(big, 50))).toBeNull();
  });
});
