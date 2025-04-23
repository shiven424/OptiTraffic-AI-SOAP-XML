from kafka import KafkaConsumer, KafkaProducer
from kafka.errors import NoBrokersAvailable
from kafka.admin import KafkaAdminClient, NewTopic
from flask import Flask, jsonify, request
from flask_cors import CORS
import threading
import json
import time
import numpy as np
from tensorflow.keras.models import load_model
import base64
import os
import random

# ---------------------- Configuration ----------------------
from cryptography.fernet import Fernet

# Load encryption key from environment variable
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
if not ENCRYPTION_KEY:
    raise ValueError("❌ ENCRYPTION_KEY environment variable is missing!")

cipher = Fernet(ENCRYPTION_KEY.encode())

# Kafka Configuration
KAFKA_BROKER = "kafka:9092"
TRAFFIC_TOPIC = "traffic-data"
ALERT_TOPIC = "traffic-alerts"
GROUP_ID = "traffic-signal-group"

# Global metrics tracking
TOTAL_VEHICLES_PASSED = 0
VEHICLE_WAIT_TIMES = {}  # {vehicle_id: entry_timestamp}

# Fixed timer configuration
FIXED_CYCLE = 30  # seconds per green light
last_switch_time = time.time()
current_green_index = 0
road_order = ["road_0_1_0", "road_1_0_1", "road_2_1_2", "road_1_2_3"]  # fixed order
current_mode = "auto"  # 'auto' or 'fixed'

# LSTM model parameters (must match training)
SEQUENCE_LENGTH = 5
NUM_ROADS = 4
FEATURES_PER_ROAD = 3
INPUT_DIM = NUM_ROADS * FEATURES_PER_ROAD  # 12

# Global buffer to hold recent snapshots for LSTM prediction
snapshot_buffer = []

# ---------------------- Load Trained Model ----------------------
# Adjust the path based on how the model is made available in your Docker container.
# For example, if the model file from ai_model is copied into the container at /app/ai_model/
MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "traffic_signal_model.h5")

try:
    lstm_model = load_model(MODEL_PATH)
    print(f"✅ LSTM model loaded successfully from {MODEL_PATH}")
except Exception as e:
    print(f"❌ Error loading LSTM model: {e}")
    lstm_model = None  # Fallback to heuristic if model cannot be loaded

# ---------------------- Flask Setup ----------------------
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

latest_prediction = {
    "roads": {},
    "green_light": None,
    "congested_roads": [],
    "total_vehicles_passed": 0,
    "average_wait_time": 0,
    "current_density": 0,
    "time_remaining": 0  # For frontend timer
}
prediction_lock = threading.Lock()

# ---------------------- Kafka Topic Utilities ----------------------
def ensure_kafka_topic(topic_name):
    try:
        admin_client = KafkaAdminClient(bootstrap_servers=KAFKA_BROKER, client_id="kafka-setup")
        existing_topics = admin_client.list_topics()

        if topic_name not in existing_topics:
            topic = NewTopic(name=topic_name, num_partitions=1, replication_factor=1)
            admin_client.create_topics([topic])
            print(f"✅ Kafka topic '{topic_name}' created successfully!")
        else:
            print(f"⚠️ Kafka topic '{topic_name}' already exists.")
    except Exception as e:
        print(f"⚠️ Kafka topic creation failed: {e}")

# Function to create Kafka consumer with retries
def create_kafka_consumer(retries=5, delay=5):
    for attempt in range(retries):
        try:
            consumer = KafkaConsumer(
                TRAFFIC_TOPIC,
                bootstrap_servers=KAFKA_BROKER,
                group_id=GROUP_ID,
                auto_offset_reset='earliest',
                enable_auto_commit=True,
                value_deserializer=lambda v: v.decode('utf-8')
            )
            print("✅ Successfully connected to Kafka and subscribed to topic")
            return consumer
        except NoBrokersAvailable:
            print(f"⚠️ Attempt {attempt + 1} failed. Retrying in {delay} seconds...")
            time.sleep(delay)
    
    raise Exception("❌ Failed to connect to Kafka after multiple attempts")

# Function to create Kafka producer
def create_kafka_producer():
    try:
        producer = KafkaProducer(
            bootstrap_servers=KAFKA_BROKER,
            value_serializer=lambda v: json.dumps(v).encode('utf-8')
        )
        print("✅ Kafka Producer created successfully!")
        return producer
    except Exception as e:
        print(f"❌ Failed to create Kafka producer: {e}")
        return None

