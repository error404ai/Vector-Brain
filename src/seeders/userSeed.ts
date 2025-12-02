import { User } from '@/entities/User';
import { CryptoHelper } from '@/helpers/CryptoHelper';
import { DataSource } from 'typeorm';

export const userSeed = async (connection: DataSource) => {
  // Demo user data
  const userData: Partial<User>[] = [
    {
      name: 'Admin',
      email: 'admin@gmail.com',
      password: CryptoHelper.generateHash('password123'),
      phone: '+1234567890',
      isActive: true,
    },
  ];

  // Seed User data
  const userRepo = connection.getRepository(User);
  const userCount = await userRepo.count();
  if (userCount < 1) {
    await userRepo.save(userData);
    console.log('✅ User seed data has been added!');
  }
};
