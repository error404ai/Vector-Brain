import { MigrationInterface, QueryRunner } from 'typeorm';

export class SharedFrameActions1788700000000 implements MigrationInterface {
  name = 'SharedFrameActions1788700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('shared_run_frames');
    if (!table) return;

    // Captions built from the agent's raw thought read like an internal
    // monologue. Keeping the action lets the public page write a short line
    // ("Tapped the address bar") and draw the tap where it happened.
    if (!table.findColumnByName('action_type')) {
      await queryRunner.query(`ALTER TABLE \`shared_run_frames\` ADD \`action_type\` varchar(60) NULL`);
    }
    if (!table.findColumnByName('action_payload')) {
      await queryRunner.query(`ALTER TABLE \`shared_run_frames\` ADD \`action_payload\` json NULL`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('shared_run_frames');
    if (!table) return;

    if (table.findColumnByName('action_payload')) {
      await queryRunner.query(`ALTER TABLE \`shared_run_frames\` DROP COLUMN \`action_payload\``);
    }
    if (table.findColumnByName('action_type')) {
      await queryRunner.query(`ALTER TABLE \`shared_run_frames\` DROP COLUMN \`action_type\``);
    }
  }
}
