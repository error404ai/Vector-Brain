import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation, UpdateDateColumn } from 'typeorm';
import { User } from './User';

/**
 * Connects one Vector account to one private Telegram chat.
 *
 * A row is created when the user asks the dashboard for a link code; chat_id is
 * filled in once that code is sent to the bot.
 */
@Entity('telegram_links')
export class TelegramLink {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', unique: true })
  user_id: number;

  /** Telegram chat ids exceed 32 bits, so they are kept as text. */
  @Column({ type: 'varchar', length: 32, nullable: true, unique: true })
  chat_id: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  telegram_username: string | null;

  /** Device /run uses when no device number is given. */
  @Column({ type: 'int', nullable: true })
  default_device_id: number | null;

  @Column({ type: 'varchar', length: 16, nullable: true, unique: true })
  link_code: string | null;

  @Column({ type: 'datetime', nullable: true })
  link_code_expires_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  linked_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;
}
