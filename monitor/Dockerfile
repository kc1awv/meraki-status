# syntax=docker/dockerfile:1
FROM python:3.12-slim

# We use fping for fast ICMP; it needs CAP_NET_RAW at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
    fping ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Non-root user; capability will be granted by compose
RUN useradd -m appuser
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the monitor script (your latest version with --once + ingest calls)
COPY monitor.py .

# Config lives at /config/offices.yaml (mounted), logs to stdout
ENV OFFICES_YAML=/config/offices.yaml
# Point monitor to API container name
ENV SLA_API=http://api:8080

USER appuser

# Default: run continuous monitor
CMD ["python", "monitor.py"]
