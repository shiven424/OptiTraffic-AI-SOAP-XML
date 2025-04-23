FROM python:3.9-slim

WORKDIR /app

# Copy microservice files
COPY . .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Expose the port for the service
EXPOSE 8000

# Start the microservice
CMD ["python", "app.py"]
