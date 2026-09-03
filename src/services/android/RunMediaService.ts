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
 *
 * Only the social preview image is produced here. Rendering runs to MP4 was
 * tried and removed: H.264 encoding pushed this VPS close to its memory ceiling,
 * and the replay on the page covers the same ground for free.
 */
const CACHE_DIR = '/tmp/vector-brain-media';

const FONT = '/usr/share/fonts/ttf-dejavu/DejaVuSans-Bold.ttf';

@Service()
export class RunMediaService {
  private taskRepo: Repository<AgentTask> = AppDataSource.getRepository(AgentTask);
  private frameRepo: Repository<SharedRunFrame> = AppDataSource.getRepository(SharedRunFrame);
  /** Renders in flight, so ten simultaneous viewers cause one ffmpeg run. */
  private pending = new Map<string, Promise<string | null>>();

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
    const lines = wrapText(task.prompt, 22, 3);

    const promptFilters = lines
      .map(
        (line, i) =>
          `drawtext=fontfile=${FONT}:text='${escapeDrawText(line)}':fontcolor=white:fontsize=58:x=560:y=${188 + i * 70}`,
      )
      .join(',');

    const stats = `${task.total_steps} steps  ${Math.max(1, Math.round(task.total_duration_seconds))}s  fully automated`;
    const statsY = 188 + lines.length * 70 + 26;

    const overlays = [
      // Brand strip
      `drawtext=fontfile=${FONT}:text='VECTOR BRAIN':fontcolor=white:fontsize=30:x=560:y=110`,
      promptFilters,
      `drawtext=fontfile=${FONT}:text='${escapeDrawText(stats)}':fontcolor=0xf5d0fe:fontsize=30:x=560:y=${statsY}`,
      // Pill that reads as a play button
      `drawbox=x=560:y=${statsY + 62}:w=300:h=64:color=white@0.16:t=fill`,
      `drawtext=fontfile=${FONT}:text='Watch the replay':fontcolor=white:fontsize=30:x=590:y=${statsY + 80}`,
    ]
      .filter(Boolean)
      .join(',');

    // A bright gradient reads far better in a feed than a flat dark card. The
    // gradients source needs a recent ffmpeg, so fall back to a solid fill if
    // this build does not have it.
    const gradientArgs = (background: string[]) => [
      '-y',
      ...background,
      '-i', framePath,
      '-filter_complex',
      `[1:v]scale=-2:520[phone];[0:v][phone]overlay=90:55[bg];[bg]${overlays}[out]`,
      '-map', '[out]',
      '-frames:v', '1',
      '-q:v', '3',
      outPath,
    ];

    try {
      await run(
        'ffmpeg',
        gradientArgs([
          '-f', 'lavfi',
          '-i', 'gradients=s=1200x630:c0=0x7c3aed:c1=0xdb2777:x0=0:y0=0:x1=1200:y1=630:duration=1',
        ]),
        { timeout: 60_000, maxBuffer: 1024 * 1024 * 8 },
      );
    } catch {
      await run('ffmpeg', gradientArgs(['-f', 'lavfi', '-i', 'color=c=0x7c3aed:s=1200x630']), {
        timeout: 60_000,
        maxBuffer: 1024 * 1024 * 8,
      });
    }
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
