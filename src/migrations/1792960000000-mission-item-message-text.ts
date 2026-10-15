import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A phone's result on a mission was cut at 500 characters (varchar 500): a long
 * answer (three products with prices, a list of settings) lost its end on the
 * card. The column becomes TEXT; failures are still kept short in code.
 */
export class MissionItemMessageText1792960000000 implements MigrationInterface {
  name = 'MissionItemMessageText1792960000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `mission_items` MODIFY `last_message` TEXT NULL');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('UPDATE `mission_items` SET `last_message` = LEFT(`last_message`, 500) WHERE CHAR_LENGTH(`last_message`) > 500');
    await queryRunner.query('ALTER TABLE `mission_items` MODIFY `last_message` VARCHAR(500) NULL');
  }
}
