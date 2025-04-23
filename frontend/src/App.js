import { useEffect, useState } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import IconButton from '@mui/material/IconButton';
import MenuIcon from '@mui/icons-material/Menu';
import Button from '@mui/material/Button';
import LaunchIcon from '@mui/icons-material/Launch';

import Intersection from './components/Intersection';
import ControlPanel from './components/ControlPanel';
import StatsPanel from './components/StatsPanel';
import Login from './components/Login';
import TrafficMonitoring from './components/TrafficMonitoring';
import NotificationPanel from './components/NotificationPanel';
import SidePanel from './components/SidePanel';
import { fetchTrafficData, fetchMonitoringData } from './services/api';

import './App.css';

function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [trafficData, setTrafficData] = useState(null);
  const [monitoringData, setMonitoringData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('auto');
  const [darkMode, setDarkMode] = useState(true);

  
  const [sidePanelOpen, setSidePanelOpen] = useState(true);
  const [currentPage, setCurrentPage] = useState('home'); // 'home' | 'notification' | 'trafficMonitoring'

  // Customization states
  const [brightness, setBrightness] = useState(100); // percentage
  const [fontSize, setFontSize] = useState(16); // in pixels

  const theme = createTheme({
    palette: {
      mode: darkMode ? 'dark' : 'light',
    },
  });

  // Apply global brightness by updating the document element's filter.
  useEffect(() => {
    document.documentElement.style.filter = `brightness(${brightness}%)`;
  }, [brightness]);

  // Reset data on logout.
  useEffect(() => {
    if (!loggedIn) {
      setTrafficData(null);
      setMonitoringData(null);
      setCurrentPage('home');
    }
  }, [loggedIn]);

  // Fetch data for the current page when logged in.
  useEffect(() => {
    if (loggedIn) {
      setLoading(true);
      const updateData = async () => {
        try {
          if (currentPage === 'trafficMonitoring') {
            const data = await fetchMonitoringData();
            setMonitoringData(data);
          } else if (currentPage === 'home') {
            const data = await fetchTrafficData();
            setTrafficData(data);
          }
        } catch (error) {
          console.error('Error fetching data:', error);
        } finally {
          setLoading(false);
        }
      };

      updateData();
      const interval = setInterval(updateData, 2000);
      return () => clearInterval(interval);
    }
  }, [loggedIn, currentPage]);

  // Handler for navigation from the side panel.
  const handleNavigation = (page) => {
    setCurrentPage(page);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* Wrap the entire app in a container that applies the fontSize (brightness is applied globally) */}
      <div
        className="app-container"
        style={{
          fontSize: `${fontSize}px`,
          transition: 'font-size 0.3s ease'
        }}
      >
        {/* Only show the hamburger icon when logged in and the side panel is closed */}
        {loggedIn && !sidePanelOpen && (
          <IconButton
            onClick={() => setSidePanelOpen(true)}
            style={{ position: 'absolute', top: 10, left: 10, zIndex: 1300 }}
            color="inherit"
          >
            <MenuIcon fontSize="large" />
          </IconButton>
        )}

        {/* Render the side panel only after login */}
        {loggedIn && (
          <SidePanel
            open={sidePanelOpen}
            toggleDrawer={setSidePanelOpen}
            onNavigate={handleNavigation}
            darkMode={darkMode}
            currentPage={currentPage}
            onLogout={() => setLoggedIn(false)}
          />
        )}

        {/* Control Panel is shown on all pages after login */}
        {loggedIn && (
          <ControlPanel
            mode={mode}
            setMode={setMode}
            darkMode={darkMode}
            toggleDarkMode={() => setDarkMode(!darkMode)}
            data={trafficData}
            brightness={brightness}
            setBrightness={setBrightness}
            fontSize={fontSize}
            setFontSize={setFontSize}
          />
        )}

        {loggedIn && currentPage === 'home' && (
          <div
            style={{
              position: 'absolute',
              top: '280px', 
              right: '16px',
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <div
              onClick={() => window.open('http://localhost:5010', '_blank')}
              style={{
                background: darkMode ? "#333" : "#fafafa", 
                color: darkMode ? "#fff" : "#000",
                padding: '16px 32px',
                borderRadius: '16px',
                cursor: 'pointer',
                border: darkMode ? '1px solid #fff' : '1px solid #000', 
                fontSize: '1.4rem',
                transition: 'background-color 0.2s ease',
                userSelect: 'none',
                textAlign: 'center',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = darkMode ? "#444" : "#f0f0f0";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = darkMode ? "#333" : "#fafafa";
              }}
            >
              CityFlow Raw Simulation
            </div>
          </div>
        )}
        
        
        
        
        

        {/* Page Content */}
        {!loggedIn ? (
          <Login setLoggedIn={setLoggedIn} />
        ) : (
          <>
            {currentPage === 'home' && (
              <>
                <h1 style={{ color: darkMode ? '#fff' : '#000' }}>Traffic Signal Monitoring</h1>
                {loading ? (
                  <div className="loading">Loading traffic data...</div>
                ) : trafficData ? (
                  <>
                    <Intersection data={trafficData} />
                    <StatsPanel data={trafficData} darkMode={darkMode} />
                  </>
                ) : (
                  <div className="error">Failed to load traffic data.</div>
                )}
              </>
            )}

            {currentPage === 'trafficMonitoring' && (
              <>
                <h1 style={{ color: darkMode ? '#fff' : '#000' }}>Traffic Monitoring Dashboard</h1>
                {loading ? (
                  <div className="loading">Loading monitoring data...</div>
                ) : monitoringData ? (
                  <TrafficMonitoring data={monitoringData} darkMode={darkMode} />
                ) : (
                  <div className="error">Failed to load monitoring data.</div>
                )}
              </>
            )}

            {currentPage === 'notification' && (
            <>
              <h1 style={{ textAlign: 'center', color: darkMode ? '#fff' : '#000' }}>Notifications</h1>
              <NotificationPanel darkMode={darkMode} />
            </>
            )}
          </>
        )}
      </div>
    </ThemeProvider>
  );
}

export default App;
