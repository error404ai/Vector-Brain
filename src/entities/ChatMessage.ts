import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('chat_messages')
export class ChatMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  user_id: number;

  /** 'user' for what was typed, 'assistant' for Vector's reply. */
  @Column({ type: 'varchar', length: 10 })
  role: 'user' | 'assistant';

  @Column({ type: 'text' })
  text: string;

  /** The full reply as sent to the browser (kind, mission snapshot, ...). */
  @Column({ type: 'longtext', nullable: true })
  reply: string | null;

  @Column({ type: 'int', nullable: true })
  mission_id: number | null;

  @CreateDateColumn()
  created_at: Date;
}
