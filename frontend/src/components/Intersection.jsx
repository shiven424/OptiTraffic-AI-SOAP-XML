import { useEffect, useState, useRef } from 'react';
import Road from './Road';
import './Intersection.css';

const FRAME_INTERVAL = 100; // ms between animation updates
const SPEED = 0.02;         // how fast cars move per frame when green

const Intersection = ({ data }) => {
  // Holds { [vehicleId]: { road, progress, lane, queueIndex } }
  const [vehiclePositions, setVehiclePositions] = useState({});

  // For latest data in our animation loop:
  const latestDataRef = useRef(data);
  useEffect(() => {
    latestDataRef.current = data;
  }, [data]);

  // -- 1) ANIMATION LOOP: increment progress on the green road.
  useEffect(() => {
    const timer = setInterval(() => {
      setVehiclePositions((prevPositions) => {
        const updated = { ...prevPositions };
        const currentData = latestDataRef.current;

        // For each vehicle in state:
        for (const [vehicleId, vPos] of Object.entries(updated)) {
          // If this vehicle's road is the green road, move it forward
          if (vPos.road === currentData.green_light) {
            updated[vehicleId] = {
              ...vPos,
              progress: Math.min(1.0, vPos.progress + SPEED),
            };
          }
        }

        // Remove cars that have crossed the intersection (progress >= 1)
        for (const [vehicleId, vPos] of Object.entries(updated)) {
          if (vPos.progress >= 1.0) {
            delete updated[vehicleId];
          }
        }

        return updated;
      });
    }, FRAME_INTERVAL);

    return () => clearInterval(timer);
  }, []);

  // -- 2) ON NEW DATA: reconcile which vehicles exist and how they're queued
  useEffect(() => {
    setVehiclePositions((prevPositions) => {
      const newPositions = { ...prevPositions };

      // For each road in the new data:
      Object.entries(data.roads).forEach(([roadId, roadData]) => {
        const vehicleIds = roadData.vehicle_ids;
        const count = roadData.vehicle_count || 0;

        // We'll assign each vehicle an index in the queue (0 = front, count-1 = back)
        vehicleIds.forEach((vid, index) => {
          if (!newPositions[vid]) {
            // A new vehicle: place it on this road, 
            // with an initial progress so the front car is near the intersection
            // and the last car is further away.
            const queueProgress = 1 - (index / count);

            newPositions[vid] = {
              road: roadId,
              progress: Math.max(0, queueProgress),  
              lane: index % 3,                      
              queueIndex: index
            };
          } else {
            // Vehicle already known; update road & queueIndex
            newPositions[vid] = {
              ...newPositions[vid],
              road: roadId,
              queueIndex: index
            };
          }
        });
      });

      // Remove vehicles that no longer appear in the new data
      const allNewIds = Object.values(data.roads)
        .flatMap((r) => r.vehicle_ids);
      for (const vid of Object.keys(newPositions)) {
        if (!allNewIds.includes(vid)) {
          delete newPositions[vid];
        }
      }

      return newPositions;
    });
  }, [data]);

  // Intersection box dimensions
  const BOX_X = 400, BOX_Y = 400, BOX_SIZE = 200;

  // Get traffic light class based on current mode
  const getLightClass = (roadId) => {
    if (!data?.green_light) return 'red';
    if (data.green_light !== roadId) return 'red';
    
    switch(data.mode) {
      case 'fixed': return 'fixed-green';
      case 'manual': return 'manual-green';
      default: return 'ai-green';
    }
  };

  return (
    <div className="intersection-container">
      <svg viewBox="0 0 1000 1000">
        {/* Draw roads */}
        <Road
          roadId="road_0_1_0"
          direction="north"
          vehiclePositions={vehiclePositions}
          data={data}
          box={{ x: BOX_X, y: BOX_Y, size: BOX_SIZE }}
        />
        <Road
          roadId="road_1_0_1"
          direction="east"
          vehiclePositions={vehiclePositions}
          data={data}
          box={{ x: BOX_X, y: BOX_Y, size: BOX_SIZE }}
        />
        <Road
          roadId="road_2_1_2"
          direction="south"
          vehiclePositions={vehiclePositions}
          data={data}
          box={{ x: BOX_X, y: BOX_Y, size: BOX_SIZE }}
        />
        <Road
          roadId="road_1_2_3"
          direction="west"
          vehiclePositions={vehiclePositions}
          data={data}
          box={{ x: BOX_X, y: BOX_Y, size: BOX_SIZE }}
        />

        {/* Gray box in center */}
        <rect x={BOX_X} y={BOX_Y} width={BOX_SIZE} height={BOX_SIZE} fill="#444" />

        {/* Traffic lights with mode-specific styling */}
        <circle
          cx={BOX_X + BOX_SIZE / 2}
          cy={BOX_Y + 40}
          r="15"
          className={`traffic-light ${getLightClass('road_0_1_0')}`}
        />
        <circle
          cx={BOX_X + BOX_SIZE - 40}
          cy={BOX_Y + BOX_SIZE / 2}
          r="15"
          className={`traffic-light ${getLightClass('road_1_0_1')}`}
        />
        <circle
          cx={BOX_X + BOX_SIZE / 2}
          cy={BOX_Y + BOX_SIZE - 40}
          r="15"
          className={`traffic-light ${getLightClass('road_2_1_2')}`}
        />
        <circle
          cx={BOX_X + 40}
          cy={BOX_Y + BOX_SIZE / 2}
          r="15"
          className={`traffic-light ${getLightClass('road_1_2_3')}`}
        />
      </svg>
    </div>
  );
};

export default Intersection;