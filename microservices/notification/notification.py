from kafka import KafkaConsumer
import threading, json, time, logging
import os, base64, smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from cryptography.fernet import Fernet
from datetime import datetime

# Spyne imports for SOAP service
from spyne import Application, rpc, ServiceBase, Unicode, ComplexModel, Array
from spyne.protocol.soap import Soap11
from spyne.server.wsgi import WsgiApplication
from werkzeug.serving import run_simple


# Load encryption key and set up cipher (for Kafka decryption)
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
if not ENCRYPTION_KEY:
    raise ValueError("Missing ENCRYPTION_KEY environment variable")
cipher = Fernet(ENCRYPTION_KEY.encode())

def decrypt_message(encrypted_message):
    try:
        decrypted_data = cipher.decrypt(base64.b64decode(encrypted_message))
        return json.loads(decrypted_data)
    except Exception as e:
        logging.error(f"Decryption error: {e}")
        return None

# Kafka configuration
KAFKA_BROKER = "kafka:9092"
NOTIFICATIONS_TOPIC = "traffic-notifications"

# In-memory store for notifications
notifications_log = []

# SMTP configuration for Gmail (email sending code remains unchanged)
GMAIL_USER = os.getenv("GMAIL_USER")
if not GMAIL_USER:
    raise ValueError("Missing GMAIL_USER environment variable")
GMAIL_PASSWORD = os.getenv("GMAIL_PASSWORD")
if not GMAIL_PASSWORD:
    raise ValueError("Missing GMAIL_PASSWORD environment variable")
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587

def send_email_notification(event):
    event_type = event.get("event_type", "unknown").capitalize()
    target_type = event.get("target_type", "N/A")
    target_id = event.get("target_id", "N/A")
    timestamp = event.get("timestamp", datetime.now().isoformat())
    
    # Always send the email to the authority's email address
    recipient = "naggender2@gmail.com"
    subject = f"OptiTraffic AI Alert: {event_type} Notification"
    
    # HTML email content
    html_content = f"""
    <html>
      <head>
        <style>
          body {{
            font-family: Arial, sans-serif;
            background-color: #f4f4f4;
            padding: 20px;
          }}
          .container {{
            background-color: #ffffff;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }}
          h1 {{
            color: #333333;
          }}
          p {{
            font-size: 14px;
            color: #555555;
          }}
          .details {{
            margin: 20px 0;
          }}
          .details li {{
            margin-bottom: 8px;
          }}
          .footer {{
            font-size: 12px;
            color: #888888;
          }}
        </style>
      </head>
      <body>
        <div class="container">
          <h1>OptiTraffic AI Notification</h1>
          <p>Dear Authority,</p>
          <p>A new traffic event has been detected. Please review the details below:</p>
          <ul class="details">
            <li><strong>Event Type:</strong> {event_type}</li>
            <li><strong>Target Type:</strong> {target_type}</li>
            <li><strong>Target ID:</strong> {target_id}</li>
            <li><strong>Timestamp:</strong> {timestamp}</li>
          </ul>
          <p>Please log in to your dashboard for further details and follow-up actions.</p>
          <p>Regards,<br><strong>OptiTraffic AI Team</strong></p>
          <p class="footer">This is an automated message from the OptiTraffic AI system.</p>
        </div>
      </body>
    </html>
    """
    
    # Compose the email using MIME
    msg = MIMEMultipart("alternative")
    msg["From"] = GMAIL_USER
    msg["To"] = recipient
    msg["Subject"] = subject
    msg.attach(MIMEText(html_content, "html"))

    # Log the notification in memory
    notifications_log.append({
        "event": event,
        "email_sent_to": recipient,
        "timestamp": timestamp
    })
    
    retries = 3
    for attempt in range(retries):
        try:
            server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
            server.starttls()
            server.login(GMAIL_USER, GMAIL_PASSWORD)
            server.sendmail(GMAIL_USER, recipient, msg.as_string())
            server.quit()
            logging.info(f"Email successfully sent to {recipient}")
            return
        except smtplib.SMTPException as e:
            logging.error(f"Error sending email via Gmail SMTP (attempt {attempt+1}/{retries}): {e}")
            time.sleep(3)

def kafka_consumer_thread():
    consumer = KafkaConsumer(
        NOTIFICATIONS_TOPIC,
        bootstrap_servers=KAFKA_BROKER,
        auto_offset_reset='earliest',
        enable_auto_commit=True,
        value_deserializer=lambda v: decrypt_message(v.decode('utf-8'))
    )
    for msg in consumer:
        event = msg.value
        if event is None:
            continue
        logging.info(f"Received event from Kafka: {event}")
        send_email_notification(event)

# Start Kafka consumer thread
threading.Thread(target=kafka_consumer_thread, daemon=True).start()

# --- SOAP Service Definitions for Notification Service ---

# Define a complex type for NotificationEvent
class NotificationEvent(ComplexModel):
    __namespace__ = 'http://example.com/notification'
    event_type = Unicode
    target_type = Unicode
    target_id = Unicode
    timestamp = Unicode

# Define a complex type for Notification
class Notification(ComplexModel):
    __namespace__ = 'http://example.com/notification'
    event = NotificationEvent
    email_sent_to = Unicode
    timestamp = Unicode


class NotificationsResponse(ComplexModel):
    __namespace__ = 'http://example.com/notification'
    notifications = Array(Notification)

# Define Health response model
class HealthResult(ComplexModel):
    __namespace__ = 'http://example.com/notification'
    status = Unicode

class NotificationService(ServiceBase):
    @rpc(_returns=NotificationsResponse)
    def GetNotifications(ctx):
        logging.debug("GetNotifications called; notifications_log length: %s", len(notifications_log))
        result = []
        for notif in notifications_log:
            evt = notif.get("event", {})
            event_obj = NotificationEvent(
                event_type=evt.get("event_type", ""),
                target_type=evt.get("target_type", ""),
                target_id=evt.get("target_id", ""),
                timestamp=evt.get("timestamp", "")
            )
            notif_obj = Notification(
                event=event_obj,
                email_sent_to=notif.get("email_sent_to", ""),
                timestamp=notif.get("timestamp", "")
            )
            result.append(notif_obj)
        return NotificationsResponse(notifications=result)
    
    @rpc(_returns=HealthResult)
    def Health(ctx):
        return HealthResult(status="ok")

# Create the Spyne application for the Notification service.
soap_app = Application(
    [NotificationService],
    tns='http://example.com/notification',
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

# --- Static WSDL Middleware for Notification Service ---
def static_wsdl_app(environ, start_response):
    query = environ.get('QUERY_STRING', '')
    if 'wsdl' in query:
        try:
            with open('notification_service.wsdl', 'rb') as f:
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
    # Run the notification SOAP service on port 5003 inside the container.
    run_simple('0.0.0.0', 5003, static_wsdl_app)
