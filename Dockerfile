# Development Dockerfile
FROM node:20-alpine

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install git
RUN apk add --no-cache git

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY frontend/package.json frontend/pnpm-lock.yaml ./frontend/

# Install dependencies
RUN pnpm install
RUN cd frontend && pnpm install

# Copy source code
COPY . .

# Expose the ports
EXPOSE 3000 5173

# Start the development server
CMD ["sh", "-c", "pnpm run migrate:run && pnpm run dev"]
