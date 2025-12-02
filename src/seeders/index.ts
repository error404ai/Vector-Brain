// Seed file - Add your seeders here
import { AppDataSource } from '@/loaders/database';
import { userSeed } from './userSeed';

async function runSeeders() {
  console.log('Starting database seeding...');

  try {
    const connection = await AppDataSource.initialize();
    console.log('Database connected');

    // Run seeders
    await userSeed(connection);

    console.log('Seeding completed successfully!');
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  } finally {
    await AppDataSource.destroy();
    process.exit(0);
  }
}

runSeeders();
