from kafka import KafkaConsumer, KafkaProducer
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from flask_sock import Sock
import threading, json, time, os
from datetime import datetime
from threading import Lock
import base64
from cryptography.fernet import Fernet

def log(message):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    print(f"{timestamp} {message}")

app = Flask(__name__, static_folder='static', static_url_path='/')
CORS(app)
sock = Sock(app)

# Load encryption key and set up cipher
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
if not ENCRYPTION_KEY:
    raise ValueError("Missing ENCRYPTION_KEY environment variable")
cipher = Fernet(ENCRYPTION_KEY.encode())

def encrypt_message(message):
    json_data = json.dumps(message)
    encrypted_data = cipher.encrypt(json_data.encode())
    return base64.b64encode(encrypted_data).decode()

def decrypt_message(encrypted_message):
    try:
        decrypted_data = cipher.decrypt(base64.b64decode(encrypted_message))
        return json.loads(decrypted_data)
    except Exception as e:
        log(f"Decryption error: {e}")
        return None

producer = None
def create_producer():
    global producer
    for attempt in range(5):
        try:
            producer = KafkaProducer(
                bootstrap_servers=os.getenv("KAFKA_BROKER", "kafka:9092"),
                value_serializer=lambda v: encrypt_message(v).encode('utf-8'),
                linger_ms=5,
                retries=5
            )
            log("KafkaProducer connected")
            return producer
        except Exception as e:
            log(f"Producer connection attempt {attempt+1} failed: {e}")
            time.sleep(2)
    raise RuntimeError("Failed to connect to Kafka broker for producing events")

try:
    kafka_producer = create_producer()
except Exception as e:
    log(f"ERROR: Kafka producer initialization failed: {e}")
    kafka_producer = None

simulation_data = {
    'replay': {'roadnet': None, 'traffic': []},
    'total_steps': 1000
}
active_connections = {}
active_connections_lock = Lock()
data_lock = Lock()

def create_consumer():
    for attempt in range(5):
        try:
            consumer = KafkaConsumer(
                'replay-roadnet', 'replay-traffic',
                bootstrap_servers=os.getenv("KAFKA_BROKER", "kafka:9092"),
                group_id='traffic-consumer-group',
                auto_offset_reset='earliest',
                enable_auto_commit=False,
                value_deserializer=lambda v: decrypt_message(v.decode('utf-8')),
                consumer_timeout_ms=10000
            )
            consumer.topics()
            return consumer
        except Exception as e:
            log(f"Connection attempt {attempt+1}/5 failed: {str(e)}")
            time.sleep(2)
    raise RuntimeError("Failed to connect to Kafka")

def process_message(msg):
    try:
        with data_lock:
            topic = msg.topic
            log(f"Received {topic} message")
            if topic == 'replay-roadnet':
                handle_roadnet_message(msg.value)
            elif topic == 'replay-traffic':
                handle_traffic_message(msg.value)
    except Exception as e:
        log(f"Processing error: {str(e)}")

def handle_roadnet_message(data):
    simulation_data['replay']['roadnet'] = data
    log(f"Updated roadnet with {len(data['static']['edges'])} edges")
    with active_connections_lock:
        for ws in list(active_connections.keys()):
            try:
                ws.send(json.dumps({
                    'type': 'roadnet',
                    'payload': simulation_data['replay']['roadnet']
                }))
            except Exception as e:
                active_connections.pop(ws, None)

def handle_traffic_message(data):
    if 'step' in data:
        step_num = data['step']
        while len(simulation_data['replay']['traffic']) <= step_num:
            simulation_data['replay']['traffic'].append({
                'step': len(simulation_data['replay']['traffic']),
                'vehicles': [],
                'traffic_lights': []
            })
        simulation_data['replay']['traffic'][step_num] = {
            'step': step_num,
            'vehicles': data.get('vehicles', []),
            'traffic_lights': data.get('traffic_lights', [])
        }
        simulation_data['total_steps'] = max(simulation_data['total_steps'], step_num + 1)
        log(f"Updated step {step_num} with {len(data.get('vehicles', []))} vehicles")

def consume_messages():
    while True:
        try:
            consumer = create_consumer()
            for msg in consumer:
                process_message(msg)
                consumer.commit()
        except Exception as e:
            log(f"Consumer error: {str(e)}")
            time.sleep(5)

@app.route('/health')
def health():
    log("Health check accessed")
    return jsonify({'status': 'ok', 'timestamp': time.time()})

@sock.route('/ws')
def handle_websocket(ws):
    with active_connections_lock:
        active_connections[ws] = 0
    try:
        if simulation_data['replay']['roadnet']:
            ws.send(json.dumps({
                'type': 'roadnet',
                'payload': simulation_data['replay']['roadnet']
            }))
        while True:
            message = ws.receive()
            if message:
                handle_client_message(ws, message)
    finally:
        with active_connections_lock:
            active_connections.pop(ws, None)

def handle_client_message(ws, message):
    try:
        msg = json.loads(message)
        msg_type = msg.get('type')
        if msg_type == 'request':
            current_index = active_connections.get(ws, 0)
            send_steps(ws, current_index, msg.get('count', 10))
        elif msg_type == 'debug_event':
            event_type = msg.get('event_type', 'unknown')
            target_type = msg.get('target_type', 'unknown')
            target_id = msg.get('target_id', None)
            log(f"Received debug event from client: {event_type} at {target_type} {target_id}")
            if kafka_producer:
                event_payload = {
                    "event_type": event_type,
                    "target_type": target_type,
                    "target_id": target_id,
                    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                }
                try:
                    # Send debug event to simulated-events topic
                    kafka_producer.send("simulated-events", event_payload)
                    if event_type in ["accident", "congestion", "light_failure"]:
                        kafka_producer.send("traffic-notifications", event_payload)
                    kafka_producer.flush()
                    log(f"Forwarded debug event to Kafka: {event_payload}")
                except Exception as e:
                    log(f"Error sending debug event to Kafka: {e}")
            else:
                log("Kafka producer not available, event not forwarded")
        else:
            log(f"Received unrecognized message type: {msg_type}")
    except Exception as e:
        log(f"WebSocket message handling error: {e}")

def send_steps(ws, start_index, count):
    with data_lock:
        max_steps = len(simulation_data['replay']['traffic'])
        end_index = min(start_index + count, max_steps)
        base_delay = 0.005
        delay = base_delay * (50 / count) if count > 50 else 0
        for step in simulation_data['replay']['traffic'][start_index:end_index]:
            try:
                ws.send(json.dumps({
                    'type': 'step',
                    'payload': step
                }))
                if delay > 0:
                    time.sleep(delay)
            except Exception as e:
                return
        with active_connections_lock:
            active_connections[ws] = end_index
        try:
            ws.send(json.dumps({
                'type': 'metadata',
                'payload': {
                    'received_steps': max_steps,
                    'total_steps': simulation_data['total_steps'],
                    'buffer_health': (max_steps / simulation_data['total_steps']) * 100
                }
            }))
        except Exception as e:
            pass

@app.route('/')
def serve_index():
    log("Serving index.html")
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_static_files(path):
    full_path = os.path.join(app.static_folder, path)
    if os.path.exists(full_path):
        log(f"Serving static file: {path}")
        return send_from_directory(app.static_folder, path)
    else:
        log(f"Static file not found: {path}")
        return jsonify({'error': 'File not found'}), 404

if __name__ == '__main__':
    log("Starting traffic simulation server")
    threading.Thread(target=consume_messages, daemon=True).start()
    app.run(host='0.0.0.0', port=5002, threaded=True)