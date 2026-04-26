FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    gosu iptables bash git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

RUN mkdir -p /home/claude-user && chmod 777 /home/claude-user

COPY init-firewall.sh /usr/local/bin/init-firewall.sh
RUN chmod +x /usr/local/bin/init-firewall.sh

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
WORKDIR /workspace
