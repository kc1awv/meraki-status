# syntax=docker/dockerfile:1
FROM python:3.12-slim

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m appuser
WORKDIR /app

# Copy and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app
COPY app.py .

# Data dir for SQLite
RUN mkdir -p /data && chown -R appuser:appuser /data
ENV SLA_DB=/data/sla.sqlite

USER appuser
EXPOSE 8080

# Healthcheck endpoint optional later
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
