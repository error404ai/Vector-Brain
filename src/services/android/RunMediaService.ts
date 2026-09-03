import { AgentTask } from '@/entities/AgentTask';
import { SharedRunFrame } from '@/entities/SharedRunFrame';
import Logger from '@/logger/index';
import { AppDataSource } from '@/loaders/database';
import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Repository } from 'typeorm';
import { Service } from 'typedi';

const run = promisify(execFile);

/**
 * Rendered media lives in the container's temp space, not a mounted volume: the
 * frames themselves are in the database, so anything here can be rebuilt after a
 * redeploy. First request pays the render cost, later ones are served from disk.
 */
const CACHE_DIR = '/tmp/vector-brain-media';

/** Seconds each frame is held in the rendered video. */
const SECONDS_PER_FRAME = 1.1;

const FONT = '/usr/share/fonts/ttf-dejavu/DejaVuSans-Bold.ttf';

@Service()
export class RunMediaService {
  private taskRepo: Repository<AgentTask> = AppDataSource.getRepository(AgentTask);
  private frameRepo: Repository<SharedRunFrame> = AppDataSource.getRepository(SharedRunFrame);
  /** Renders in flight, so ten simultaneous viewers cause one ffmpeg run. */
  private pending = new Map<string, Promise<string | null>>();

  /** Absolute-path MP4 for a shared run, rendering it if needed. */
  async getVideoPath(token: string): Promise<string | null> {
    return this.withCache(`${token}.mp4`, (dir, frames, task) => this.renderVideo(dir, frames, task));
  }

  /** Absolute-path 1200x630 JPEG used as the link preview image. */
  async getPreviewPath(token: string): Promise<string | null> {
    return this.withCache(`${token}.jpg`, (dir, frames, task) => this.renderPreview(dir, frames, task));
  }

  /** Prompt and outcome for the meta tags, without exposing anything private. */
  async getMeta(token: string): Promise<{ prompt: string; steps: number; success: boolean } | null> {
    const task = await this.taskRepo.findOne({ where: { share_token: token } });
    if (!task) return null;
    return { prompt: task.prompt, steps: task.total_steps, success: task.success };
  }

  private async withCache(
    fileName: string,
    render: (workDir: string, frames: SharedRunFrame[], task: AgentTask) => Promise<void>,
  ): Promise<string | null> {
    const outPath = join(CACHE_DIR, fileName);
    if (existsSync(outPath)) return outPath;

    const inFlight = this.pending.get(fileName);
    if (inFlight) return inFlight;

    const token = fileName.replace(/\.(mp4|jpg)$/, '');
    const job = (async () => {
      const task = await this.taskRepo.findOne({ where: { share_token: token } });
      if (!task) return null;

      const frames = await this.frameRepo.find({
        where: { agent_task_id: task.id },
        order: { step_index: 'ASC' },
      });
      if (frames.length === 0) return null;

      const workDir = join(CACHE_DIR, `work-${token}-${Date.now()}`);
      await mkdir(workDir, { recursive: true });
      await mkdir(CACHE_DIR, { recursive: true });

      try {
        await render(workDir, frames, task);
        return existsSync(outPath) ? outPath : null;
      } catch (error) {
        Logger.warn(`[RunMedia] Failed to render ${fileName}`, error);
        return null;
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      }
    })().finally(() => {
      this.pending.delete(fileName);
    });

    this.pending.set(fileName, job);
    return job;
  }

  /** Write every frame to disk as jpg so ffmpeg can read them as a sequence. */
  private async writeFrames(workDir: string, frames: SharedRunFrame[]): Promise<void> {
    let position = 0;
    for (const frame of frames) {
      const raw = frame.image_base64.replace(/^data:image\/\w+;base64,/, '');
      await writeFile(join(workDir, `f${String(position).padStart(4, '0')}.jpg`), Buffer.from(raw, 'base64'));
      position += 1;
    }
  }

  private async renderVideo(workDir: string, frames: SharedRunFrame[], task: AgentTask): Promise<void> {
    await this.writeFrames(workDir, frames);
    const outPath = join(CACHE_DIR, `${task.share_token}.mp4`);

    // Even dimensions and yuv420p are what make the file play everywhere,
    // including WhatsApp and older mobile players.
    await run(
      'ffmpeg',
      [
        '-y',
        '-framerate', String(1 / SECONDS_PER_FRAME),
        '-i', join(workDir, 'f%04d.jpg'),
        '-vf', 'scale=540:-2,format=yuv420p,fps=25',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-movflags', '+faststart',
        outPath,
      ],
      { timeout: 120_000, maxBuffer: 1024 * 1024 * 8 },
    );
  }

  /**
   * Social preview: dark card with the phone screen on the left and the prompt
   * on the right, so a pasted link reads as a demo rather than a bare URL.
   */
  private async renderPreview(workDir: string, frames: SharedRunFrame[], task: AgentTask): Promise<void> {
    const chosen = pickPreviewFrame(frames);
    const raw = chosen.image_base64.replace(/^data:image\/\w+;base64,/, '');
    const framePath = join(workDir, 'first.jpg');
    await writeFile(framePath, Buffer.from(raw, 'base64'));

    const outPath = join(CACHE_DIR, `${task.share_token}.jpg`);
    const lines = wrapText(task.prompt, 26, 3);

    const textFilters = lines
      .map((line, i) => `drawtext=fontfile=${FONT}:text='${escapeDrawText(line)}':fontcolor=white:fontsize=46:x=520:y=${210 + i * 60}`)
      .join(',');

    const captionFilter = `drawtext=fontfile=${FONT}:text='${escapeDrawText('Done by an AI on a real Android phone')}':fontcolor=0xa78bfa:fontsize=28:x=520:y=${210 + lines.length * 60 + 24}`;
    const brandFilter = `drawtext=fontfile=${FONT}:text='Vector Brain':fontcolor=0x8b5cf6:fontsize=30:x=520:y=120`;

    await run(
      'ffmpeg',
      [
        '-y',
        '-i', framePath,
        '-vf',
        [
          'scale=-2:520',
          'pad=1200:630:80:55:color=0x0b1020',
          brandFilter,
          textFilters,
          captionFilter,
        ].join(','),
        '-frames:v', '1',
        '-q:v', '3',
        outPath,
      ],
      { timeout: 60_000, maxBuffer: 1024 * 1024 * 8 },
    );
  }
}

/**
 * Pick the frame that best sells the run.
 *
 * The first frame is usually an empty app that has just launched, which says
 * nothing. The end of the run is where the result is on screen — but agents
 * often press HOME or BACK last, which lands on the launcher. So walk back from
 * the end and take the last frame that was not a navigation key press.
 */
function pickPreviewFrame(frames: SharedRunFrame[]): SharedRunFrame {
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i].action_type !== 'global_action') return frames[i];
  }
  return frames[frames.length - 1];
}

/** Split a prompt into at most `maxLines` lines of roughly `width` characters. */
function wrapText(text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, width - 1)}…`;
  }
  return lines.length > 0 ? lines : ['Automated run'];
}

/** ffmpeg's drawtext treats these as syntax, so they have to be escaped. */
function escapeDrawText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/[\r\n]+/g, ' ');
}
