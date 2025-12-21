import { Column, Entity, Index, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('settings')
@Index('UQ_settings_unique_constraint', ['organization_id', 'key', 'group'], {
  unique: true
})
export default class Setting {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', default: 1 })
  organization_id: number;

  @Column({ nullable: false })
  group: string;

  @Column({ type: 'varchar', length: 100 })
  key: string;

  @Column({ type: 'varchar' })
  value: string;

  @Column({ type: 'enum', enum: ['string', 'boolean', 'json'], default: 'string' })
  value_type: 'string' | 'boolean' | 'json';

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}