#!/bin/bash

echo "Starting simulator.py..."
python3 simulator.py &  # Run in background

# Optional: Wait a bit to ensure simulator is up (adjust as needed)
sleep 5

echo "Running cityflow_runner.py once..."
python3 cityflow_runner.py

# Wait to keep the container running as long as simulator.py is alive
wait