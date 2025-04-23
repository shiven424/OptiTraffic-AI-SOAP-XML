FROM python:3.9

WORKDIR /app

# Copy code and WSDL
COPY traffic_signal_predictor.py /app/
COPY traffic_signal_service.wsdl /app/
COPY requirements.txt /app/

RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 5000

CMD ["python", "traffic_signal_predictor.py"]
