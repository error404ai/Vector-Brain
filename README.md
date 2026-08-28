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
- Docker / Docker Compose for local dependencies

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
   # Edit .env with your local credentials/API keys
   ```

4. Start local dependencies:

   ```bash
   npm run dev:deps
   ```

   This starts MySQL, phpMyAdmin, and Qdrant. The app itself still runs on your machine.

5. Sync database schema:

   ```bash
   npm run db:sync
   ```

6. Start development servers:
   ```bash
   npm run dev
   ```

The backend API will be available at `http://localhost:3002/api`.
The frontend will be available at `http://localhost:5173`
phpMyAdmin will be available at `http://localhost:8080`  
Qdrant will be available at `http://localhost:6333`

## Development Workflow

### Run Both Frontend and Backend

```bash
npm run dev:deps
npm run dev
```

This starts dependencies in Docker and runs:

- Backend on `http://localhost:3002`
- Frontend on `http://localhost:5173` (with API proxy)

Stop local dependencies:

```bash
npm run dev:deps:down
```

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

## Android Automation (local Docker test)

Vector-Brain includes an Android device pairing API, authenticated WebSocket gateway, multimodal planner loop, task logs, and a web control console. The companion application lives in the sibling `AndroidAutomation` repository.

Start the complete backend stack:

```bash
docker compose -f docker-compose-prod.yml up -d --build
```

The default host endpoints are:

- Vector-Brain web/API/WebSocket: `http://localhost:3002`
- MySQL: `localhost:3306`
- Qdrant: `localhost:6333`

For an Android Studio emulator, pair against `http://10.0.2.2:3002`; `localhost` inside the emulator refers to the emulator itself. For a physical phone, use the development Mac's reachable LAN IP. Generate the six-character code from **Android Devices**, enter it in the companion app, enable Accessibility and screen capture, and use **Android Agent** to submit a prompt.

The app container runs database migrations before starting. Configure `ANDROID_AGENT_API_KEY` explicitly for the Android planner; embedding credentials are never reused automatically. Sensitive actions pause until they are approved in the Android companion app.

## Routing

- **`/api/*`** - Backend API endpoints
- **`/*`** - Frontend React app (all other routes)

## Available Scripts

| Script                     | Description                                   |
| -------------------------- | --------------------------------------------- |
| `npm run dev:deps`         | Start local Docker dependencies               |
| `npm run dev:deps:down`    | Stop local Docker dependencies                |
| `npm run dev:deps:logs`    | Tail local dependency logs                    |
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
| `pnpm create:superadmin`   | Interactively create an administrator account |
| `npm run lint`             | Run ESLint                                    |
| `npm run format`           | Format code with Prettier                     |

### Administrator bootstrap

The `admin` role is the highest-access role in Vector Brain. Create a new
administrator interactively using the same command pattern as the Rofasware
applications:

```bash
pnpm create:superadmin
```

The command prompts for the email, name, password, and password confirmation.
It only creates a fresh account and refuses an email that already exists.

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
