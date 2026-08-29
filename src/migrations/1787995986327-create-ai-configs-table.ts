import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAiConfigsTable1787995986327 implements MigrationInterface {
    name = 'CreateAiConfigsTable1787995986327'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`ai_configs\` (\`id\` int NOT NULL AUTO_INCREMENT, \`user_id\` int NOT NULL, \`provider\` enum ('openai', 'google', 'anthropic', 'deepseek', 'groq', 'openrouter', 'custom') NOT NULL DEFAULT 'openai', \`model\` varchar(150) NOT NULL, \`encrypted_api_key\` text NOT NULL, \`base_url\` varchar(500) NULL, \`is_active\` tinyint NOT NULL DEFAULT 1, \`label\` varchar(150) NULL, \`config_type\` enum ('text', 'vision') NOT NULL DEFAULT 'vision', \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`IDX_6396f0d24931ed2fe420cb9ce9\` (\`user_id\`, \`is_active\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`ai_configs\` ADD CONSTRAINT \`FK_6b37dacc4bb9d4dd3b4f78b2cb1\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`ai_configs\` DROP FOREIGN KEY \`FK_6b37dacc4bb9d4dd3b4f78b2cb1\``);
        await queryRunner.query(`DROP INDEX \`IDX_6396f0d24931ed2fe420cb9ce9\` ON \`ai_configs\``);
        await queryRunner.query(`DROP TABLE \`ai_configs\``);
    }

}
