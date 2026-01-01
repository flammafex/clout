# ============================================
# Clout - Uncensorable Social Networking
# Multi-stage Docker build
# ============================================

# Stage 1: Builder
# Compiles TypeScript and prepares static assets
FROM node:20-bookworm AS builder

WORKDIR /app

# Copy package files for dependency installation
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
# --ignore-scripts prevents postinstall issues with native modules
RUN npm ci --ignore-scripts

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript and copy static files
RUN npm run build && \
    echo "=== Build verification ===" && \
    ls -la dist/src/web/server.js

# ============================================
# Stage 2: Runtime (default target)
# Serves the Clout web interface
# ============================================
FROM node:20-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="Clout"
LABEL org.opencontainers.image.description="Uncensorable P2P social networking with trust-based filtering"
LABEL org.opencontainers.image.source="https://github.com/flammafex/clout"

WORKDIR /app

# Install runtime dependencies only
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Create non-root user for security
RUN groupadd -r clout && useradd -r -g clout clout

# Create data directory with correct ownership
RUN mkdir -p /data && \
    chown -R clout:clout /data /app

# Switch to non-root user
USER clout

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV CLOUT_AUTH=false
ENV CLOUT_DATA_DIR=/data

# External service URLs
# IMPORTANT: When using Docker Compose, override these with Docker service names:
#   FREEBIRD_ISSUER_URL=http://freebird:8081
#   WITNESS_GATEWAY_URL=http://witness:8080
# The browser VOPRF proxy requires Clout to reach Freebird internally.
ENV WITNESS_GATEWAY_URL=http://localhost:8080
ENV WITNESS_NETWORK_ID=clout-testnet
ENV FREEBIRD_ISSUER_URL=http://localhost:8081
ENV FREEBIRD_VERIFIER_URL=http://localhost:8082
ENV HYPERTOKEN_RELAY_URL=ws://localhost:3000

# Tor configuration (disabled by default)
ENV TOR_ENABLED=false
ENV TOR_PROXY=socks5://localhost:9050

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Volume for persistent data
VOLUME ["/data"]

CMD ["node", "--experimental-wasm-modules", "dist/src/web/server.js"]

# ============================================
# Stage 3: CLI
# Command-line interface for Clout operations
# ============================================
FROM node:20-bookworm-slim AS cli

LABEL org.opencontainers.image.title="Clout CLI"
LABEL org.opencontainers.image.description="Command-line interface for Clout social networking"
LABEL org.opencontainers.image.source="https://github.com/flammafex/clout"

WORKDIR /app

# Install runtime dependencies only
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Create non-root user for security
RUN groupadd -r clout && useradd -r -g clout clout

# Create data directory with correct ownership
RUN mkdir -p /data && \
    chown -R clout:clout /data /app

# Switch to non-root user
USER clout

# Environment variables
ENV NODE_ENV=production
ENV CLOUT_DATA_DIR=/data

# External service URLs
ENV WITNESS_GATEWAY_URL=http://localhost:8080
ENV WITNESS_NETWORK_ID=clout-testnet
ENV FREEBIRD_ISSUER_URL=http://localhost:8081
ENV FREEBIRD_VERIFIER_URL=http://localhost:8082
ENV HYPERTOKEN_RELAY_URL=ws://localhost:3000

# Volume for persistent data
VOLUME ["/data"]

ENTRYPOINT ["node", "--experimental-wasm-modules", "dist/src/cli/index.js"]
CMD ["--help"]
