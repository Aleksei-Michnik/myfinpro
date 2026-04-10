FROM node:22-alpine

# Install Haraka globally
RUN npm install -g Haraka@3.1.5

# Create Haraka instance directory
RUN haraka -i /opt/haraka

# Install required Haraka plugins (npm packages)
RUN cd /opt/haraka && npm install haraka-plugin-dkim@1.0.11

# Copy static configuration files (domain-agnostic)
COPY config/ /opt/haraka/config/

# Copy entrypoint script (generates domain-specific config from env vars)
COPY entrypoint.sh /opt/haraka/entrypoint.sh
RUN chmod +x /opt/haraka/entrypoint.sh

WORKDIR /opt/haraka

EXPOSE 25

ENTRYPOINT ["/opt/haraka/entrypoint.sh"]
