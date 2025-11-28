# Vector-Brain

A clean TypeScript Express API starter template with TypeORM and dependency injection.

## Features

- **TypeScript** - Full TypeScript support with path aliases
- **Express** - Fast, minimalist web framework
- **TypeORM** - Powerful ORM for database operations
- **TypeDI** - Dependency injection container
- **routing-controllers** - Decorator-based routing
- **class-validator** - Request validation with decorators
- **MySQL** - MySQL database support (easily changeable)

## Project Structure

```
src/
├── app.ts                 # Application entry point
├── server.ts              # HTTP server setup
├── config/                # Configuration files
│   └── envConfig.ts       # Environment variables
├── controllers/           # Route controllers
├── entities/              # TypeORM entities
├── helpers/               # Utility helpers
├── loaders/               # App initialization loaders
│   └── database.ts        # Database connection
├── logger/                # Logging setup
├── middleware/            # Express middlewares
├── repositories/          # Custom repositories
├── services/              # Business logic services
│   └── controllerService/ # Service layer
├── types/                 # TypeScript type definitions
└── validations/           # Request DTOs/validators
```

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- MySQL database

### Installation

1. Clone the repository
2. Install dependencies:

   ```bash
   npm install
   ```

3. Configure environment variables:

   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

4. Sync database schema:

   ```bash
   npm run db:sync
   ```

5. Start development server:
   ```bash
   npm run dev
   ```

The API will be available at `http://localhost:3000/api`

## Available Scripts

| Script                     | Description                              |
| -------------------------- | ---------------------------------------- |
| `npm run dev`              | Start development server with hot-reload |
| `npm run build`            | Build for production                     |
| `npm start`                | Start production server                  |
| `npm run db:sync`          | Sync database schema                     |
| `npm run db:drop`          | Drop all tables                          |
| `npm run db:fresh`         | Drop, sync, and seed database            |
| `npm run migrate:generate` | Generate migration from entity changes   |
| `npm run migrate:run`      | Run pending migrations                   |
| `npm run lint`             | Run ESLint                               |
| `npm run format`           | Format code with Prettier                |

## API Endpoints

### Health Check

- `GET /api/health` - Server health status
- `GET /api/health/ready` - Readiness check

### Users (Example CRUD)

- `GET /api/users` - List all users
- `GET /api/users/:id` - Get user by ID
- `POST /api/users` - Create user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

## Adding New Features

### 1. Create an Entity

```typescript
// src/entities/Product.ts
@Entity('products')
export class Product {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;
}
```

### 2. Create a Service

```typescript
// src/services/controllerService/ProductService.ts
@Service()
export class ProductService {
  private repo = AppDataSource.getRepository(Product);

  async findAll() {
    return this.repo.find();
  }
}
```

### 3. Create a Controller

```typescript
// src/controllers/ProductController.ts
@JsonController('/products')
@Service()
export class ProductController {
  constructor(private productService: ProductService) {}

  @Get('/')
  async getAll() {
    return this.productService.findAll();
  }
}
```

### 4. Register the Controller

Add your controller to `src/app.ts`:

```typescript
import { ProductController } from './controllers/ProductController';

// In useExpressServer controllers array:
controllers: [
  HealthController,
  UserController,
  ProductController,  // Add here
],
```

## License

MIT
