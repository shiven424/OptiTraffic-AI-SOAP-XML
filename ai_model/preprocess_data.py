import json
import numpy as np
import os

# Get the directory of this script (ai_model folder)
current_dir = os.path.dirname(os.path.abspath(__file__))

# Define file paths
log_file_path = os.path.join(current_dir, "traffic_data_log.jsonl")
X_train_path = os.path.join(current_dir, "X_train.npy")
y_train_path = os.path.join(current_dir, "y_train.npy")
X_test_path = os.path.join(current_dir, "X_test.npy")
y_test_path = os.path.join(current_dir, "y_test.npy")

# Parameters
sequence_length = 5  # Number of snapshots per sequence
num_roads = 4        # Based on roads: road_0_1_0, road_1_0_1, road_2_1_2, road_1_2_3
features_per_road = 3  # vehicle_count, avg_speed, density

# Containers for sequences and labels
X_sequences = []  # Input sequences
y_labels = []     # Target labels

# Helper function: decide the target for a snapshot based on heuristic (highest vehicle_count)
def get_target_from_snapshot(snapshot):
    roads = snapshot.get("roads", {})
    road_counts = [(road_id, data.get("vehicle_count", 0)) for road_id, data in roads.items()]
    if road_counts:
        optimal_road = max(road_counts, key=lambda x: x[1])[0]
    else:
        optimal_road = None
    return optimal_road

# Define consistent road ordering
road_order = ["road_0_1_0", "road_1_0_1", "road_2_1_2", "road_1_2_3"]
road_to_index = {road: idx for idx, road in enumerate(road_order)}

# Read all snapshots from the log file
snapshots = []
with open(log_file_path, "r") as f:
    for line in f:
        snapshot = json.loads(line.strip())
        snapshots.append(snapshot)

# Build sequences using a sliding window over the snapshots
for i in range(len(snapshots) - sequence_length):
    sequence = snapshots[i : i + sequence_length]
    # For each snapshot in the sequence, extract features for each road.
    # Each snapshot will become a flattened vector of features from all roads.
    sequence_features = []
    for snap in sequence:
        snapshot_features = []
        for road in road_order:
            data = snap.get("roads", {}).get(road, {})
            vehicle_count = data.get("vehicle_count", 0)
            avg_speed = data.get("avg_speed", 0)
            density = data.get("density", 0)
            snapshot_features.extend([vehicle_count, avg_speed, density])
        sequence_features.append(snapshot_features)
    X_sequences.append(sequence_features)
    
    # Define the target: use the snapshot immediately following the sequence
    target_snapshot = snapshots[i + sequence_length]
    target_road = get_target_from_snapshot(target_snapshot)
    if target_road is not None:
        y_labels.append(road_to_index[target_road])
    else:
        y_labels.append(0)  

# Convert lists to NumPy arrays
X = np.array(X_sequences)  
y = np.array(y_labels)    


split_idx = int(0.8 * len(X))
X_train, X_test = X[:split_idx], X[split_idx:]
y_train, y_test = y[:split_idx], y[split_idx:]

# Save the preprocessed arrays to the ai_model folder
np.save(X_train_path, X_train)
np.save(y_train_path, y_train)
np.save(X_test_path, X_test)
np.save(y_test_path, y_test)

print("Preprocessing complete!")
print("X_train shape:", X_train.shape)
print("y_train shape:", y_train.shape)
