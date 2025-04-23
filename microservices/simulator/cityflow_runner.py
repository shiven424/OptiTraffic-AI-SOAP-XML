from kafka import KafkaProducer, KafkaAdminClient
from kafka.errors import NoBrokersAvailable
from kafka.admin import NewTopic
import cityflow
import json
import os
import time
from datetime import datetime
import base64
from cryptography.fernet import Fernet

# Load encryption key and create cipher
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
if not ENCRYPTION_KEY:
    raise ValueError("Missing ENCRYPTION_KEY environment variable")
cipher = Fernet(ENCRYPTION_KEY.encode())

def encrypt_message(message):
    """Encrypt JSON message using Fernet and return a base64-encoded string."""
    json_data = json.dumps(message)
    encrypted_data = cipher.encrypt(json_data.encode())
    return base64.b64encode(encrypted_data).decode()

# Configuration with updated encryption serializer
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
KAFKA_CONFIG = {
    'bootstrap_servers': ['kafka:9092'],
    # Encrypt each message before sending
    'value_serializer': lambda v: encrypt_message(v).encode('utf-8'),
    'acks': 'all',
    'retries': 5,
    'linger_ms': 1000,
    'max_block_ms': 30000
}

REPLAY_FILES = {
    'roadnet': os.path.join(BASE_DIR, 'replay_roadnet.json'),
    'traffic': os.path.join(BASE_DIR, 'replay_traffic.json')
}

TOPIC_CONFIG = {
    'step-data': {
        'num_partitions': 1,
        'replication_factor': 1
    },
    'replay-roadnet': {
        'num_partitions': 1,
        'replication_factor': 1
    },
    'replay-traffic': {
        'num_partitions': 1,
        'replication_factor': 1
    },
    'traffic-notifications': {    # New topic for notifications
        'num_partitions': 1,
        'replication_factor': 1
    }
}

def log(message):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    print(f"{timestamp} {message}")

def get_vehicle_position(info):
    """Calculate position from available vehicle data"""
    try:
        return [info['x'], info['y']]
    except KeyError:
        try:
            road_pos = info.get('pos', 0)
            lane_width = 3.5
            return [
                road_pos * lane_width,
                info.get('lane_index', 0) * lane_width
            ]
        except KeyError:
            return [0, 0]

def get_traffic_light_states(step, roadnet_data):
    """
    Calculate traffic light states for each intersection with traffic lights.
    This is a sample approach and may differ in your actual logic.
    """
    results = []
    road_lane_counts = {road['id']: len(road.get('lanes', [])) for road in roadnet_data.get('roads', [])}
    for intersection in roadnet_data.get('intersections', []):
        if 'trafficLight' in intersection:
            tl_id = intersection['id']
            tl_config = intersection['trafficLight']
            phases = tl_config.get('lightphases', [])
            total_cycle = sum(phase.get('time', 0) for phase in phases)
            if total_cycle <= 0:
                continue
            current_time_in_cycle = step % total_cycle
            accumulated_time = 0
            current_phase_index = 0
            for idx, phase in enumerate(phases):
                accumulated_time += phase.get('time', 0)
                if accumulated_time > current_time_in_cycle:
                    current_phase_index = idx
                    break
            phase_data = phases[current_phase_index]
            controlled_indices = set(tl_config.get('roadLinkIndices', range(len(intersection.get('roadLinks', [])))))
            road_states = {}
            for rl_idx, road_link in enumerate(intersection.get('roadLinks', [])):
                if rl_idx not in controlled_indices:
                    state_char = 'i'
                else:
                    state_char = 'g' if rl_idx in phase_data.get('availableRoadLinks', []) else 'r'
                start_road = road_link.get('startRoad')
                if start_road is None:
                    continue
                if start_road not in road_states:
                    lane_count = road_lane_counts.get(start_road, 1)
                    road_states[start_road] = ['r'] * lane_count
                for lane_link in road_link.get('laneLinks', []):
                    lane_idx = lane_link.get('startLaneIndex')
                    if lane_idx is None or lane_idx < 0 or lane_idx >= len(road_states[start_road]):
                        continue
                    if state_char == 'i':
                        road_states[start_road][lane_idx] = 'i'
                    elif state_char == 'g':
                        if road_states[start_road][lane_idx] != 'i':
                            road_states[start_road][lane_idx] = 'g'
                    else:
                        if road_states[start_road][lane_idx] not in ['r', 'i']:
                            road_states[start_road][lane_idx] = 'r'
            lights_list = []
            for road_id, states in road_states.items():
                lights_list.append({'roadLink': road_id, 'states': states})
            results.append({'id': tl_id, 'lights': lights_list})
    return results

