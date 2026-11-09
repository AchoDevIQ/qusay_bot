# Cloud Run image for the grading engine. Build from this folder:
#   gcloud run deploy qmath-grading --source . --region europe-west4
# Secrets: BOT_KEY (the bot's GRADING_AI_KEY) and ANTHROPIC_API_KEY. Without BOT_KEY every request is refused.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# No root inside the container: a bug in a parser can't touch the image or the system
RUN useradd --system --uid 10001 --no-create-home qmath
USER qmath
CMD exec uvicorn bot_api:app --host 0.0.0.0 --port ${PORT:-8080}
