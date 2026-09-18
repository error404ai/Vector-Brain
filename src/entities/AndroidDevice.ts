import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation, UpdateDateColumn } from 'typeorm';
import { User } from './User';

export enum AndroidDeviceStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  BUSY = 'BUSY',
}

@Entity('android_devices')
export class AndroidDevice {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'varchar', length: 100, unique: true })
  device_id: string;

  @Column({ type: 'varchar', length: 150 })
  device_name: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  device_model: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  android_version: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  pairing_code: string | null;

  @Column({ type: 'datetime', nullable: true })
  pairing_expires_at: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  device_token: string | null;

  /**
   * A short note the user attaches to this phone.
   *
   * Free text rather than a fixed list: what people need to remember about a
   * handset — which account is signed in, what it is being used for, that its
   * battery is going — is not something the product can enumerate for them.
   */
  @Column({ type: 'varchar', length: 40, nullable: true })
  tag: string | null;

  /**
   * The proxy lane this phone sits on, if any.
   *
   * Null means the device does not go through a proxy and is never queued or
   * rotated — the behaviour every device has today.
   */
  @Column({ type: 'int', nullable: true })
  proxy_id: number | null;

  @Column({ type: 'enum', enum: AndroidDeviceStatus, default: AndroidDeviceStatus.OFFLINE })
  status: AndroidDeviceStatus;

  @Column({ type: 'datetime', nullable: true })
  last_seen_at: Date | null;

  @Column({ type: 'json', nullable: true })
  capabilities: {
    accessibility: boolean;
    screenCapture: boolean;
    screenWidth?: number;
    screenHeight?: number;
  } | null;

  @CreateDateColumn({ type: 'datetime' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updated_at: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;
}