def _calculate_outline(intersection):
    try:
        x = intersection["point"]["x"]
        y = intersection["point"]["y"]
        size = intersection.get("width", 30.0)
    except KeyError:
        x = intersection.get("point", {}).get("x", 0)
        y = intersection.get("point", {}).get("y", 0)
        size = 30.0
    return [
        x - size*2, -y - size*2,
        x + size*2, -y - size*2,
        x + size*2, -y + size*2,
        x - size*2, -y + size*2
    ]

def convert_cityflow_roadnet(cityflow_data):
    """Convert CityFlow roadnet to frontend-compatible format"""
    nodes = []
    edges = []
    for intersection in cityflow_data.get("intersections", []):
        try:
            point = intersection.get("point", {})
            nodes.append({
                "id": intersection["id"],
                "point": [point.get("x", 0), point.get("y", 0)],
                "virtual": intersection.get("virtual", False),
                "outline": _calculate_outline(intersection),
                "width": intersection.get("width", 30.0),
                "has_traffic_light": 'trafficLight' in intersection
            })
        except KeyError as e:
            log(f"Skipping invalid intersection: {e}")
            continue
    for road in cityflow_data.get("roads", []):
        try:
            if len(road.get("points", [])) < 2:
                continue
            edges.append({
                "id": road["id"],
                "from": road["startIntersection"],
                "to": road["endIntersection"],
                "points": [[p.get("x", 0), p.get("y", 0)] for p in road.get("points", [])],
                "laneWidths": [lane.get("width", 3.5) for lane in road.get("lanes", [])],
                "nLane": len(road.get("lanes", []))
            })
        except KeyError as e:
            log(f"Skipping invalid road: {e}")
            continue
    return {
        "static": {
            "nodes": nodes,
            "edges": edges
        },
        "total_steps": 1000
    }

def setup_directories():
    for directory in ['C:/kafka-logs', 'C:/zookeeper-data', 'C:/zookeeper-logs']:
        if not os.path.exists(directory):
            os.makedirs(directory)
            log(f"Created directory: {directory}")

def create_kafka_topics():
    try:
        admin = KafkaAdminClient(bootstrap_servers=KAFKA_CONFIG['bootstrap_servers'])
        existing_topics = admin.list_topics()
        for topic, config in TOPIC_CONFIG.items():
            if topic not in existing_topics:
                admin.create_topics([NewTopic(
                    name=topic,
                    num_partitions=config['num_partitions'],
                    replication_factor=config['replication_factor']
                )])
                log(f"Created topic: {topic}")
    except Exception as e:
        log(f"Topic creation error: {str(e)}")

def create_kafka_producer():
    for attempt in range(10):
        try:
            producer = KafkaProducer(**KAFKA_CONFIG)
            producer.metrics()
            return producer
        except NoBrokersAvailable:
            log(f"Kafka broker not available (attempt {attempt+1}/10)")
            time.sleep(5)
    raise RuntimeError("Failed to connect to Kafka")

def extract_road(info):
    """
    Extracts the current road ID.
    First, if the 'drivable' field is present and starts with "road_",
    returns the first four underscore-separated tokens.
    Otherwise, if 'road' is provided, returns that.
    If still not available, checks the 'route' field.
    """
    drivable = info.get("drivable", "")
    if drivable:
        if drivable.startswith("road_"):
            return '_'.join(drivable.split('_')[:4])
        else:
            return drivable
    road = info.get("road", "")
    if road:
        return road
    route = info.get("route", "")
    if route:
        parts = route.strip().split()
        if parts and parts[0].startswith("road_"):
            return parts[0]
    return "unknown"

def parse_vehicle(vehicle_str):
    """Parse vehicle data from replay lines.
       (Replay data does not include drivable info; 'road' remains 'unknown'.)
    """
    try:
        parts = vehicle_str.strip().split()
        if len(parts) != 7:
            log(f"Skipping malformed vehicle line: {vehicle_str}")
            return None
        return {
            'position': [float(parts[0]), float(parts[1])],
            'direction': float(parts[2]),
            'id': parts[3],
            'status': parts[4],
            'speed': float(parts[5]),
            'length': float(parts[6]),
            'road': "unknown"
        }
    except Exception as e:
        log(f"Vehicle parsing error: {vehicle_str} → {str(e)}")
        return None

