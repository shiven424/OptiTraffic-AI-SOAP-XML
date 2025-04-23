from kafka import KafkaConsumer, KafkaProducer
from kafka.errors import NoBrokersAvailable
from kafka.admin import KafkaAdminClient, NewTopic
import threading
import json
import time
import numpy as np
from tensorflow.keras.models import load_model
import base64
import os
import random
import logging

# Spyne imports for SOAP service
from spyne import Application, rpc, ServiceBase, Unicode, ComplexModel
from spyne.protocol.soap import Soap11
from spyne.server.wsgi import WsgiApplication
from werkzeug.serving import run_simple

logging.basicConfig(level=logging.DEBUG)

# ---------------------- Configuration ----------------------
from cryptography.fernet import Fernet

ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
if not ENCRYPTION_KEY:
    raise ValueError("❌ ENCRYPTION_KEY environment variable is missing!")
cipher = Fernet(ENCRYPTION_KEY.encode())

KAFKA_BROKER = "kafka:9092"
TRAFFIC_TOPIC = "traffic-data"
ALERT_TOPIC = "traffic-alerts"
GROUP_ID = "traffic-signal-group"

TOTAL_VEHICLES_PASSED = 0
VEHICLE_WAIT_TIMES = {}

FIXED_CYCLE = 30 
last_switch_time = time.time()
current_green_index = 0
road_order = ["road_0_1_0", "road_1_0_1", "road_2_1_2", "road_1_2_3"]
current_mode = "auto"

SEQUENCE_LENGTH = 5
NUM_ROADS = 4
FEATURES_PER_ROAD = 3
INPUT_DIM = NUM_ROADS * FEATURES_PER_ROAD

snapshot_buffer = []

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "traffic_signal_model.h5")
try:
    lstm_model = load_model(MODEL_PATH)
    logging.info(f"✅ LSTM model loaded from {MODEL_PATH}")
except Exception as e:
    logging.error(f"❌ Error loading LSTM model: {e}")
    lstm_model = None

latest_prediction = {
    "roads": {},
    "green_light": None,
    "congested_roads": [],
    "total_vehicles_passed": 0,
    "average_wait_time": 0,
    "current_density": 0,
    "time_remaining": 0,
    "timestamp": 0
}
prediction_lock = threading.Lock()

# ---------------------- Kafka Setup ----------------------
def ensure_kafka_topic(topic_name):
    try:
        admin_client = KafkaAdminClient(bootstrap_servers=KAFKA_BROKER, client_id="kafka-setup")
        existing_topics = admin_client.list_topics()
        if topic_name not in existing_topics:
            topic = NewTopic(name=topic_name, num_partitions=1, replication_factor=1)
            admin_client.create_topics([topic])
            logging.info(f"✅ Created topic: {topic_name}")
        else:
            logging.info(f"⚠️ Topic '{topic_name}' already exists.")
    except Exception as e:
        logging.error(f"⚠️ Topic creation failed: {e}")

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
            logging.info("✅ Successfully connected to Kafka and subscribed to topic")
            return consumer
        except NoBrokersAvailable:
            logging.warning(f"⚠️ Attempt {attempt+1} to connect to Kafka failed. Retrying in {delay} seconds...")
            time.sleep(delay)
    raise RuntimeError("Failed to connect to Kafka broker")

def create_kafka_producer():
    try:
        producer = KafkaProducer(
            bootstrap_servers=KAFKA_BROKER,
            value_serializer=lambda v: json.dumps(v).encode('utf-8')
        )
        logging.info("✅ Kafka Producer created successfully!")
        return producer
    except Exception as e:
        logging.error(f"❌ Failed to create Kafka producer: {e}")
        return None

def publish_alert(event_type, details):
    alert_message = {"event_type": event_type, "details": details}
    try:
        producer.send(ALERT_TOPIC, value=alert_message)
        logging.info(f"🚨 Alert Published: {alert_message}")
    except Exception as e:
        logging.error(f"❌ Failed to send alert: {e}")

def decrypt_message(encrypted_message):
    try:
        decrypted_data = cipher.decrypt(base64.b64decode(encrypted_message))
        return json.loads(decrypted_data)
    except Exception as e:
        logging.error(f"❌ Decryption error: {e}")
        return None

