FROM python:3.6

# Install librdkafka
RUN apt-get update && apt-get install -y librdkafka-dev

# Upgrade pip
RUN pip install --upgrade pip

# Copy requirements file
COPY requirements.txt .

EXPOSE 5000





# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy your application code
COPY . .

# Run your application
CMD ["python", "kafka_setup.py"]