# Function to publish alerts to Kafka
def publish_alert(event_type, details):
    alert_message = {"event_type": event_type, "details": details}
    try:
        producer.send(ALERT_TOPIC, value=alert_message)
        print(f"🚨 Alert Published: {alert_message}")
    except Exception as e:
        print(f"❌ Failed to send alert: {e}")

# Function to decrypt messages received from Kafka
def decrypt_message(encrypted_message):
    """Decrypts a base64-encoded AES-encrypted message."""
    try:
        decrypted_data = cipher.decrypt(base64.b64decode(encrypted_message))
        return json.loads(decrypted_data)  # Convert to JSON
    except Exception as e:
        print(f"❌ Decryption error: {str(e)}")
        return None
    
# ---------------------- Helper Functions ----------------------
def predict_green_light_with_lstm(buffer):
    """
    Given a buffer of SEQUENCE_LENGTH snapshots (each snapshot is a dict of road data),
    extract features and use the LSTM model to predict which road should get the green light.
    """
    # Build a sequence array of shape (SEQUENCE_LENGTH, NUM_ROADS * FEATURES_PER_ROAD)
    sequence = []
    for snap in buffer:
        snapshot_features = []
        for road in road_order:
            data = snap.get("roads", {}).get(road, {})
            vehicle_count = data.get("vehicle_count", 0)
            avg_speed = data.get("avg_speed", 0)
            density = data.get("density", 0)
            snapshot_features.extend([vehicle_count, avg_speed, density])
        sequence.append(snapshot_features)
    sequence = np.array(sequence)  # shape: (SEQUENCE_LENGTH, INPUT_DIM)
    # Add batch dimension -> (1, SEQUENCE_LENGTH, INPUT_DIM)
    sequence = sequence.reshape((1, SEQUENCE_LENGTH, INPUT_DIM))
    # Predict using the LSTM model
    predictions = lstm_model.predict(sequence)
    predicted_index = predictions.argmax(axis=1)[0]
    predicted_road = road_order[predicted_index]
    return predicted_road

def heuristic_predict_traffic_light(traffic_data):
    """Fallback heuristic: choose the road with the maximum vehicle count."""
    return max(traffic_data, key=lambda road: traffic_data[road]['vehicle_count'], default=None)

def predict_congestion(road_data):
    return [road for road, data in road_data.items() if data['vehicle_count'] > 20]

# Function to detect accidents (simulated randomly for now)
def detect_accidents(road_data):
    return random.choice(list(road_data.keys())) if random.random() < 0.05 else None  # 5% chance of an accident

# Function to detect traffic light failure (simulated randomly)
def detect_traffic_light_failure():
    return random.random() < 0.03  # 3% chance of failure

