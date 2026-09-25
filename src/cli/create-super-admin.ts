import 'dotenv/config';
import * as readline from 'node:readline';
import { Role, User } from '../entities/User';
import { CryptoHelper } from '../helpers/CryptoHelper';
import { AppDataSource } from '../loaders/database';

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

function promptPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');

    let password = '';
    stdin.on('data', function handler(input: string) {
      for (const ch of input) {
        if (ch === '\n' || ch === '\r' || ch === '\u0003') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', handler);
          process.stdout.write('\n');
          resolve(password);
          return;
        } else if (ch === '\u007f') {
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else {
          password += ch;
          process.stdout.write('*');
        }
      }
    });
  });
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let email: string;
  let name: string;

  try {
    email = (await prompt(rl, 'Email: ')).trim().toLowerCase();
    name = (await prompt(rl, 'Name: ')).trim();
  } finally {
    rl.close();
  }

  const password = await promptPassword('Password: ');
  const confirmPassword = await promptPassword('Confirm Password: ');

  if (!email || !password) {
    console.error('Email and password are required.');
    process.exit(1);
  }

  if (password !== confirmPassword) {
    console.error('Passwords do not match.');
    process.exit(1);
  }

  await AppDataSource.initialize();

  try {
    const userRepository = AppDataSource.getRepository(User);
    const existing = await userRepository.findOne({
      where: { email },
      withDeleted: true,
    });

    if (existing) {
      console.error(`User with email "${email}" already exists.`);
      process.exit(1);
    }

    const admin = userRepository.create({
      email,
      name: name || 'Admin',
      password: await CryptoHelper.hashPassword(password),
      role: Role.ADMIN,
      isActive: true,
    });

    await userRepository.save(admin);
    console.log(`Admin created successfully: ${admin.email}`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
