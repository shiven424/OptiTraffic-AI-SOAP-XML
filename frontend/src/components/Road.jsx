import React from 'react';
import './Road.css';

const Road = ({ roadId, direction, vehiclePositions, data, box }) => {
  const { x: BOX_X, y: BOX_Y, size: BOX_SIZE } = box;

  // Grab the current road data from the snapshot
  const roadData = data.roads[roadId] || {};
  const vehicleCount = roadData.vehicle_count || 0;

  // Filter only the vehicles that belong on this road
  const vehiclesOnRoad = Object.entries(vehiclePositions)
    .filter(([vid, v]) => v.road === roadId)
    .map(([vid, v]) => ({ vehicleId: vid, ...v }));

  // Sort by queueIndex so front is drawn last (optional)
  vehiclesOnRoad.sort((a, b) => a.queueIndex - b.queueIndex);

  // Basic geometry for each road
  const config = {
    north: {
      path: `M 400 0 L 400 ${BOX_Y} L 600 ${BOX_Y} L 600 0`,
      lanes: [450, 500, 550],
      label: { x: 380, y: 200, rotate: -90 },
    },
    east: {
      path: `M ${BOX_X + BOX_SIZE} 400 L 1000 400 L 1000 600 L ${
        BOX_X + BOX_SIZE
      } 600`,
      lanes: [450, 500, 550],
      label: {
        x: (BOX_X + BOX_SIZE + 1000) / 2,
        y: 380,
        rotate: 0,
      },
    },
    south: {
      path: `M 400 ${BOX_Y + BOX_SIZE} L 400 1000 L 600 1000 L 600 ${
        BOX_Y + BOX_SIZE
      }`,
      lanes: [450, 500, 550],
      label: {
        x: 620,
        y: (BOX_Y + BOX_SIZE + 1000) / 2,
        rotate: 90,
      },
    },
    west: {
      path: `M 0 400 L ${BOX_X} 400 L ${BOX_X} 600 L 0 600`,
      lanes: [450, 500, 550],
      label: { x: BOX_X / 2, y: 380, rotate: 0 },
    },
  }[direction];

  return (
    <g className={`road-container ${direction}`}>
      {/* Road Surface */}
      <path
        d={config.path}
        className={`road-surface congestion-${Math.floor((roadData.density || 0) * 3)}`}
      />

      {/* Lane markers */}
      {config.lanes.map((pos, i) => (
        <path
          key={i}
          d={getLanePath(direction, pos, BOX_X, BOX_Y, BOX_SIZE)}
          className="lane-marker"
        />
      ))}

      {/* Draw each vehicle circle */}
      {vehiclesOnRoad.map(({ vehicleId, progress, lane }) => {
        const { x, y } = calculatePosition(direction, lane, progress);
        return (
          <circle
            key={vehicleId}
            cx={x}
            cy={y}
            r="8"
            className="vehicle"
          />
        );
      })}

      {/* Vehicle Count Label */}
      <text
        x={config.label.x}
        y={config.label.y}
        transform={`rotate(${config.label.rotate}, ${config.label.x}, ${config.label.y})`}
        className="vehicle-count"
        style={{
          fontSize: '24px',
          fill: '#fff',
          textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
        }}
      >
        Vehicles: {vehicleCount}
      </text>
    </g>
  );
};

function getLanePath(direction, pos, BOX_X, BOX_Y, BOX_SIZE) {
  if (direction === 'north') {
    return `M ${pos} 0 L ${pos} ${BOX_Y}`;
  }
  if (direction === 'south') {
    return `M ${pos} ${BOX_Y + BOX_SIZE} L ${pos} 1000`;
  }
  if (direction === 'east') {
    return `M ${BOX_X + BOX_SIZE} ${pos} L 1000 ${pos}`;
  }
  return `M 0 ${pos} L ${BOX_X} ${pos}`;
}

// Convert progress -> (x, y) for each direction
function calculatePosition(direction, lane, progress) {
  const lanePos = 450 + lane * 50;
  const roadLength = 400;
  switch (direction) {
    case 'north':
      // 0 -> top of road, 1 -> intersection
      return { x: lanePos, y: roadLength * progress };
    case 'south':
      // 0 -> bottom, 1 -> intersection
      return { x: lanePos, y: 1000 - roadLength * progress };
    case 'east':
      // 0 -> far right, 1 -> intersection
      return { x: 1000 - roadLength * progress, y: lanePos };
    case 'west':
      // 0 -> far left, 1 -> intersection
      return { x: roadLength * progress, y: lanePos };
    default:
      return { x: 0, y: 0 };
  }
}

export default Road;
