// Seed file - Add your seeders here
import { User } from '@/entities/User';
import { CryptoHelper } from '@/helpers/CryptoHelper';
import { AppDataSource } from '@/loaders/database';

async function seedUsers() {
  const userRepository = AppDataSource.getRepository(User);

  // Check if admin user already exists
  const existingUser = await userRepository.findOne({
    where: { email: 'admin@vectorbrain.com' },
  });

  if (existingUser) {
    console.log('Admin user already exists, skipping...');
    return;
  }

  // Create admin user with hashed password
  const adminUser = userRepository.create({
    name: 'Admin User',
    email: 'admin@vectorbrain.com',
    password: CryptoHelper.generateHash('password123'),
    phone: '+1234567890',
    isActive: true,
  });

  await userRepository.save(adminUser);
  console.log('Admin user created successfully');
  console.log('Email: admin@vectorbrain.com');
  console.log('Password: password123');
}

async function runSeeders() {
  console.log('Starting database seeding...');

  try {
    await AppDataSource.initialize();
    console.log('Database connected');

    // Run seeders
    await seedUsers();

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
