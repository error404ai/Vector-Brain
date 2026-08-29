import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation, UpdateDateColumn } from 'typeorm';
import { AgentTask } from './AgentTask';
import { AndroidDevice } from './AndroidDevice';

export enum AndroidStepStatus {
  PENDING = 'PENDING',
  EXECUTING = 'EXECUTING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

@Entity('android_task_logs')
export class AndroidTaskLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  agent_task_id: number;

  @Column({ type: 'int', nullable: true })
  device_id: number;

  @Column({ type: 'int' })
  step_index: number;

  @Column({ type: 'varchar', length: 50 })
  action_type: string;

  @Column({ type: 'json', nullable: true })
  action_payload: any;

  @Column({ type: 'longtext', nullable: true })
  thought_reasoning: string;

  @Column({ type: 'enum', enum: AndroidStepStatus, default: AndroidStepStatus.PENDING })
  status: AndroidStepStatus;

  @Column({ type: 'longtext', nullable: true })
  screenshot_base64: string;

  @Column({ type: 'json', nullable: true })
  ui_tree_snapshot: any;

  @Column({ type: 'int', default: 0 })
  duration_ms: number;

  @Column({ type: 'longtext', nullable: true })
  result_message: string;

  @Column({ type: 'longtext', nullable: true })
  error_message: string;

  @CreateDateColumn({ type: 'datetime' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updated_at: Date;

  @ManyToOne(() => AgentTask, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_task_id' })
  agentTask: Relation<AgentTask>;

  @ManyToOne(() => AndroidDevice, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'device_id' })
  device: Relation<AndroidDevice>;
}
