import os
import numpy as np
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense
from tensorflow.keras.utils import to_categorical

current_dir = os.path.dirname(os.path.abspath(__file__))

# Define file paths for the preprocessed data
X_train_path = os.path.join(current_dir, "X_train.npy")
y_train_path = os.path.join(current_dir, "y_train.npy")
X_test_path = os.path.join(current_dir, "X_test.npy")
y_test_path = os.path.join(current_dir, "y_test.npy")

# Parameters 
sequence_length = 5
num_roads = 4
features_per_road = 3
input_dim = num_roads * features_per_road  

# Load preprocessed data
X_train = np.load(X_train_path)
y_train = np.load(y_train_path)
X_test = np.load(X_test_path)
y_test = np.load(y_test_path)

# One-hot encode the target labels
y_train_cat = to_categorical(y_train, num_classes=num_roads)
y_test_cat = to_categorical(y_test, num_classes=num_roads)

# Build the LSTM model
model = Sequential([
    LSTM(32, input_shape=(sequence_length, input_dim), return_sequences=False),
    Dense(16, activation='relu'),
    Dense(num_roads, activation='softmax')
])

model.compile(optimizer='adam', loss='categorical_crossentropy', metrics=['accuracy'])

# Train the model
history = model.fit(X_train, y_train_cat, epochs=20, batch_size=32, validation_data=(X_test, y_test_cat))

# Save the trained model to the ai_model folder
model_save_path = os.path.join(current_dir, "traffic_signal_model.h5")
model.save(model_save_path)

print("Model training complete and saved as", model_save_path)
