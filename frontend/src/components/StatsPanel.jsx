// frontend/src/components/StatsPanel.jsx
import { Box, Typography, Grid } from '@mui/material';
import { DirectionsCar, Schedule, TrendingUp } from '@mui/icons-material';

const StatsPanel = ({ data, darkMode }) => {
    const formatTime = (seconds) => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}m ${secs}s`;
    };
  
    return (
      <Box sx={{
        position: 'fixed',
        bottom: 20,
        left: '50%',  
        transform: 'translateX(-50%)', 
        width: '81%',  
        maxWidth: 1020,  
        bgcolor: darkMode ? 'black' : 'white',
        p: 2,
        borderRadius: 2,
        backdropFilter: 'none',
        zIndex: 1000
      }}>
        <Grid container spacing={3}>
          <Grid item xs={3}>
            <StatItem 
              icon={<DirectionsCar />}
              title="Current Green"
              value={data?.green_light || 'N/A'}
            />
          </Grid>
          <Grid item xs={3}>
            <StatItem 
              icon={<DirectionsCar />}
              title="Total Vehicles"
              value={data?.total_vehicles_passed || 0}
            />
          </Grid>
          <Grid item xs={3}>
            <StatItem 
              icon={<Schedule />}
              title="Avg Wait Time"
              value={data?.average_wait_time ? 
                formatTime(data.average_wait_time) : '0m 0s'}
            />
          </Grid>
          <Grid item xs={3}>
            <StatItem 
              icon={<TrendingUp />}
              title="Traffic Density"
              value={data?.current_density ? 
                data.current_density.toFixed(2) : '0.00'}
            />
          </Grid>
        </Grid>
      </Box>
    );
  };

const StatItem = ({ icon, title, value }) => (
  <Box display="flex" alignItems="center" gap={1.5}>
    {icon}
    <Box>
      <Typography variant="subtitle2">{title}</Typography>
      <Typography variant="h6">{value}</Typography>
    </Box>
  </Box>
);

export default StatsPanel;