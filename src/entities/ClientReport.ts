import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * What a browser reported about itself: a page that died without closing, a
 * loader that never finished, a JS or render error. Written by the web app's
 * diagnostics reporter so browser-side failures can be seen instead of guessed.
 */
@Entity('client_reports')
@Index('IDX_client_reports_created', ['created_at'])
export class ClientReport {
  @PrimaryGeneratedColumn()
  id: number;

  /** Null when the browser had no session yet (e.g. a report sent while the app was still booting). */
  @Column({ type: 'int', nullable: true })
  user_id: number | null;

  /** unclean_exit | stuck_loader | js_error | unhandled_rejection | render_error */
  @Column({ type: 'varchar', length: 32 })
  kind: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  page: string | null;

  /** Random per browser tab, so several reports from one incident can be tied together. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  tab_id: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  user_agent: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  app_version: string | null;

  @Column({ type: 'json', nullable: true })
  payload: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'datetime' })
  created_at: Date;
}