# ---------------------- Kafka Consumer and Prediction ----------------------
def consume_and_predict():
    global snapshot_buffer, TOTAL_VEHICLES_PASSED, VEHICLE_WAIT_TIMES, last_switch_time, current_green_index
    print("🚦 Kafka Consumer is now running...")
    consumer = create_kafka_consumer()

    # Global metrics tracking
    global TOTAL_VEHICLES_PASSED, VEHICLE_WAIT_TIMES
    TOTAL_VEHICLES_PASSED = 0
    VEHICLE_WAIT_TIMES = {}

    for msg in consumer:
        try:
            current_time = time.time()
            print(f"📩 Raw message received from Kafka: {msg}")  # Debugging log
            decrypted_data = decrypt_message(msg.value)

            if decrypted_data is None:
                print("⚠️ Skipping message due to decryption failure.")
                continue

            print(f"📡 Decrypted Kafka Message: {decrypted_data}")  # Debugging log
            
            # Process vehicles
            current_vehicles = set()
            total_density = 0

            # Extract vehicle data and track density
            vehicle_data = {}
            for road, data in decrypted_data.items():
                vehicle_ids = data.get("vehicle_ids", [])
                current_vehicles.update(vehicle_ids)
                total_density += data.get("density", 0)

                vehicle_data[road] = {
                    "vehicle_ids": vehicle_ids,
                    "vehicle_count": data.get("vehicle_count", 0),
                    "avg_speed": data.get("avg_speed", 0),
                    "density": data.get("density", 0)
                }

            # Track new vehicles
            for vid in current_vehicles:
                if vid not in VEHICLE_WAIT_TIMES:
                    VEHICLE_WAIT_TIMES[vid] = current_time
            
            # Calculate departed vehicles
            departed_vehicles = set(VEHICLE_WAIT_TIMES.keys()) - current_vehicles
            for vid in departed_vehicles:
                TOTAL_VEHICLES_PASSED += 1
                del VEHICLE_WAIT_TIMES[vid]

            # Calculate average wait time
            current_wait_times = [current_time - entry for entry in VEHICLE_WAIT_TIMES.values()]
            avg_wait = sum(current_wait_times)/len(current_wait_times) if current_wait_times else 0

            # Update the snapshot buffer for LSTM-based prediction
            snapshot_buffer.append({"roads": decrypted_data})
            if len(snapshot_buffer) > SEQUENCE_LENGTH:
                snapshot_buffer.pop(0)
            
            # Decide green light:
            if current_mode == 'auto' and lstm_model is not None and len(snapshot_buffer) == SEQUENCE_LENGTH:
                # Use the LSTM model for prediction
                green_light_road = predict_green_light_with_lstm(snapshot_buffer)
            else:
                # Fallback heuristic (or if mode is fixed)
                green_light_road = heuristic_predict_traffic_light(decrypted_data)
            
            # For fixed mode, update the green light based on timer
            time_remaining = 0

            if current_mode == 'fixed':
                if current_time - last_switch_time >= FIXED_CYCLE:
                    with prediction_lock:
                        current_green_index = (current_green_index + 1) % len(road_order)
                        last_switch_time = current_time
                    green_light_road = road_order[current_green_index]
                else:
                    green_light_road = road_order[current_green_index]
                    elapsed = current_time - last_switch_time
                    time_remaining = max(FIXED_CYCLE - elapsed, 0)

            congested_roads = predict_congestion(decrypted_data)
            accident_road = detect_accidents(decrypted_data)
            light_failure = detect_traffic_light_failure()

            # Update shared prediction data
            with prediction_lock:
                latest_prediction.update({
                    "roads": vehicle_data,
                    "green_light": green_light_road,
                    "congested_roads": congested_roads,
                    "total_vehicles_passed": TOTAL_VEHICLES_PASSED,
                    "average_wait_time": avg_wait,
                    "current_density": total_density,
                    "time_remaining": round(time_remaining, 1)
                })

            print(f"✅ Updated latest_prediction: {latest_prediction}")  # Debugging log

            # 🚨 Send alerts when issues are detected
            for road in congested_roads:
                publish_alert("congestion", f"Heavy congestion detected on {road}")

            if accident_road:
                publish_alert("accident", f"Accident reported on {accident_road}")

            if light_failure:
                publish_alert("traffic_light_failure", "A traffic light failure has been detected!")

            time.sleep(0.5)  # Faster update cycle

        except json.JSONDecodeError as e:
            print(f"❌ JSON Decode Error: {e} - Message: {msg.value}")
        except Exception as e:
            print(f"❌ General Error: {str(e)}")


def fixed_timer_handler():
    """Dedicated thread for precise timer handling"""
    global last_switch_time, current_green_index, current_mode
    while True:
        if current_mode == 'fixed':
            now = time.time()
            elapsed = now - last_switch_time
            if elapsed >= FIXED_CYCLE:
                with prediction_lock:
                    current_green_index = (current_green_index + 1) % len(road_order)
                    last_switch_time = now
                    print(f"🚦 Switched to {road_order[current_green_index]}")
        time.sleep(0.1)  # Precise timing check


# ---------------------- Flask Endpoints ----------------------
@app.route('/api/traffic', methods=['GET'])
def get_traffic_data():
    with prediction_lock:
        print(f"📡 API Request Received - Sending Data: {latest_prediction}")  # Debugging log
        return jsonify(latest_prediction)

@app.route('/api/mode', methods=['POST'])
def set_mode():
    global current_mode, last_switch_time, current_green_index
    new_mode = request.json.get('mode')

    if new_mode in ['auto', 'fixed']:
        with prediction_lock:
            current_mode = new_mode
            if new_mode == 'fixed':
                # Reset timer when switching to fixed mode
                last_switch_time = time.time()
                current_green_index = 0
        return jsonify({
            "status": "success",
            "mode": current_mode,
            "timestamp": time.time()
        })
    return jsonify({"status": "error", "message": "Invalid mode"}), 400

@app.route('/test', methods=['GET'])
def test():
    return jsonify({"status": "ok"})

# ---------------------- Main ----------------------
if __name__ == '__main__':
    print("🚀 Starting Traffic Signal API...")

    # Ensure Kafka topics exist
    ensure_kafka_topic(TRAFFIC_TOPIC)
    ensure_kafka_topic(ALERT_TOPIC)

    # Create Kafka producer
    producer = create_kafka_producer()
    # Start dedicated threads for fixed timer and Kafka consumer
    threading.Thread(target=fixed_timer_handler, daemon=True).start()
    threading.Thread(target=consume_and_predict, daemon=True).start()
    
    time.sleep(5)  # Allow time for Kafka connections

    app.run(host='0.0.0.0', port=5000)
