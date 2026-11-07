# Cloud Run image for the grading engine. Build from this folder:
#   gcloud run deploy qmath-grading --source . --region europe-west4
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD exec uvicorn bot_api:app --host 0.0.0.0 --port ${PORT:-8080}
