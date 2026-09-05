# Crokinole tournament scoring.
#
# Docker is for running this on a server or trying it out. At a venue the Mac
# app is the thing to use: it runs the same server, and an organiser should not
# have to install Docker to score a club night.
#
# Node 24 runs the TypeScript directly, so there is nothing to build.
FROM node:24-alpine

# su-exec drops from root to the node user in the entrypoint, after the data
# directory's ownership has been put right.
RUN apk add --no-cache su-exec

WORKDIR /app

# Only express is needed at runtime. Everything else in devDependencies is for
# linting, typechecking and packaging the desktop app, none of which belongs in
# a container that just serves a tournament.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY public/ ./public/

# The database lives in a volume so a tournament survives the container.
ENV CROK_DB_PATH=/data/crok.sqlite
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

# Starts as root only long enough to fix the data directory's ownership, then
# runs the server as node. See docker-entrypoint.sh for why that is needed.
COPY docker-entrypoint.sh /usr/local/bin/
ENTRYPOINT ["docker-entrypoint.sh"]

ENV PORT=8085
EXPOSE 8085

CMD ["node", "src/server.ts"]
