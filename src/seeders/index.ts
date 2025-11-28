// Seed file - Add your seeders here
import { AppDataSource } from '@/loaders/database';

async function runSeeders() {
  console.log('Starting database seeding...');

  try {
    await AppDataSource.initialize();
    console.log('Database connected');

    // Add your seeders here
    // Example:
    // await seedUsers();
    // await seedProducts();

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
