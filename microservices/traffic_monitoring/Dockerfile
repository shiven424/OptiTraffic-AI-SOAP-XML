FROM python:3.9

WORKDIR /app

# Copy application files and static WSDL
COPY traffic_monitoring.py /app/
COPY traffic_monitoring.wsdl /app/
COPY requirements.txt /app/

RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 8000

CMD ["python", "traffic_monitoring.py"]
