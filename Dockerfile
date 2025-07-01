# Stage 1: Build Stage
FROM node:18-alpine AS builder

WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application source code
COPY . .

# ---

# Stage 2: Production Stage
FROM node:18-alpine

WORKDIR /usr/src/app

# Copy dependencies from the builder stage
COPY --from=builder /usr/src/app/node_modules ./node_modules
# Copy application code
COPY --from=builder /usr/src/app .

# Expose the port the app runs on
EXPOSE 7000

# Set default environment variables
ENV NODE_ENV=production
ENV PORT=7000
ENV BASE_URL=https://einthusan.tv
ENV LOG_LEVEL=info

# Command to run the application
CMD ["node", "server.js"]