def parse_traffic_light(light_str):
    """Parse traffic light format: road_id state1 state2 ..."""
    try:
        parts = light_str.strip().split()
        if not parts:
            return None
        return {
            'id': parts[0],
            'states': parts[1:]
        }
    except Exception as e:
        log(f"Invalid traffic light data: {light_str} - {str(e)}")
        return None

def send_replay_data(producer):
    log("Finalizing replay data...")
    time.sleep(2)
    try:
        if os.path.exists(REPLAY_FILES['roadnet']):
            with open(REPLAY_FILES['roadnet'], 'r') as f:
                cityflow_roadnet = json.load(f)
                converted_roadnet = convert_cityflow_roadnet(cityflow_roadnet)
                if len(converted_roadnet['static']['nodes']) == 0:
                    log("No valid nodes found in converted roadnet!")
                else:
                    producer.send('replay-roadnet', converted_roadnet)
                    log(f"Sent roadnet with {len(converted_roadnet['static']['nodes'])} nodes and {len(converted_roadnet['static']['edges'])} edges")
        if os.path.exists(REPLAY_FILES['traffic']):
            with open(REPLAY_FILES['traffic'], 'r') as f:
                for step, line in enumerate(f):
                    line = line.strip()
                    if not line:
                        continue
                    vehicles = [parse_vehicle(v) for v in line.split(';', 1)[0].split(',') if v]
                    traffic_lights = get_traffic_light_states(step, cityflow_roadnet)
                    producer.send('replay-traffic', {
                        'step': step,
                        'vehicles': [v for v in vehicles if v],
                        'traffic_lights': traffic_lights
                    })
            log("Sent structured traffic data")
    except Exception as e:
        log(f"Replay data error: {str(e)}")

def main():
    setup_directories()
    create_kafka_topics()
    producer = None
    try:
        producer = create_kafka_producer()
        log("Kafka producer initialized")
        log("Initializing CityFlow engine...")
        eng = cityflow.Engine(os.path.join(BASE_DIR, "config.json"), thread_num=1)
        with open(os.path.join(BASE_DIR, "roadnet.json")) as f:
            original_roadnet = json.load(f)
        log("CityFlow engine started")
        total_steps = 1000
        log(f"Starting simulation with {total_steps} steps")
        target_fps = 1
        frame_duration = 1.0 / target_fps
        for step in range(total_steps):
            eng.next_step()
            if step % 10 == 0:
                vehicles = []
                for vid in eng.get_vehicles():
                    try:
                        info = eng.get_vehicle_info(vid)
                        log(f"Vehicle info for {vid}: {info}")
                        road = extract_road(info)
                        vehicle_data = {
                            'id': vid,
                            'position': get_vehicle_position(info),
                            'direction': info.get('angle', 0),
                            'speed': info.get('speed', 0),
                            'road': road,
                            'lane': info.get('lane', 0)
                        }
                        vehicles.append(vehicle_data)
                        log(f"Sending vehicle data: {vehicle_data}")
                    except Exception as e:
                        log(f"Vehicle error {vid}: {str(e)}")
                        continue
                traffic_lights = get_traffic_light_states(step, original_roadnet)
                producer.send('traffic-data', {
                    'step': step,
                    'vehicles': vehicles,
                    'traffic_lights': traffic_lights
                })
                log(f"Sent metrics for step {step}")
            with open(REPLAY_FILES['traffic'], 'a') as f:
                vehicle_entries = []
                for vid in eng.get_vehicles():
                    try:
                        info = eng.get_vehicle_info(vid)
                        pos = get_vehicle_position(info)
                        road = extract_road(info)
                        vehicle_entries.append(
                            f"{pos[0]} {pos[1]} {info.get('angle', 0)} {vid} 0 {info.get('speed',0)} {info.get('length',5)} {road}"
                        )
                    except Exception as e:
                        log(f"Replay vehicle error: {str(e)}")
                        continue
                light_entries = []
                for tl in get_traffic_light_states(step, original_roadnet):
                    for light in tl['lights']:
                        states_str = ' '.join(light['states'])
                        light_entries.append(f"{light['roadLink']} {states_str}")
                f.write(f"{','.join(vehicle_entries)};{','.join(light_entries)}\n")
        with open(REPLAY_FILES['roadnet'], 'w') as f:
            json.dump(original_roadnet, f)
    except KeyboardInterrupt:
        log("Simulation interrupted by user")
    except Exception as e:
        log(f"Critical error: {str(e)}")
    finally:
        if producer:
            send_replay_data(producer)
            producer.flush()
            producer.close()
        log("Simulation completed")

if __name__ == '__main__':
    main()
