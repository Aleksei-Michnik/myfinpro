FROM node:24-alpine

# Install Haraka globally
RUN npm install -g Haraka@3.1.5

# Create Haraka instance directory
RUN haraka -i /opt/haraka

# Copy static configuration files (domain-agnostic)
COPY config/ /opt/haraka/config/

# Copy entrypoint script (generates domain-specific config from env vars)
COPY entrypoint.sh /opt/haraka/entrypoint.sh
RUN chmod +x /opt/haraka/entrypoint.sh

WORKDIR /opt/haraka

EXPOSE 25

ENTRYPOINT ["/opt/haraka/entrypoint.sh"]
