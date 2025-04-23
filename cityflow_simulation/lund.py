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

threading.Thread(target=consume_raw_data, daemon=True).start()
threading.Thread(target=poll_prediction_data, daemon=True).start()

# -------- SOAP Service for TrafficMonitoring --------
class MonitoringDataResponse(ComplexModel):
    __namespace__ = 'http://example.com/trafficmonitoring'
    data = Unicode

class HealthResult(ComplexModel):
    __namespace__ = 'http://example.com/trafficmonitoring'
    status = Unicode

class TrafficMonitoringService(ServiceBase):
    @rpc(_returns=MonitoringDataResponse)
    def GetMonitoringData(ctx):
        # (same logic that merges raw_data_history + prediction_history)
        # produce the same JSON as you originally did
        ...
        return MonitoringDataResponse(data=json.dumps(combined_data))

    @rpc(_returns=HealthResult)
    def Health(ctx):
        return HealthResult(status="ok")

soap_app = Application(
    [TrafficMonitoringService],
    tns='http://example.com/trafficmonitoring',
    in_protocol=Soap11(validator='lxml'),
    out_protocol=Soap11()
)
wsgi_app = WsgiApplication(soap_app)

def cors_app(app):
    ...
app_with_cors = cors_app(wsgi_app)

def static_wsdl_app(environ, start_response):
    ...
    # same as your existing code
if __name__ == '__main__':
    run_simple('0.0.0.0', 8000, static_wsdl_app)