# ---------------------- Helper Functions ----------------------
def predict_green_light_with_lstm(buffer):
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
    sequence = np.array(sequence)
    sequence = sequence.reshape((1, SEQUENCE_LENGTH, INPUT_DIM))
    predictions = lstm_model.predict(sequence)
    idx = predictions.argmax(axis=1)[0]
    return road_order[idx]

def heuristic_predict_traffic_light(road_data):
    return max(road_data, key=lambda r: road_data[r]['vehicle_count'], default=None)

def predict_congestion(road_data):
    return [r for r, d in road_data.items() if d['vehicle_count'] > 20]

def detect_accidents(road_data):
    return random.choice(list(road_data.keys())) if random.random() < 0.05 else None

def detect_traffic_light_failure():
    return random.random() < 0.03

# ---------------------- Main Consumer Logic ----------------------
def consume_and_predict():
    logging.info("🚦 Kafka consumer thread started.")
    consumer = create_kafka_consumer()
    global TOTAL_VEHICLES_PASSED, VEHICLE_WAIT_TIMES
    TOTAL_VEHICLES_PASSED = 0
    VEHICLE_WAIT_TIMES = {}
    while True:
        try:
            msg = next(consumer)
            current_time = time.time()
            decrypted_data = decrypt_message(msg.value)
            if not decrypted_data:
                continue
            summary = decrypted_data.get("summary", {})
            current_vehicles = set()
            total_density = 0
            vehicle_data = {}
            # Extract each road
            for road, data in summary.items():
                vehicle_ids = data.get("vehicle_ids", [])
                current_vehicles.update(vehicle_ids)
                total_density += data.get("density", 0)
                vehicle_data[road] = {
                    "vehicle_ids": vehicle_ids,
                    "vehicle_count": data.get("vehicle_count", 0),
                    "avg_speed": data.get("avg_speed", 0),
                    "density": data.get("density", 0)
                }

            # Update TOTAL_VEHICLES_PASSED
            for vid in current_vehicles:
                if vid not in VEHICLE_WAIT_TIMES:
                    VEHICLE_WAIT_TIMES[vid] = current_time
            departed_vehicles = set(VEHICLE_WAIT_TIMES.keys()) - current_vehicles
            for vid in departed_vehicles:
                TOTAL_VEHICLES_PASSED += 1
                del VEHICLE_WAIT_TIMES[vid]

            # Average wait time
            waits = [current_time - entry for entry in VEHICLE_WAIT_TIMES.values()]
            avg_wait = sum(waits)/len(waits) if waits else 0

            # LSTM buffer
            snapshot_buffer.append({"roads": summary})
            if len(snapshot_buffer) > SEQUENCE_LENGTH:
                snapshot_buffer.pop(0)

            # Decide green light
            if current_mode == 'auto' and lstm_model is not None and len(snapshot_buffer) == SEQUENCE_LENGTH:
                green_light_road = predict_green_light_with_lstm(snapshot_buffer)
            else:
                green_light_road = heuristic_predict_traffic_light(summary)

            # For fixed mode
            global last_switch_time, current_green_index
            time_remaining = 0
            if current_mode == 'fixed':
                if current_time - last_switch_time >= FIXED_CYCLE:
                    with prediction_lock:
                        current_green_index = (current_green_index + 1) % len(road_order)
                        last_switch_time = current_time
                green_light_road = road_order[current_green_index]
                elapsed = current_time - last_switch_time
                time_remaining = max(FIXED_CYCLE - elapsed, 0)

            # Check accidents, etc.
            congested_roads = predict_congestion(summary)
            accident_road = detect_accidents(summary)
            light_failure = detect_traffic_light_failure()

            # Update shared state
            with prediction_lock:
                latest_prediction.update({
                    "roads": vehicle_data,
                    "green_light": green_light_road,
                    "congested_roads": congested_roads,
                    "total_vehicles_passed": TOTAL_VEHICLES_PASSED,
                    "average_wait_time": avg_wait,
                    "current_density": total_density,
                    "time_remaining": round(time_remaining, 1),
                    "timestamp": current_time
                })

            # Alerts
            for r in congested_roads:
                publish_alert("congestion", f"Heavy congestion on {r}")
            if accident_road:
                publish_alert("accident", f"Accident reported on {accident_road}")
            if light_failure:
                publish_alert("traffic_light_failure", "Traffic light failure detected!")

        except StopIteration:
            time.sleep(0.1)
        except Exception as e:
            logging.error(f"Error in consume_and_predict: {e}")

