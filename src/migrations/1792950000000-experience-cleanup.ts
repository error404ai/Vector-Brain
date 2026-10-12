import { MigrationInterface, QueryRunner } from 'typeorm';
import { sameLesson } from '../services/android/experience/experience';

interface Row {
  id: number;
  user_id: number;
  scope: string;
  kind: string;
  text: string;
  status: string;
  source: string;
  evidence: string | number[] | null;
}

const SWIPE_BUG = /(swip|scroll)/i;
const DOES_NOTHING = /(does not|doesn['’]t|does nothing|not advance|cannot be used|stays on the same|no effect|nothing happens|wastes? steps)/i;

/**
 * Experience memory, first clean-up (Oct 13):
 * - lessons that swipes "do nothing" came from our own swipe bug (directions were
 *   flipped on the way to the phone) and are switched off;
 * - lessons learned only by runs that did not succeed become "unverified" (not shown
 *   to the agent until a successful run teaches the same);
 * - the same lesson saved under two types is merged into one.
 */
export class ExperienceCleanup1792950000000 implements MigrationInterface {
  name = 'ExperienceCleanup1792950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: Row[] = await queryRunner.query("SELECT id, user_id, scope, kind, text, status, source, evidence FROM experience_lessons WHERE source = 'auto' AND status <> 'off'");
    if (!rows.length) return;
    const evidenceOf = (r: Row): number[] => {
      if (Array.isArray(r.evidence)) return r.evidence;
      try {
        return JSON.parse(String(r.evidence ?? '[]')) as number[];
      } catch {
        return [];
      }
    };
    const allTasks = [...new Set(rows.flatMap(evidenceOf))];
    const succeeded = new Set<number>();
    if (allTasks.length) {
      const done: { id: number }[] = await queryRunner.query(`SELECT id FROM agent_tasks WHERE status = 'SUCCEEDED' AND id IN (${allTasks.map(() => '?').join(',')})`, allTasks);
      for (const t of done) succeeded.add(Number(t.id));
    }

    const live: Row[] = [];
    for (const r of rows) {
      if (SWIPE_BUG.test(r.text) && DOES_NOTHING.test(r.text)) {
        await queryRunner.query("UPDATE experience_lessons SET status = 'off', off_reason = ? WHERE id = ?", [
          'Switched off: learned from a swipe bug in Vector (fixed 13 Oct), not from the app itself.',
          r.id,
        ]);
        continue;
      }
      if (r.status !== 'trusted' && !evidenceOf(r).some((id) => succeeded.has(id))) {
        await queryRunner.query("UPDATE experience_lessons SET status = 'unverified' WHERE id = ?", [r.id]);
        r.status = 'unverified';
      }
      live.push(r);
    }

    // The same lesson under two types: keep the one with the most evidence, fold the others in.
    const gone = new Set<number>();
    for (const a of live) {
      if (gone.has(a.id)) continue;
      for (const b of live) {
        if (a.id === b.id || gone.has(b.id) || a.user_id !== b.user_id || !sameLesson(a, b)) continue;
        const [keep, drop] = evidenceOf(a).length >= evidenceOf(b).length ? [a, b] : [b, a];
        const evidence = [...new Set([...evidenceOf(keep), ...evidenceOf(drop)])].slice(-12);
        await queryRunner.query('UPDATE experience_lessons SET evidence = ? WHERE id = ?', [JSON.stringify(evidence), keep.id]);
        keep.evidence = evidence;
        await queryRunner.query("UPDATE experience_lessons SET status = 'off', off_reason = ? WHERE id = ?", [`Merged into lesson #${keep.id} (the same lesson).`, drop.id]);
        gone.add(drop.id);
        if (drop.id === a.id) break;
      }
    }
  }

  public async down(): Promise<void> {
    // A clean-up; nothing to undo.
  }
}
