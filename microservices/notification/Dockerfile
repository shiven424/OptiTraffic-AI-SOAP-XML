FROM python:3.9

WORKDIR /app

# Copy application files and static WSDL
COPY notification.py /app/
COPY notification.wsdl /app/
COPY requirements.txt /app/

RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 5003

CMD ["python", "notification.py"]
