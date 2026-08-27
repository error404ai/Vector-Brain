// Seed file - Add your seeders here
import { AppDataSource } from '@/loaders/database';
import { aiRuleSeed } from './aiRuleSeed';
import { userSeed } from './userSeed';

const seeders = {
  user: userSeed,
  aiRule: aiRuleSeed,
};

async function runSeeders(seederName?: string) {
  console.log('Starting database seeding...');

  try {
    const connection = await AppDataSource.initialize();
    console.log('Database connected');

    if (seederName) {
      if (!seeders[seederName as keyof typeof seeders]) {
        console.error(`Seeder '${seederName}' not found. Available seeders: ${Object.keys(seeders).join(', ')}`);
        process.exit(1);
      }
      console.log(`Running seeder: ${seederName}`);
      await seeders[seederName as keyof typeof seeders](connection);
      console.log(`Seeder '${seederName}' completed successfully!`);
    } else {
      // Run all seeders
      console.log('Running all seeders...');
      for (const [name, seeder] of Object.entries(seeders)) {
        console.log(`Running seeder: ${name}`);
        await seeder(connection);
      }
      console.log('All seeders completed successfully!');
    }
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  } finally {
    await AppDataSource.destroy();
    process.exit(0);
  }
}

const seederName = process.argv[2];

if (seederName === '--help' || seederName === '-h') {
  console.log('Usage: npm run db:seed [seeder-name]');
  console.log('Run all seeders: npm run db:seed');
  console.log('Run single seeder: npm run db:seed -- <seeder-name>');
  console.log('Available seeders:', Object.keys(seeders).join(', '));
  process.exit(0);
}

void runSeeders(seederName);
