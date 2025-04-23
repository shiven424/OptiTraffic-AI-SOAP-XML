import threading, time, json, requests, logging
import os, base64
from flask import Flask
from flask_cors import CORS
from kafka import KafkaConsumer
from cryptography.fernet import Fernet

# Spyne imports
from spyne import Application, rpc, ServiceBase, Unicode, ComplexModel
from spyne.protocol.soap import Soap11
from spyne.server.wsgi import WsgiApplication
from werkzeug.serving import run_simple

logging.basicConfig(level=logging.DEBUG)

# --- Existing Kafka and decryption configuration ---
KAFKA_BROKER = "kafka:9092"
TRAFFIC_TOPIC = "traffic-data"
CONSUMER_GROUP = "traffic-monitoring-group"

# Instead of calling http://traffic_signal:5000/api/traffic,
# we will do a SOAP request to http://traffic_signal:5000
SOAP_URL = "http://traffic_signal:5000"

ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
if not ENCRYPTION_KEY:
    raise ValueError("Missing ENCRYPTION_KEY environment variable")
cipher = Fernet(ENCRYPTION_KEY.encode())

MAX_HISTORY = 100
raw_data_history = []
prediction_history = []

app = Flask(__name__)
CORS(app)

def decrypt_message(encrypted_message):
    try:
        decrypted_data = cipher.decrypt(base64.b64decode(encrypted_message))
        return json.loads(decrypted_data)
    except Exception as e:
        logging.error(f"Decryption error: {e}")
        return None

def consume_raw_data():
    consumer = KafkaConsumer(
        TRAFFIC_TOPIC,
        bootstrap_servers=KAFKA_BROKER,
        group_id=CONSUMER_GROUP,
        auto_offset_reset='earliest',
        enable_auto_commit=True,
        value_deserializer=lambda v: v.decode('utf-8')
    )
    for msg in consumer:
        payload = decrypt_message(msg.value)
        if payload:
            if "timestamp" not in payload:
                payload["timestamp"] = time.time()
            raw_data_history.append(payload)
            if len(raw_data_history) > MAX_HISTORY:
                raw_data_history.pop(0)
        time.sleep(0.1)

def poll_prediction_data():
    """Poll the traffic_signal via SOAP, parse <data>, store in prediction_history."""
    SOAP_ENVELOPE = """<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ts="http://example.com/trafficsignal">
  <soapenv:Header/>
  <soapenv:Body>
    <ts:GetTrafficData/>
  </soapenv:Body>
</soapenv:Envelope>"""
    headers = {
        "Content-Type": "text/xml",
        "SOAPAction": "http://example.com/trafficsignal/GetTrafficData"
    }

    while True:
        try:
            response = requests.post(SOAP_URL, data=SOAP_ENVELOPE, headers=headers, timeout=3)
            if response.status_code == 200:
                from xml.etree import ElementTree as ET
                root = ET.fromstring(response.text)
                ns = "{http://example.com/trafficsignal}"
                data_elem = root.find(f".//{ns}data")
                if data_elem is not None and data_elem.text:
                    pred_snapshot = json.loads(data_elem.text)
                    if "timestamp" not in pred_snapshot:
                        pred_snapshot["timestamp"] = time.time()
                    prediction_history.append(pred_snapshot)
                    if len(prediction_history) > MAX_HISTORY:
                        prediction_history.pop(0)
                else:
                    logging.error("No <data> element found in SOAP or it was empty.")
            else:
                logging.error("Error in SOAP response: %s", response.status_code)
        except Exception as e:
            logging.error("Error polling SOAP predictor: %s", e)
        time.sleep(3)

# Start background threads
threading.Thread(target=consume_raw_data, daemon=True).start()
threading.Thread(target=poll_prediction_data, daemon=True).start()

# --- SOAP Service Definitions ---
# We'll define a simple response model with one Unicode field that holds the JSON string.
class MonitoringDataResponse(ComplexModel):
    __namespace__ = 'http://example.com/trafficmonitoring'
    data = Unicode

class HealthResult(ComplexModel):
    __namespace__ = 'http://example.com/trafficmonitoring'
    status = Unicode

