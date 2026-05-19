FROM node:20-bookworm-slim

# Tools the pipeline needs on every step.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install pnpm globally — most modern JS repos use it. npm and yarn ship with Node.
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /workspace
RUN chown -R node /workspace
USER node

CMD ["sh", "-c", "echo 'webtesting sandbox ready' && node -v && pnpm -v"]
