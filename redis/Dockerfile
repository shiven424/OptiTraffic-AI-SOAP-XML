FROM python:3.9-slim

WORKDIR /app

# Copy Redis setup script
COPY . .

# Install Redis Python client
RUN pip install redis

# Run the Redis setup script
CMD ["python", "redis_setup.py"]