class TrafficMonitoringService(ServiceBase):
    @rpc(_returns=MonitoringDataResponse)
    def GetMonitoringData(ctx):
        # Compute the same combined_data as before:
        total_vehicle_counts = []
        raw_avg_speeds = []
        raw_densities = []
        raw_performance = []

        for snap in raw_data_history:
            summary = snap.get("summary", {})
            total_count = sum(data.get("vehicle_count", 0) for data in summary.values())
            total_vehicle_counts.append(total_count)
            total_speed = 0
            total_density = 0
            count_sum = 0
            for road, data in summary.items():
                cnt = data.get("vehicle_count", 0)
                spd = data.get("avg_speed", 0)
                dens = data.get("density", 0)
                total_speed += spd * cnt
                total_density += dens * cnt
                count_sum += cnt
            avg_speed = total_speed / count_sum if count_sum else 0
            avg_density = total_density / count_sum if count_sum else 0
            raw_avg_speeds.append(avg_speed)
            raw_densities.append(avg_density)
            raw_performance.append(avg_speed * total_count)

        max_vehicle_count = max(total_vehicle_counts) if total_vehicle_counts else 0
        avg_vehicle_count = sum(total_vehicle_counts) / len(total_vehicle_counts) if total_vehicle_counts else 0

        pred_avg_speeds = []
        pred_densities = []
        pred_performance = []
        for snap in prediction_history:
            roads = snap.get("roads", {})
            total_count = sum(data.get("vehicle_count", 0) for data in roads.values())
            total_speed = 0
            total_density = 0
            count_sum = 0
            for road, data in roads.items():
                cnt = data.get("vehicle_count", 0)
                spd = data.get("avg_speed", 0)
                dens = data.get("density", 0)
                total_speed += spd * cnt
                total_density += dens * cnt
                count_sum += cnt
            avg_speed = total_speed / count_sum if count_sum else 0
            avg_density = total_density / count_sum if count_sum else 0
            pred_avg_speeds.append(avg_speed)
            pred_densities.append(avg_density)
            pred_performance.append(avg_speed * total_count)

        # Advanced green analytics (not fully computed here but included as in original)
        raw_green = {}
        for snap in raw_data_history:
            raw_detail = snap.get("raw_detail", "")
            entries = raw_detail.split(',')
            for entry in entries:
                parts = entry.split()
                if len(parts) < 2:
                    continue
                road = parts[0]
                tokens = parts[1:]
                green_count = sum(1 for token in tokens if token.lower() == 'g')
                if road in raw_green:
                    raw_green[road][0] += green_count
                    raw_green[road][1] += len(tokens)
                else:
                    raw_green[road] = [green_count, len(tokens)]
        avg_green_percentage = {}
        for road, (green_total, token_total) in raw_green.items():
            avg_green_percentage[road] = (green_total / token_total * 100) if token_total else 0

        predicted_green = {}
        for snap in prediction_history:
            gl = snap.get("green_light")
            if gl:
                predicted_green[gl] = predicted_green.get(gl, 0) + 1

        analytics = {
            "max_vehicle_count": max_vehicle_count,
            "avg_vehicle_count": avg_vehicle_count,
            "raw_avg_speeds": raw_avg_speeds,
            "raw_densities": raw_densities,
            "raw_performance": raw_performance,
            "pred_avg_speeds": pred_avg_speeds,
            "pred_densities": pred_densities,
            "pred_performance": pred_performance,
            "predicted_green_distribution": predicted_green,
            "avg_green_percentage": avg_green_percentage,
            "raw_history_count": len(raw_data_history),
            "prediction_history_count": len(prediction_history)
        }

        combined_data = {
            "raw_data_history": raw_data_history,
            "prediction_history": prediction_history,
            "analytics": analytics
        }

        # Return as a JSON string in the SOAP response.
        return MonitoringDataResponse(data=json.dumps(combined_data))
    
    @rpc(_returns=HealthResult)
    def Health(ctx):
        return HealthResult(status="ok")

# Create the Spyne application.
soap_app = Application(
    [TrafficMonitoringService],
    tns='http://example.com/trafficmonitoring',
    in_protocol=Soap11(validator='lxml'),
    out_protocol=Soap11()
)

wsgi_app = WsgiApplication(soap_app)

# --- CORS Middleware (reuse) ---
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

# --- Static WSDL Middleware ---
def static_wsdl_app(environ, start_response):
    query = environ.get('QUERY_STRING', '')
    if 'wsdl' in query:
        try:
            with open('traffic_monitoring_service.wsdl', 'rb') as f:
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
    run_simple('0.0.0.0', 8000, static_wsdl_app)
