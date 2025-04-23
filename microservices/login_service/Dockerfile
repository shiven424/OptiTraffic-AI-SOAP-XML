FROM python:3.9

WORKDIR /app

# Copy application files
COPY login_api.py /app/
COPY login_service.wsdl /app/
COPY requirements.txt /app/

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 5001

CMD ["python", "login_api.py"]
