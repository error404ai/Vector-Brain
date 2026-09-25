import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type LandingShotKind = 'phone' | 'page';
export type LandingShotSource = 'capture' | 'mission' | 'page';

/**
 * A screenshot kept for the public landing page: a phone's full-resolution
 * screen, or a capture of one of the app's own pages. Admins capture them,
 * pick a slot and approve; only approved shots are served publicly.
 */
@Entity('landing_shots')
@Index('IDX_landing_shot_slot', ['approved', 'slot'])
export class LandingShot {
  @PrimaryGeneratedColumn()
  id: number;

  /** The admin who captured it. */
  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'varchar', length: 8 })
  kind: LandingShotKind;

  @Column({ type: 'varchar', length: 10 })
  source: LandingShotSource;

  /** android_devices.id for phone shots. */
  @Column({ type: 'int', nullable: true })
  device_id: number | null;

  /** Phone name and model, or the page's title, shown under the image. */
  @Column({ type: 'varchar', length: 150 })
  label: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  device_model: string | null;

  @Column({ type: 'int', nullable: true })
  mission_id: number | null;

  @Column({ type: 'varchar', length: 12 })
  mime: string;

  @Column({ type: 'int', default: 0 })
  width: number;

  @Column({ type: 'int', default: 0 })
  height: number;

  @Column({ type: 'int', default: 0 })
  size_bytes: number;

  @Column({ type: 'mediumblob', select: false })
  image: Buffer;

  /** Where the landing page uses it (hero-1, step-2, run-4, fleet, app…); null = unassigned. */
  @Column({ type: 'varchar', length: 12, nullable: true })
  slot: string | null;

  @Column({ type: 'boolean', default: false })
  approved: boolean;

  @CreateDateColumn()
  created_at: Date;
}
