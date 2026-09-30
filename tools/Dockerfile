FROM python:3.14-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/tools

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ffmpeg \
    htop \
    make \
    nano \
    procps \
    tree \
  && rm -rf /var/lib/apt/lists/*

RUN echo "alias ll='ls -alF --color=auto'" >> /etc/bash.bashrc

WORKDIR /app/tools

COPY requirements.txt ./
RUN pip install --no-cache-dir --requirement requirements.txt

COPY app ./app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
