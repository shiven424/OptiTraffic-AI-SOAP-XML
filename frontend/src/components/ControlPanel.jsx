import { Box, Select, MenuItem, Typography, IconButton, Slider } from '@mui/material';
import { Settings, Brightness4 } from '@mui/icons-material';

const ControlPanel = ({
  mode,
  setMode,
  darkMode,
  toggleDarkMode,
  data,
  brightness,
  setBrightness,
  fontSize,
  setFontSize,
}) => {
  return (
    <Box sx={{ 
      position: 'absolute', 
      top: 16, 
      right: 16, 
      bgcolor: darkMode ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)',
      p: 2,
      borderRadius: 2,
      minWidth: 300,
      backdropFilter: 'blur(8px)',
      minHeight: 180,
      transition: 'background-color 0.3s ease'
    }}>
      <Box display="flex" alignItems="center" gap={1} mb={2}>
        <Settings />
        <Typography variant="h6">Control Panel</Typography>
        <IconButton onClick={toggleDarkMode} sx={{ ml: 'auto' }}>
          <Brightness4 />
        </IconButton>
      </Box>

      {/* Brightness Control */}
      <Box mb={2}>
        <Typography variant="subtitle2" gutterBottom>Brightness</Typography>
        <Slider
          value={brightness}
          onChange={(e, newValue) => setBrightness(newValue)}
          aria-labelledby="brightness-slider"
          min={50}
          max={150}
          valueLabelDisplay="auto"
        />
      </Box>

      {/* Font Size Control */}
      <Box mb={2}>
        <Typography variant="subtitle2" gutterBottom>Font Size</Typography>
        <Select
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value)}
          fullWidth
        >
          <MenuItem value={14}>Small (14px)</MenuItem>
          <MenuItem value={16}>Default (16px)</MenuItem>
          <MenuItem value={18}>Large (18px)</MenuItem>
          <MenuItem value={20}>Extra Large (20px)</MenuItem>
        </Select>
      </Box>
    </Box>
  );
};

export default ControlPanel;
