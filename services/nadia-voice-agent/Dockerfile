FROM python:3.11-slim

# ffmpeg — required by audio_speed.py for speaking-rate time-stretch
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/

# Pre-download the Whisper model at build time so the first real call
# isn't stuck waiting on a cold download.
ARG WHISPER_MODEL_SIZE=small
ENV WHISPER_MODEL_SIZE=${WHISPER_MODEL_SIZE}
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL_SIZE}', device='cpu', compute_type='int8')"

CMD ["python", "src/agent.py", "start"]
