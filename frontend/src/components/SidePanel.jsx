import React, { useEffect, useState } from 'react';
import { Drawer, List, ListItem, ListItemIcon, ListItemText, IconButton, Tooltip } from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import NotificationsIcon from '@mui/icons-material/Notifications';
import DashboardIcon from '@mui/icons-material/Dashboard';
import CloseIcon from '@mui/icons-material/Close';
import LogoutIcon from '@mui/icons-material/Logout';
import './SidePanel.css';
import logo from '../assets/logo.png';

const SidePanel = ({ open, toggleDrawer, onNavigate, darkMode, currentPage, onLogout }) => {
  const [lineFill, setLineFill] = useState(false);
  const [lineKey, setLineKey] = useState(0);
  const [closeClicked, setCloseClicked] = useState(false);

  useEffect(() => {
    if (open) {
      setLineFill(false);
      setLineKey(prev => prev + 1);
      const timeout = setTimeout(() => setLineFill(true), 50);
      return () => clearTimeout(timeout);
    }
  }, [currentPage, open]);

  const handleClose = () => {
    setCloseClicked(true);
    setTimeout(() => {
      setCloseClicked(false);
      toggleDrawer(false);
    }, 400);
  };

  const handleNavigation = (page) => {
    onNavigate(page);
  };

  return (
    <Drawer
      variant="persistent"
      anchor="left"
      open={open}
      ModalProps={{ hideBackdrop: true }}
      PaperProps={{ className: 'side-panel-paper' }}
    >
      <div className="side-panel-container">
        <IconButton
          disableRipple
          className={`close-button ${closeClicked ? 'animate-close' : ''}`}
          onClick={handleClose}
        >
          <CloseIcon fontSize="large" />
        </IconButton>

        <List className="nav-list">
          <ListItem button onClick={() => handleNavigation('home')} className="nav-item">
            <ListItemIcon className="nav-icon">
              <HomeIcon fontSize="large" />
            </ListItemIcon>
            <ListItemText primary="Home" className="nav-text" />
          </ListItem>
          <ListItem button onClick={() => handleNavigation('notification')} className="nav-item">
            <ListItemIcon className="nav-icon">
              <NotificationsIcon fontSize="large" />
            </ListItemIcon>
            <ListItemText primary="Notifications" className="nav-text" />
          </ListItem>
          <ListItem button onClick={() => handleNavigation('trafficMonitoring')} className="nav-item">
            <ListItemIcon className="nav-icon">
              <DashboardIcon fontSize="large" />
            </ListItemIcon>
            <ListItemText primary="Traffic Monitoring" className="nav-text" />
          </ListItem>
        </List>

        <div className="animated-hr-container">
          <div
            key={lineKey}
            className={`animated-hr ${lineFill ? 'fill' : ''}`}
            style={{ backgroundColor: darkMode ? '#fff' : '#000' }}
          ></div>
        </div>

        <div className="branding">
          <img src={logo} alt="OptiTraffic AI Logo" className="sidepanel-logo" />
          <h2 className="brand-name">OptiTraffic AI</h2>
          <p className="brand-info">&copy; 2025 OptiTraffic AI. All rights reserved.</p>
        </div>

        <div className="logout-container">
          <Tooltip title="Logout" placement="left">
            <IconButton onClick={onLogout} className="logout-button" color="inherit">
              <LogoutIcon fontSize="medium" />
            </IconButton>
          </Tooltip>
        </div>
      </div>
    </Drawer>
  );
};

export default SidePanel;
