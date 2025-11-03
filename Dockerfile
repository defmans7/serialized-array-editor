# Use official Bun image
FROM oven/bun:1.2

# Install curl for health checks
USER root
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package and lock files first for better caching
COPY package.json bun.lock bunfig.toml ./

# Install dependencies
RUN bun install

# Copy the rest of the application code
COPY . .

RUN bun run build

# Switch to bun user for security
USER bun

# Expose port 3000
EXPOSE 3000

# Add health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000 || exit 1

# Start the app
CMD ["bun", "start"]
