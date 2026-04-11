FROM node:22-alpine

# Install Haraka globally
RUN npm install -g Haraka@3.1.5

# Create Haraka instance directory
RUN haraka -i /opt/haraka

# DKIM signing uses the built-in dkim_sign plugin (no npm package needed).
# The npm haraka-plugin-dkim causes "Cannot pipe while currently piping"
# crash due to a message-stream race condition with queue/deliver.

# Copy static configuration files (domain-agnostic)
COPY config/ /opt/haraka/config/

# Copy entrypoint script (generates domain-specific config from env vars)
COPY entrypoint.sh /opt/haraka/entrypoint.sh
RUN chmod +x /opt/haraka/entrypoint.sh

WORKDIR /opt/haraka

EXPOSE 25

ENTRYPOINT ["/opt/haraka/entrypoint.sh"]
