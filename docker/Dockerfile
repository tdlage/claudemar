FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    sudo iptables bash git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

RUN echo "ALL ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/all-users

RUN mkdir -p /home/claude-user && chmod 777 /home/claude-user

COPY init-firewall.sh /usr/local/bin/init-firewall.sh
RUN chmod +x /usr/local/bin/init-firewall.sh

WORKDIR /workspace
