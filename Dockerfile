# Stage 1: Build the application
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application source code
COPY . .

# Build the TypeScript code
RUN npm run build

# Stage 2: Production image
FROM node:18-alpine

WORKDIR /app

# Copy only necessary files from the builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json .

# Expose the port the app runs on
EXPOSE 3000

# Set environment variables (placeholders)
# These should be set during the 'docker run' command
ENV NODE_ENV=production
# ENV PORT=3000
# ENV HOST=0.0.0.0
# ENV ACCOUNTS_PATH=/path/to/your/credentials
# ENV PROXY=http://your-proxy-url:port

# Start the server
CMD ["node", "dist/server.js"]