def fixed_timer_handler():
    while True:
        if current_mode == 'fixed':
            # Just rely on the main loop’s time checking
            pass
        time.sleep(0.1)

# ---------------------- SOAP Service ----------------------
class TrafficDataResponse(ComplexModel):
    __namespace__ = 'http://example.com/trafficsignal'
    data = Unicode

class SetModeRequest(ComplexModel):
    __namespace__ = 'http://example.com/trafficsignal'
    mode = Unicode

# Avoid name collision by using a distinct name
class TrafficSetModeResponse(ComplexModel):
    __namespace__ = 'http://example.com/trafficsignal'
    status = Unicode
    mode = Unicode
    timestamp = Unicode

class HealthResult(ComplexModel):
    __namespace__ = 'http://example.com/trafficsignal'
    status = Unicode

from spyne import ServiceBase, rpc

class TrafficSignalService(ServiceBase):
    @rpc(_returns=TrafficDataResponse)
    def GetTrafficData(ctx):
        with prediction_lock:
            logging.debug("SOAP GetTrafficData called.")
            return TrafficDataResponse(data=json.dumps(latest_prediction))

    @rpc(SetModeRequest, _returns=TrafficSetModeResponse)
    def SetMode(ctx, request):
        global current_mode, last_switch_time, current_green_index
        new_mode = request.mode
        if new_mode in ['auto', 'fixed']:
            with prediction_lock:
                current_mode = new_mode
                if new_mode == 'fixed':
                    last_switch_time = time.time()
                    current_green_index = 0
                now_str = str(time.time())
            return TrafficSetModeResponse(status="success", mode=current_mode, timestamp=now_str)
        else:
            return TrafficSetModeResponse(status="error", mode=current_mode, timestamp=str(time.time()))

    @rpc(_returns=HealthResult)
    def Test(ctx):
        return HealthResult(status="ok")

    @rpc(_returns=HealthResult)
    def Health(ctx):
        return HealthResult(status="ok")

from spyne import Application
soap_app = Application(
    [TrafficSignalService],
    tns='http://example.com/trafficsignal',
    in_protocol=Soap11(validator='lxml'),
    out_protocol=Soap11()
)

from spyne.server.wsgi import WsgiApplication
wsgi_app = WsgiApplication(soap_app)

def cors_app(app):
    def new_app(environ, start_response):
        if environ.get('REQUEST_METHOD', '') == 'OPTIONS':
            start_response('200 OK', [
                ('Content-Type', 'text/plain'),
                ('Access-Control-Allow-Origin', '*'),
                ('Access-Control-Allow-Methods', 'POST, GET, OPTIONS'),
                ('Access-Control-Allow-Headers', 'Content-Type, SOAPAction'),
            ])
            return [b'']
        else:
            def custom_start_response(status, headers, exc_info=None):
                headers.append(('Access-Control-Allow-Origin', '*'))
                headers.append(('Access-Control-Allow-Methods', 'POST, GET, OPTIONS'))
                headers.append(('Access-Control-Allow-Headers', 'Content-Type, SOAPAction'))
                return start_response(status, headers, exc_info)
            return app(environ, custom_start_response)
    return new_app

app_with_cors = cors_app(wsgi_app)

def static_wsdl_app(environ, start_response):
    query = environ.get('QUERY_STRING', '')
    if 'wsdl' in query:
        try:
            with open('traffic_signal_service.wsdl', 'rb') as f:
                wsdl_data = f.read()
            start_response('200 OK', [
                ('Content-Type', 'text/xml'),
                ('Access-Control-Allow-Origin', '*')
            ])
            return [wsdl_data]
        except Exception as e:
            start_response('500 Internal Server Error', [('Content-Type', 'text/plain')])
            return [b"Error reading WSDL file"]
    else:
        return app_with_cors(environ, start_response)

if __name__ == '__main__':
    logging.info("🚀 Starting Traffic Signal SOAP Service.")
    ensure_kafka_topic(TRAFFIC_TOPIC)
    ensure_kafka_topic(ALERT_TOPIC)
    producer = create_kafka_producer()
    threading.Thread(target=fixed_timer_handler, daemon=True).start()
    threading.Thread(target=consume_and_predict, daemon=True).start()
    time.sleep(2)
    run_simple('0.0.0.0', 5000, static_wsdl_app)
