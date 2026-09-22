FROM node:26-bookworm-slim

RUN npm install --global npm@12 \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    tree \
    nano \
    make \
    htop \
    procps \
  && rm -rf /var/lib/apt/lists/*

RUN echo "alias ll='ls -alF --color=auto'" >> /etc/bash.bashrc

WORKDIR /app/mcp

CMD ["bash", "-lc", "while true; do sleep 3600; done"]
