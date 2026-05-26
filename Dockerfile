FROM node:26-slim AS base

WORKDIR /code

COPY package.json /code/package.json

RUN npm install --omit=dev --no-audit --no-fund

COPY . /code

# Install cron and gosu (gosu gives clean exec into appuser without sudo)
RUN apt-get update && apt-get install -y --no-install-recommends cron gosu && \
    rm -rf /var/lib/apt/lists/*

# Persistent data volume — symlink the SQLite db out of the image layer so
# it survives container rebuilds when /data is mounted from the host.
RUN mkdir -p /data && \
    ln -sf /data/database.db /code/database.db

# Daily cron job: re-sync card and meal data at 1:00 and every hour from 9:00 to 14:00 (after each meal update)
RUN echo 'SHELL=/bin/bash' > /etc/cron.d/kartenservice-sync && \
    echo 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' >> /etc/cron.d/kartenservice-sync && \
    echo '0 1,9-14 * * * appuser bash -c '"'"'. /etc/cron-env.sh && cd /code && node --experimental-sqlite /code/sync-all.js'"'"' >> /var/log/kartenservice-cron.log 2>&1' \
    >> /etc/cron.d/kartenservice-sync && \
    chmod 0644 /etc/cron.d/kartenservice-sync

# Pre-create cron log file so appuser can write to it
RUN touch /var/log/kartenservice-cron.log

# Entrypoint: dump env for cron, start cron daemon, then exec Fastify as appuser (PID 1)
RUN echo '#!/bin/bash'                                                                               > /entrypoint.sh && \
    echo 'set -e'                                                                                   >> /entrypoint.sh && \
    echo '# Export container env vars so cron jobs can source them'                                >> /entrypoint.sh && \
    echo 'export -p > /etc/cron-env.sh'                                                            >> /entrypoint.sh && \
    echo 'chmod 640 /etc/cron-env.sh'                                                              >> /entrypoint.sh && \
    echo '/usr/sbin/cron'                                                                           >> /entrypoint.sh && \
    echo 'exec gosu appuser node --experimental-sqlite /code/server.js'                            >> /entrypoint.sh && \
    chmod +x /entrypoint.sh

RUN useradd -u 8888 appuser && \
    chown -R appuser:appuser /code /data /var/log/kartenservice-cron.log && \
    touch /etc/cron-env.sh && chown root:appuser /etc/cron-env.sh

WORKDIR /code

CMD ["/entrypoint.sh"]
