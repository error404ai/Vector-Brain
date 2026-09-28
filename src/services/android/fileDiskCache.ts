import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';

/** Where verified copies live. Coolify wipes it on redeploy, which is fine: it refills on demand. */
const DEFAULT_DIR = process.env.FILE_CACHE_DIR || path.join(os.tmpdir(), 'vb-file-cache');

/** Most bytes kept on disk; the least recently used copies go first. */
const DEFAULT_MAX_BYTES = Number(process.env.FILE_CACHE_MAX_BYTES) || 2 * 1024 * 1024 * 1024;

const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Local disk copies of stored files, keyed by SHA-256.
 *
 * Without it every phone that downloads a file reads the whole thing out of
 * MySQL again: one 48 MB video sent to 500 phones is 24 GB of database reads,
 * enough to starve logins and missions of connections while it runs. With it
 * the database is read once per file, and every later download streams from
 * disk (usually the page cache).
 *
 * A copy is only served after its length and SHA-256 match what was stored, and
 * anything that goes wrong (disk full, read error, bad digest) returns null so
 * the caller falls back to streaming from the database, exactly as before.
 */
export class FileDiskCache {
  /** One fill per file at a time; later requests wait for it rather than reading MySQL too. */
  private filling = new Map<string, Promise<string | null>>();

  constructor(
    private readonly dir = DEFAULT_DIR,
    private readonly maxBytes = DEFAULT_MAX_BYTES,
  ) {}

  /** Path of a verified copy, making it from `read` if there is none yet. */
  async get(sha256: string, sizeBytes: number, read: () => AsyncIterable<Buffer>): Promise<string | null> {
    const sha = String(sha256 || '').toLowerCase();
    if (!SHA256.test(sha) || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return null;

    const target = path.join(this.dir, sha);
    try {
      const stat = await fsp.stat(target);
      if (stat.size === sizeBytes) {
        // Mark it recently used so the size cap evicts something older first.
        const now = new Date();
        await fsp.utimes(target, now, now).catch(() => undefined);
        return target;
      }
      await fsp.rm(target, { force: true });
    } catch {
      // No copy yet.
    }

    let job = this.filling.get(sha);
    if (!job) {
      job = this.fill(sha, sizeBytes, target, read).finally(() => this.filling.delete(sha));
      this.filling.set(sha, job);
    }
    return job;
  }

  private async fill(
    sha: string,
    sizeBytes: number,
    target: string,
    read: () => AsyncIterable<Buffer>,
  ): Promise<string | null> {
    if (sizeBytes > this.maxBytes) return null;
    const temp = `${target}.${process.pid}.${Date.now()}.part`;
    try {
      await fsp.mkdir(this.dir, { recursive: true });
      await this.makeRoom(sizeBytes);

      const hash = crypto.createHash('sha256');
      let written = 0;
      const counter = new Transform({
        transform(chunk: Buffer, _enc, done) {
          hash.update(chunk);
          written += chunk.length;
          done(null, chunk);
        },
      });
      await pipeline(Readable.from(read()), counter, fs.createWriteStream(temp));

      if (written !== sizeBytes || hash.digest('hex') !== sha) {
        await fsp.rm(temp, { force: true });
        return null;
      }
      await fsp.rename(temp, target);
      return target;
    } catch {
      await fsp.rm(temp, { force: true }).catch(() => undefined);
      return null;
    }
  }

  /** Deletes the least recently used copies until `incoming` more bytes fit under the cap. */
  private async makeRoom(incoming: number): Promise<void> {
    const names = await fsp.readdir(this.dir).catch(() => [] as string[]);
    const entries: { file: string; size: number; used: number }[] = [];
    for (const name of names) {
      if (!SHA256.test(name)) continue; // skips .part files still being written
      const file = path.join(this.dir, name);
      const stat = await fsp.stat(file).catch(() => null);
      if (stat) entries.push({ file, size: stat.size, used: stat.mtimeMs });
    }
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    entries.sort((a, b) => a.used - b.used);
    for (const entry of entries) {
      if (total + incoming <= this.maxBytes) break;
      // A phone still reading an unlinked file keeps its open handle on Linux.
      await fsp.rm(entry.file, { force: true }).catch(() => undefined);
      total -= entry.size;
    }
  }
}
