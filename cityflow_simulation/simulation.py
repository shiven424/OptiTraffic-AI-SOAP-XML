import cityflow
import json
import os
import time
import base64
import random
from kafka import KafkaProducer
from kafka.errors import NoBrokersAvailable
from cryptography.fernet import Fernet

# Load encryption key from environment variable
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
if not ENCRYPTION_KEY:
    raise ValueError("❌ ENCRYPTION_KEY environment variable is missing!")

cipher = Fernet(ENCRYPTION_KEY.encode())

# Kafka configuration
kafka_config = {
    'bootstrap_servers': ['kafka:9092'],
    'client_id': 'traffic-producer',
    'value_serializer': lambda v: v.encode('utf-8')
}

def encrypt_message(message):
    """Encrypt JSON message using AES encryption (Fernet)."""
    json_data = json.dumps(message)
    encrypted_data = cipher.encrypt(json_data.encode())
    return base64.b64encode(encrypted_data).decode()  # Convert to string for Kafka transmission

def create_kafka_producer(retries=5, delay=5):
    """Attempt to connect to Kafka with retries."""
    for attempt in range(retries):
        try:
            return KafkaProducer(**kafka_config)
        except NoBrokersAvailable:
            if attempt < retries - 1:
                print(f"⚠️ Unable to connect to Kafka. Retrying in {delay} seconds...")
                time.sleep(delay)
            else:
                raise Exception("❌ Failed to connect to Kafka after multiple attempts.")

producer = create_kafka_producer()

# File paths
config_path = "./config.json"
flow_path = "./flow.json"
roadnet_path = "./roadnet.json"

# Check if required files exist
for file_path in [config_path, flow_path, roadnet_path]:
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"❌ Missing file: {file_path}")

# Load CityFlow simulation
print("🚦 Loading CityFlow simulation...")
eng = cityflow.Engine(config_path, thread_num=1)
print("✅ CityFlow simulation loaded successfully.")

# Define the target intersection and roads
intersection_id = "intersection_1_1"
road_ids = ["road_0_1_0", "road_1_0_1", "road_2_1_2", "road_1_2_3"]

def get_road_data(eng, road_id):
    """Extract traffic data for a given road, including vehicle IDs."""
    all_lane_vehicles = eng.get_lane_vehicles()
    road_lanes = [lane for lane in all_lane_vehicles.keys() if lane.startswith(road_id)]
    
    vehicle_ids = [vehicle for lane in road_lanes for vehicle in all_lane_vehicles[lane]]
    vehicle_count = len(vehicle_ids)
    avg_speed = eng.get_vehicle_speed()
    road_length = 300  

    if vehicle_ids:
        avg_speed = sum(avg_speed[vehicle] for vehicle in vehicle_ids) / len(vehicle_ids)
    else:
        avg_speed = 0

    density = vehicle_count / road_length if road_length > 0 else 0

    return {
        "vehicle_count": vehicle_count,
        "avg_speed": avg_speed,
        "density": density,
        "vehicle_ids": vehicle_ids
    }

# --- Random Raw Signal Generation Logic ---
# We'll simulate a phase duration (in seconds) and switch the green signal road after the duration expires.
RAW_PHASE_DURATION = 10  # seconds
current_raw_phase_start = time.time()
current_green_road = random.choice(road_ids)

def get_raw_light_signal(road_ids):
    global current_raw_phase_start, current_green_road

    # Check if phase duration is over and switch the green road
    if time.time() - current_raw_phase_start > RAW_PHASE_DURATION:
        current_green_road = random.choice(road_ids)
        current_raw_phase_start = time.time()

    # Create the signal for each road: green if it is the chosen one; red otherwise.
    signals = {}
    for road in road_ids:
        if road == current_green_road:
            # Simulate a green phase (e.g., "g g g g g g g")
            signals[road] = "g g g g g g g"
        else:
            # Simulate a red phase (e.g., "r r r r r r r")
            signals[road] = "r r r r r r r"

    # Construct a raw signal string: each road's id followed by its signal, separated by commas.
    raw_signal = ",".join([f"{road} {signals[road]}" for road in road_ids])
    return raw_signal

# Run simulation and send data gradually
for step in range(300):
    eng.next_step()
    
    # Collect summary data for prediction 
    summary_data = {road_id: get_road_data(eng, road_id) for road_id in road_ids}
    
    # Extra field with the dynamic raw simulation signal for monitoring.
    raw_detail = get_raw_light_signal(road_ids)
    
    # Create a combined payload that includes both the summary and raw detail.
    traffic_data = {
        "summary": summary_data,
        "raw_detail": raw_detail
    }
    
    encrypted_data = encrypt_message(traffic_data)
    
    try:
        producer.send('traffic-data', key=intersection_id.encode('utf-8'), value=encrypted_data)
        producer.flush()
        print(f"🚦 Step {step + 1} - Encrypted data sent to Kafka")
    except Exception as e:
        print(f"❌ Failed to send data to Kafka: {str(e)}")
    
    time.sleep(3)  # ⏳ Add delay to simulate real-time traffic

print("🚀 Simulation completed successfully!")
