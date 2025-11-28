import dotenv from 'dotenv';
dotenv.config();

const requiredEnv = ['PORT', 'MYSQLHOST', 'MYSQLUSERNAME', 'MYSQLPASSWORD', 'DATABASE', 'JWT_SECRET'];

const missing = [];
const values: Record<string, string> = {};

for (const name of requiredEnv) {
  const val = process.env[name];
  if (val === undefined || val === null || String(val).trim() === '') {
    missing.push(name);
  } else {
    values[name] = val;
  }
}

if (missing.length > 0) {
  const lines = missing.map((n) => `- ${n}: required. Add to your .env (e.g. ${n}=...) or your deployment environment.`).join('\n');
  throw new Error(`Missing required environment variables:\n${lines}\n\nModule: src/config/envConfig.ts`);
}

const envConfig = {
  // App
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  appName: process.env.APP_NAME || 'Vector-Brain',
  port: process.env.PORT || '3000',
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database
  mysqlHost: process.env.MYSQLHOST,
  mysqlPort: Number(process.env.MYSQLPORT ?? 3306),
  mysqlUsername: process.env.MYSQLUSERNAME,
  mysqlPassword: process.env.MYSQLPASSWORD,
  database: process.env.DATABASE,
  synchronize: process.env.DBSYNC === 'true',

  // JWT
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiry: process.env.JWT_EXPIRY || '7d',
  jwtAlgorithm: process.env.JWT_ALGORITHM || 'HS256',

  // AWS (optional)
  awsRegion: process.env.AWS_REGION || 'us-east-1',
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
  awsSecretKey: process.env.AWS_SECRET_KEY,

  // Email (optional)
  emailProvider: (process.env.EMAIL_PROVIDER as 'aws' | 'smtp') || 'smtp',
  mailFromName: process.env.MAIL_FROM_NAME || 'Vector-Brain',
  mailFromAddress: process.env.MAIL_FROM_ADDRESS || 'noreply@example.com',
  smtpAuthHost: process.env.SMTP_AUTH_HOST,
  smtpMailPort: parseInt(process.env.SMTP_MAIL_PORT || '587'),
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpAuthUser: process.env.SMTP_AUTH_USER,
  smtpAuthPass: process.env.SMTP_AUTH_PASS,
};

export default envConfig;
