# from kafka import KafkaConsumer
# from kafka.errors import NoBrokersAvailable
# import json
# import time

# # Kafka consumer configuration
# consumer_config = {
#     'bootstrap_servers': ['kafka:9092'],
#     'group_id': 'traffic-prediction-group',
#     'auto_offset_reset': 'earliest'
# }

# def create_kafka_consumer(retries=5, delay=5):
#     for attempt in range(retries):
#         try:
#             return KafkaConsumer('traffic-data', **consumer_config)
#         except NoBrokersAvailable:
#             if attempt < retries - 1:
#                 print(f"Unable to connect to Kafka. Retrying in {delay} seconds...")
#                 time.sleep(delay)
#             else:
#                 raise

# # Create Kafka consumer
# consumer = create_kafka_consumer()

# # Kafka consumer function
# def consume_traffic_data():
#     for msg in consumer:
#         try:
#             traffic_data = json.loads(msg.value.decode('utf-8'))
#             print(f'Received: {msg.value.decode("utf-8")}')
#             predict_traffic(traffic_data)
#         except json.JSONDecodeError:
#             print(f'Error decoding message: {msg.value}')
#         except Exception as e:
#             print(f'Error processing message: {str(e)}')

# # Dummy prediction model
# def predict_traffic(data):
#     total_vehicles = sum(road['vehicle_count'] for road in data.values())
#     avg_speed = sum(road['avg_speed'] for road in data.values()) / len(data)
    
#     if total_vehicles > 40:
#         print("High traffic predicted. Adjusting signal timings.")
#     else:
#         print("Normal traffic flow predicted.")
    
#     print(f"Average speed: {avg_speed:.2f} km/h")

# if __name__ == '__main__':
#     consume_traffic_data()

