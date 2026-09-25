import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One phone's screen as it looked when Vector showed it in the chat.
 *
 * Kept apart from chat_messages so a history load stays small: the stored
 * reply only carries each shot's id, and the browser fetches an image when
 * its tile scrolls into view. Swept after a few days.
 */
@Entity('chat_screen_shots')
@Index('IDX_chat_screen_user_created', ['user_id', 'created_at'])
export class ChatScreenShot {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  user_id: number;

  /** The thread it was shown in, so deleting a chat deletes its screens. */
  @Column({ type: 'int', nullable: true })
  conversation_id: number | null;

  @Column({ type: 'varchar', length: 150 })
  device_name: string;

  /** Base64 JPEG preview frame. */
  @Column({ type: 'mediumtext', select: false })
  image: string;

  @CreateDateColumn()
  created_at: Date;
}
