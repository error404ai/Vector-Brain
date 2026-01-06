# Vector-Brain

A full-stack TypeScript monorepo with Express.js backend and React frontend.

## Features

### Backend

- **TypeScript** - Full TypeScript support with path aliases
- **Express** - Fast, minimalist web framework
- **TypeORM** - Powerful ORM for database operations
- **TypeDI** - Dependency injection container
- **routing-controllers** - Decorator-based routing
- **class-validator** - Request validation with decorators
- **MySQL** - MySQL database support (easily changeable)

### Frontend

- **React 18** - Modern React with hooks
- **Vite** - Lightning-fast build tool
- **TypeScript** - Type-safe frontend development
- **React Router** - Client-side routing
- **Tailwind CSS** - Utility-first CSS framework (optional)

## Project Structure

```
Vector-Brain/
├── frontend/                 # React + Vite frontend
│   ├── src/
│   │   ├── pages/           # React pages
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
├── src/                      # Express.js backend
│   ├── app.ts               # Application entry point
│   ├── config/              # Configuration files
│   ├── controllers/         # Route controllers
│   ├── entities/            # TypeORM entities
│   ├── helpers/             # Utility helpers
│   ├── loaders/             # App initialization loaders
│   ├── logger/              # Logging setup
│   ├── middleware/          # Express middlewares
│   ├── repositories/        # Custom repositories
│   ├── services/            # Business logic services
│   ├── types/               # TypeScript type definitions
│   └── validations/         # Request DTOs/validators
├── public/                  # Built frontend (generated)
└── package.json             # Root package.json
```

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- MySQL database

### Installation

1. Clone the repository
2. Install all dependencies (backend + frontend):

   ```bash
   npm run install:all
   ```

   Or install separately:

   ```bash
   # Backend only
   npm install

   # Frontend only
   npm run install:frontend
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

5. Start development servers:
   ```bash
   npm run dev
   ```

The backend API will be available at `http://localhost:3000/api`  
The frontend will be available at `http://localhost:5173`

## Development Workflow

### Run Both Frontend and Backend

```bash
npm run dev
```

This starts:

- Backend on `http://localhost:3000`
- Frontend on `http://localhost:5173` (with API proxy)

### Run Separately

```bash
# Backend only
npm run dev:backend

# Frontend only
npm run dev:frontend
```

## Production Build

Build the entire application:

```bash
npm run build:all
```

This will:

1. Build backend TypeScript to `dist/`
2. Build frontend React app to `public/`

Start production server:

```bash
npm start
```

The server serves:

- API endpoints at `/api/*`
- Frontend static files for all other routes

## Routing

- **`/api/*`** - Backend API endpoints
- **`/*`** - Frontend React app (all other routes)

## Available Scripts

| Script                     | Description                                   |
| -------------------------- | --------------------------------------------- |
| `npm run dev`              | Start both backend & frontend dev servers     |
| `npm run dev:backend`      | Start backend development server only         |
| `npm run dev:frontend`     | Start frontend development server only        |
| `npm run build`            | Build backend for production                  |
| `npm run build:frontend`   | Build frontend for production                 |
| `npm run build:all`        | Build both backend and frontend               |
| `npm start`                | Start production server                       |
| `npm run install:all`      | Install all dependencies (backend + frontend) |
| `npm run db:sync`          | Sync database schema                          |
| `npm run db:drop`          | Drop all tables                               |
| `npm run db:fresh`         | Drop, migrate, and seed database              |
| `npm run migrate:generate` | Generate migration from entity changes        |
| `npm run migrate:run`      | Run pending migrations                        |
| `npm run lint`             | Run ESLint                                    |
| `npm run format`           | Format code with Prettier                     |

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
