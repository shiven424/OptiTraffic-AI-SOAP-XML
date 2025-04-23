import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { Line, Pie } from 'react-chartjs-2';
import 'chart.js/auto';

const TrafficMonitoring = ({ data, darkMode }) => {
  // Set initial monitoringData from the prop 'data'
  const [monitoringData, setMonitoringData] = useState(data);
  const [selectedTab, setSelectedTab] = useState('comparison'); // 'comparison', 'metrics', 'green', 'summary'

  // When the parent prop "data" updates, update the local state.
  useEffect(() => {
    setMonitoringData(data);
  }, [data]);

  // Always set up hooks unconditionally.
  const commonChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        ticks: { autoSkip: true, maxRotation: 0, color: darkMode ? '#fff' : '#000' },
        grid: { color: darkMode ? '#444' : '#ccc' },
      },
      y: {
        ticks: { color: darkMode ? '#fff' : '#000' },
        grid: { color: darkMode ? '#444' : '#ccc' },
      },
    },
    plugins: {
      legend: { labels: { color: darkMode ? '#fff' : '#000' } },
      tooltip: { 
        titleColor: darkMode ? '#fff' : '#000',
        bodyColor: darkMode ? '#fff' : '#000',
        backgroundColor: darkMode ? '#222' : '#fff',
      },
      title: { color: darkMode ? '#fff' : '#000' },
    },
  }), [darkMode]);


  // Prepare container-level styles (which will always be rendered)
  const outerStyle = {
    padding: '20px',
    maxWidth: '1200px',
    margin: '0 auto',
    color: darkMode ? '#fff' : '#000',
    backgroundColor: darkMode ? '#111' : '#f9f9f9',
  };

  if (!monitoringData) {
    return (
      <div style={outerStyle}>
        <h2 style={{ textAlign: 'center', marginBottom: '20px', color: darkMode ? '#fff' : '#000' }}>
          Traffic Monitoring Dashboard
        </h2>
        <div style={{ textAlign: 'center', color: darkMode ? '#fff' : '#000' }}>
          Loading monitoring data...
        </div>
      </div>
    );
  }

  // Prepare time labels using raw_data_history timestamps.
  const timeLabels = monitoringData.raw_data_history.map(d =>
    new Date(d.timestamp * 1000).toLocaleTimeString()
  );

  // Compute raw and predicted total vehicle counts per snapshot.
  const rawCounts = monitoringData.raw_data_history.map(snap => {
    const summary = snap.summary || {};
    return Object.values(summary).reduce((acc, data) => acc + (data.vehicle_count || 0), 0);
  });
  const predCounts = monitoringData.prediction_history.map(snap => {
    const roads = snap.roads || {};
    return Object.values(roads).reduce((acc, data) => acc + (data.vehicle_count || 0), 0);
  });
  // Performance score: average speed * vehicle count.
  const rawPerformance = monitoringData.analytics.raw_performance;
  const predPerformance = monitoringData.analytics.pred_performance;

  // Comparison Tab: Line chart for vehicle counts and performance scores.
  const comparisonLineChartData = {
    labels: timeLabels,
    datasets: [
      {
        label: 'Raw Vehicle Count',
        data: rawCounts,
        borderColor: darkMode ? 'green' : 'green',
        fill: false,
      },
      {
        label: 'Predicted Vehicle Count',
        data: predCounts,
        borderColor: darkMode ? 'red' : 'red',
        fill: false,
      },
      {
        label: 'Raw Performance Score',
        data: rawPerformance,
        borderColor: darkMode ? '#72b4de' : 'gray',
        fill: false,
      },
      {
        label: 'Predicted Performance Score',
        data: predPerformance,
        borderColor: darkMode ? '#115b8b' : 'black',
        fill: false,
      },
    ],
  };

  // Metrics Tab: Line charts for average speed and density.
  const rawAvgSpeeds = monitoringData.analytics.raw_avg_speeds;
  const predAvgSpeeds = monitoringData.analytics.pred_avg_speeds;
  const rawDensities = monitoringData.analytics.raw_densities;
  const predDensities = monitoringData.analytics.pred_densities;
  const avgSpeedChartData = {
    labels: timeLabels,
    datasets: [
      {
        label: 'Raw Avg Speed',
        data: rawAvgSpeeds,
        borderColor: darkMode ? '#e49e17' : 'orange',
        fill: false,
      },
      {
        label: 'Predicted Avg Speed',
        data: predAvgSpeeds,
        borderColor: darkMode ? '#f7eb71' : 'gold',
        fill: false,
      },
    ],
  };
  const densityChartData = {
    labels: timeLabels,
    datasets: [
      {
        label: 'Raw Density',
        data: rawDensities,
        borderColor: darkMode ? 'blue' : 'blue',
        fill: false,
      },
      {
        label: 'Predicted Density',
        data: predDensities,
        borderColor: darkMode ? 'navy' : 'navy',
        fill: false,
      },
    ],
  };

  // Green Analysis Tab: Pie charts for predicted green distribution and raw average green percentage.
  const predictedGreenLabels = Object.keys(monitoringData.analytics.predicted_green_distribution);
  const predictedGreenData = Object.values(monitoringData.analytics.predicted_green_distribution);
  const predictedPieChartData = {
    labels: predictedGreenLabels,
    datasets: [{
      label: 'Predicted Green Distribution',
      data: predictedGreenData,
      backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0'],
    }],
  };

  const rawGreenLabels = Object.keys(monitoringData.analytics.avg_green_percentage);
  const rawGreenData = Object.values(monitoringData.analytics.avg_green_percentage);
  const rawPieChartData = {
    labels: rawGreenLabels,
    datasets: [{
      label: 'Raw Avg Green %',
      data: rawGreenData,
      backgroundColor: ['#8E44AD', '#2980B9', '#27AE60', '#F39C12'],
    }],
  };

  // Analytics Summary Tab: Text summary.
  const analyticsSummary = (
    <div style={{ textAlign: 'center', color: darkMode ? '#fff' : '#000' }}>
      <h3>Analytics Summary</h3>
      <p>Max Vehicle Count: {monitoringData.analytics.max_vehicle_count}</p>
      <p>Average Vehicle Count: {monitoringData.analytics.avg_vehicle_count.toFixed(2)}</p>
      <p>Total Raw History Records: {monitoringData.analytics.raw_history_count}</p>
      <p>Total Prediction Records: {monitoringData.analytics.prediction_history_count}</p>
    </div>
  );

  // Styles for container and charts.
  const containerStyle = {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: '20px',
    margin: '0 auto',
  };
  const chartContainerStyle = { height: '400px', width: '100%', marginBottom: '20px' };

  // Button style for tab switcher.
  const buttonStyle = (tab) => ({
    padding: '10px 20px',
    marginRight: '10px',
    backgroundColor: selectedTab === tab ? (darkMode ? '#333' : '#1976d2') : (darkMode ? '#666' : '#ccc'),
    color: selectedTab === tab ? '#fff' : (darkMode ? '#ddd' : '#000'),
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  });

  return (
    <div style={outerStyle}>
      {/* Traffic Monitoring Dashboard */}

      {/* Tab Switcher */}
      <div style={{ marginBottom: '20px', textAlign: 'center' }}>
        <button style={buttonStyle('comparison')} onClick={() => setSelectedTab('comparison')}>
          Comparison
        </button>
        <button style={buttonStyle('metrics')} onClick={() => setSelectedTab('metrics')}>
          Metrics
        </button>
        <button style={buttonStyle('green')} onClick={() => setSelectedTab('green')}>
          Green Analysis
        </button>
        <button style={buttonStyle('summary')} onClick={() => setSelectedTab('summary')}>
          Summary
        </button>
      </div>

      {/* Render selected tab */}
      <div style={containerStyle}>
        {selectedTab === 'comparison' && (
          <div style={chartContainerStyle}>
            <h3 style={{ textAlign: 'center', marginBottom: '10px', color: darkMode ? '#fff' : '#000' }}>
              Vehicle Count & Performance Comparison
            </h3>
            <Line data={comparisonLineChartData} options={commonChartOptions} />
          </div>
        )}
        {selectedTab === 'metrics' && (
          <>
            <div style={chartContainerStyle}>
              <h3 style={{ textAlign: 'center', marginBottom: '10px', color: darkMode ? '#fff' : '#000' }}>
                Average Speed Comparison
              </h3>
              <Line
                data={{
                  labels: timeLabels,
                  datasets: [
                    {
                      label: 'Raw Avg Speed',
                      data: avgSpeedChartData.datasets[0].data,
                      borderColor: darkMode ? '#e49e17' : 'orange',
                      fill: false,
                    },
                    {
                      label: 'Predicted Avg Speed',
                      data: avgSpeedChartData.datasets[1].data,
                      borderColor: darkMode ? '#f7eb71' : 'gold',
                      fill: false,
                    },
                  ],
                }}
                options={commonChartOptions}
              />
            </div>
            <div style={chartContainerStyle}>
              <h3 style={{ textAlign: 'center', marginBottom: '10px', color: darkMode ? '#fff' : '#000' }}>
                Density Comparison
              </h3>
              <Line
                data={{
                  labels: timeLabels,
                  datasets: [
                    {
                      label: 'Raw Density',
                      data: densityChartData.datasets[0].data,
                      borderColor: darkMode ? 'blue' : 'blue',
                      fill: false,
                    },
                    {
                      label: 'Predicted Density',
                      data: densityChartData.datasets[1].data,
                      borderColor: darkMode ? '#6c6cff' : 'navy',
                      fill: false,
                    },
                  ],
                }}
                options={commonChartOptions}
              />
            </div>
          </>
        )}
        {selectedTab === 'green' && (
          <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <div style={{ width: '45%', height: '400px' }}>
              <h3 style={{ textAlign: 'center', color: darkMode ? '#fff' : '#000' }}>
                Predicted Green Distribution
              </h3>
              <Pie data={predictedPieChartData} options={commonChartOptions} />
            </div>
            <div style={{ width: '45%', height: '400px' }}>
              <h3 style={{ textAlign: 'center', color: darkMode ? '#fff' : '#000' }}>
                Raw Avg Green % per Road
              </h3>
              <Pie data={rawPieChartData} options={commonChartOptions} />
            </div>
          </div>
        )}
        {selectedTab === 'summary' && (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            {analyticsSummary}
          </div>
        )}
      </div>
    </div>
  );
};

export default TrafficMonitoring;
