import { AppDataSource } from '@/loaders/database';
import { AndroidTaskLog } from '@/entities/AndroidTaskLog';
import { ExperienceLesson } from '@/entities/ExperienceLesson';
import { ExperienceRun } from '@/entities/ExperienceRun';
import { ExperienceSettings } from '@/entities/ExperienceSettings';
import AppError from '@/helpers/AppError';
import Logger from '@/logger/index';
import { generateText, type LanguageModel } from 'ai';
import { In } from 'typeorm';
import { Service } from 'typedi';
import { tagWaste, type StepLite } from '../runDiagnostics';
import {
  LESSON_KINDS,
  MAX_TEXT,
  REFLECT_PROMPT,
  domainOf,
  normalUrl,
  parseLessons,
  provenLessons,
  sameLesson,
  scopesOfRun,
  scoreLesson,
  traceText,
  unsafeText,
  type AgentLesson,
  type DraftLesson,
  type LessonKind,
  type LessonStatus,
  type RunStep,
} from './experience';

/** Lessons handed to one run (all active ones of the account, newest help first). */
const MAX_FOR_RUN = 200;
const MAX_EVIDENCE = 12;
const REFLECT_MAX_MS = 45_000;

/**
 * Experience memory (see experience.ts): what runs learn about sites and apps,
 * handed to the next runs, and scored by how those runs end.
 */
@Service()
export class ExperienceService {
  private lessonRepo = AppDataSource.getRepository(ExperienceLesson);
  private runRepo = AppDataSource.getRepository(ExperienceRun);
  private settingsRepo = AppDataSource.getRepository(ExperienceSettings);
  private logRepo = AppDataSource.getRepository(AndroidTaskLog);

  async settings(userId: number): Promise<{ enabled: boolean; learn: boolean }> {
    const row = await this.settingsRepo.findOne({ where: { user_id: userId } });
    return { enabled: row?.enabled ?? true, learn: row?.learn ?? true };
  }

  async saveSettings(userId: number, input: { enabled?: boolean; learn?: boolean }) {
    const now = await this.settings(userId);
    const next = { user_id: userId, enabled: input.enabled ?? now.enabled, learn: input.learn ?? now.learn };
    await this.settingsRepo.save(this.settingsRepo.create(next));
    return { enabled: next.enabled, learn: next.learn };
  }

