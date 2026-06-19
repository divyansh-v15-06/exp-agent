FROM node:20-alpine

# Install openssl and curl (useful for health checks)
RUN apk add --no-cache openssl curl

WORKDIR /app

# Copy dependency configs
COPY package*.json ./
COPY tsconfig.json ./
COPY next.config.mjs ./
COPY postcss.config.mjs ./
COPY tailwind.config.ts ./

# Copy database schema
COPY prisma ./prisma/

# Install all dependencies (development & production)
RUN npm ci

# Copy the rest of the application code
COPY app ./app/
COPY lib ./lib/
COPY tools ./tools/
COPY images ./images/

# Generate Prisma Client & Build the application for production
RUN npx prisma generate
RUN npm run build

# Create a directory to store the persistent SQLite database
RUN mkdir -p /app/data
ENV DATABASE_URL="file:/app/data/dev.db"

# Expose Next.js port
EXPOSE 3000
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

# Setup runtime entrypoint script to automatically push schema, seed, and run
RUN echo '#!/bin/sh' > /app/start.sh && \
    echo 'npx prisma db push --accept-data-loss && npx prisma db seed && npm run start' >> /app/start.sh && \
    chmod +x /app/start.sh

CMD ["/app/start.sh"]
