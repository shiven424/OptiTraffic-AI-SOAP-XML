FROM arm64v8/ubuntu:20.04
FROM cityflowproject/cityflow

WORKDIR /app

# Install librdkafka and upgrade pip
RUN apt-get update && apt-get install -y librdkafka-dev
RUN pip install --upgrade pip

# Copy simulation files
COPY . .

# Install additional dependencies
RUN pip install --no-cache-dir -r requirements.txt


# Set correct permissions for config files
RUN chmod 644 /app/*

# Verify the presence of necessary files
RUN ls -R /app

CMD ["python", "simulation.py"]