  /** The account's active lessons for a run, or [] when memory is off. Never throws. */
  async forRun(userId: number): Promise<AgentLesson[]> {
    try {
      if (!(await this.settings(userId)).enabled) return [];
      const rows = await this.lessonRepo.find({ where: { user_id: userId, status: In(['trusted', 'candidate']) }, order: { helped: 'DESC', id: 'DESC' }, take: MAX_FOR_RUN });
      return rows.map((r) => ({ id: r.id, scope: r.scope, kind: r.kind as LessonKind, text: r.text, status: r.status as LessonStatus, avoidUrl: r.avoid_url }));
    } catch (error) {
      Logger.warn(`[Experience] could not load lessons: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * After a finished run: score the lessons it was shown, then learn from it —
   * dead addresses with no model, the rest with one reflection call on the
   * run's own model. Never throws; never holds the run up.
   */
  async afterRun(input: { userId: number; taskId: number; succeeded: boolean; used: number[]; model: LanguageModel | null; prompt: string }): Promise<void> {
    try {
      const { learn } = await this.settings(input.userId);
      if (input.used.length) await this.score(input.userId, input.used, input.succeeded);
      const learned: number[] = [];
      if (learn) {
        const steps = await this.stepsOf(input.taskId);
        if (steps.length >= 3) {
          const drafts = provenLessons(steps);
          if (input.model) drafts.push(...(await this.reflect(input.model, input.prompt, steps, input.succeeded)));
          for (const draft of drafts) {
            const id = await this.store(input.userId, draft, input.taskId, input.succeeded);
            if (id) learned.push(id);
          }
        }
      }
      if (input.used.length || learned.length) {
        await this.runRepo.save(this.runRepo.create({ task_id: input.taskId, user_id: input.userId, succeeded: input.succeeded, used: input.used, learned }));
      }
    } catch (error) {
      Logger.warn(`[Experience] after run ${input.taskId}: ${(error as Error).message}`);
    }
  }

  private async score(userId: number, ids: number[], succeeded: boolean) {
    const rows = await this.lessonRepo.find({ where: { user_id: userId, id: In(ids) } });
    for (const row of rows) {
      const next = scoreLesson({ status: row.status as LessonStatus, helped: row.helped, hurt: row.hurt, source: row.source }, succeeded);
      const offNow = next.status === 'off' && row.status !== 'off';
      await this.lessonRepo.update(
        { id: row.id },
        { ...next, uses: row.uses + 1, last_used_at: new Date(), ...(offNow ? { off_reason: `Switched off by itself: ${next.hurt} failed runs used it, ${next.helped} succeeded.` } : {}) },
      );
    }
  }

  private async stepsOf(taskId: number): Promise<RunStep[]> {
    const rows = await this.logRepo.find({
      where: { agent_task_id: taskId },
      select: ['id', 'step_index', 'action_type', 'action_payload', 'status', 'result_message', 'error_message', 'package_before', 'package_after', 'screen_before', 'screen_after', 'duration_ms', 'think_ms'],
      order: { step_index: 'ASC', id: 'ASC' },
    });
    const tags = tagWaste(rows as unknown as StepLite[]);
    return rows.map((r, i) => ({
      index: r.step_index,
      tool: r.action_type,
      args: (r.action_payload ?? null) as Record<string, unknown> | null,
      ok: r.status !== 'FAILED',
      result: String(r.result_message ?? r.error_message ?? ''),
      packageAfter: r.package_after ?? null,
      waste: tags[i],
    }));
  }

  private async reflect(model: LanguageModel, prompt: string, steps: RunStep[], succeeded: boolean): Promise<DraftLesson[]> {
    const where = scopesOfRun(steps);
    if (!where.apps.size && !where.domains.size) return [];
    try {
      const { text } = await generateText({
        model,
        system: REFLECT_PROMPT,
        prompt: `TASK: ${prompt.slice(0, 600)}\nOUTCOME: ${succeeded ? 'succeeded (checked by the judge)' : 'did not succeed'}\nSITES AND APPS: ${[...where.domains, ...where.apps].join(', ')}\n\nSTEPS (index tool args → result; [tag] marks a wasted step):\n${traceText(steps)}`,
        maxOutputTokens: 1200,
        temperature: 0,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(REFLECT_MAX_MS),
      });
      return parseLessons(text, { ...where, succeeded });
    } catch (error) {
      Logger.warn(`[Experience] reflection failed: ${(error as Error).message.slice(0, 200)}`);
      return [];
    }
  }

  /** Adds the lesson, or folds it into the same one already known (more evidence; trusted after a second successful run). */
  private async store(userId: number, draft: DraftLesson, taskId: number, succeeded: boolean): Promise<number | null> {
    const existing = await this.lessonRepo.find({ where: { user_id: userId, scope: draft.scope, kind: draft.kind } });
    const same = existing.find((e) => (draft.avoidUrl && e.avoid_url === draft.avoidUrl) || sameLesson(e, draft));
    if (same) {
      const evidence = [...new Set([...(same.evidence ?? []), taskId])].slice(-MAX_EVIDENCE);
      if (evidence.length === (same.evidence ?? []).length) return null;
      const confirmations = evidence.length;
      const promote = same.status === 'candidate' && (succeeded || draft.kind === 'avoid') && confirmations >= 2;
      await this.lessonRepo.update({ id: same.id }, { evidence, ...(promote ? { status: 'trusted' } : {}) });
      return same.id;
    }
    const saved = await this.lessonRepo.save(
      this.lessonRepo.create({
        user_id: userId,
        scope: draft.scope,
        kind: draft.kind,
        text: draft.text.slice(0, MAX_TEXT),
        // A page that answered "not found" is a fact, not an opinion.
        status: draft.avoidUrl ? 'trusted' : 'candidate',
        source: 'auto',
        avoid_url: draft.avoidUrl ?? null,
        evidence: [taskId],
      }),
    );
    return saved.id;
  }

  // ---------- the Experience page ----------

  async overview(userId: number) {
    const [lessons, settings, runs] = await Promise.all([
      this.lessonRepo.find({ where: { user_id: userId }, order: { status: 'DESC', helped: 'DESC', id: 'DESC' }, take: 1000 }),
      this.settings(userId),
      this.runRepo.find({ where: { user_id: userId }, order: { created_at: 'DESC' }, take: 40 }),
    ]);
    const weekAgo = Date.now() - 7 * 86_400_000;
    const week = runs.filter((r) => new Date(r.created_at).getTime() >= weekAgo);
    const scopes = new Map<string, { scope: string; lessons: number; trusted: number; helped: number }>();
    for (const l of lessons) {
      const s = scopes.get(l.scope) ?? { scope: l.scope, lessons: 0, trusted: 0, helped: 0 };
      s.lessons += 1;
      if (l.status === 'trusted') s.trusted += 1;
      s.helped += l.helped;
      scopes.set(l.scope, s);
    }
    const byId = new Map(lessons.map((l) => [l.id, l]));
    const name = (id: number) => byId.get(id)?.text ?? null;
    return {
      settings,
      stats: {
        active: lessons.filter((l) => l.status !== 'off').length,
        trusted: lessons.filter((l) => l.status === 'trusted').length,
        runs_helped_week: week.filter((r) => (r.used ?? []).length && r.succeeded).length,
        runs_with_memory_week: week.filter((r) => (r.used ?? []).length).length,
      },
      scopes: [...scopes.values()].sort((a, b) => b.lessons - a.lessons),
      lessons: lessons.map((l) => ({
        id: l.id,
        scope: l.scope,
        kind: l.kind,
        text: l.text,
        status: l.status,
        source: l.source,
        avoid_url: l.avoid_url,
        helped: l.helped,
        hurt: l.hurt,
        uses: l.uses,
        evidence: l.evidence ?? [],
        off_reason: l.off_reason,
        last_used_at: l.last_used_at,
        created_at: l.created_at,
      })),
      runs: runs.map((r) => ({
        task_id: r.task_id,
        succeeded: r.succeeded,
        created_at: r.created_at,
        used: (r.used ?? []).map((id) => ({ id, text: name(id) })).filter((x) => x.text),
        learned: (r.learned ?? []).map((id) => ({ id, text: name(id) })).filter((x) => x.text),
      })),
    };
  }

  async teach(userId: number, input: { scope?: string; kind?: string; text?: string }) {
    const lesson = this.validInput(input);
    const saved = await this.lessonRepo.save(this.lessonRepo.create({ user_id: userId, ...lesson, status: 'trusted', source: 'user', evidence: [] }));
    return { id: saved.id };
  }

  async update(userId: number, id: number, input: { scope?: string; kind?: string; text?: string; status?: string }) {
    const row = await this.lessonRepo.findOne({ where: { id, user_id: userId } });
    if (!row) throw new AppError('Lesson not found', 404);
    const patch: Partial<ExperienceLesson> = {};
    if (input.text !== undefined || input.kind !== undefined || input.scope !== undefined) {
      const v = this.validInput({ scope: input.scope ?? row.scope, kind: input.kind ?? row.kind, text: input.text ?? row.text });
      Object.assign(patch, v, { source: 'user' });
    }
    if (input.status !== undefined) {
      if (!['candidate', 'trusted', 'off'].includes(input.status)) throw new AppError('status must be trusted, candidate or off', 400);
      patch.status = input.status;
      if (input.status !== 'off') patch.off_reason = null;
      else patch.off_reason = 'Switched off by you.';
    }
    await this.lessonRepo.update({ id }, patch);
    return { id };
  }

  async remove(userId: number, id: number) {
    const res = await this.lessonRepo.delete({ id, user_id: userId });
    if (!res.affected) throw new AppError('Lesson not found', 404);
    return { id };
  }

  private validInput(input: { scope?: string; kind?: string; text?: string }) {
    const text = String(input.text ?? '').replace(/\s+/g, ' ').trim();
    const kind = String(input.kind ?? '').toLowerCase() as LessonKind;
    const rawScope = String(input.scope ?? '').trim().toLowerCase();
    const scope = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){2,}$/.test(rawScope) && !domainOf(`${rawScope}/`) ? rawScope : domainOf(rawScope) ?? (/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(rawScope) ? rawScope : null);
    if (!scope) throw new AppError('Give the site (blogger.com) or the app package (com.instagram.android)', 400);
    if (!LESSON_KINDS.includes(kind)) throw new AppError(`kind must be one of ${LESSON_KINDS.join(', ')}`, 400);
    if (text.length < 8 || text.length > MAX_TEXT) throw new AppError(`Write the lesson in 8 to ${MAX_TEXT} characters`, 400);
    if (unsafeText(text)) throw new AppError('A lesson cannot hold emails, passwords, codes or long numbers', 400);
    const url = kind === 'avoid' ? /(?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}\/\S+/i.exec(text)?.[0] : null;
    return { scope, kind, text, avoid_url: url ? normalUrl(url) : null };
  }
}
