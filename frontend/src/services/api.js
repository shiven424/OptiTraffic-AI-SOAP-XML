const SIGNAL_SOAP_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';
const MONITORING_SOAP_URL = process.env.REACT_APP_MONITORING_API_URL || 'http://localhost:8002';

export const fetchTrafficData = async () => {
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ts="http://example.com/trafficsignal">
  <soapenv:Header/>
  <soapenv:Body>
    <ts:GetTrafficData/>
  </soapenv:Body>
</soapenv:Envelope>`;

  try {
    const response = await fetch(SIGNAL_SOAP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'SOAPAction': 'http://example.com/trafficsignal/GetTrafficData'
      },
      body: envelope
    });
    const text = await response.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, 'text/xml');
    const dataElem = xmlDoc.getElementsByTagNameNS('http://example.com/trafficsignal', 'data')[0];
    return dataElem ? JSON.parse(dataElem.textContent) : null;
  } catch (error) {
    console.error('Error fetching traffic data (SOAP):', error);
    return null;
  }
};

export const setModeSOAP = async (mode) => {
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ts="http://example.com/trafficsignal">
  <soapenv:Header/>
  <soapenv:Body>
    <ts:SetMode>
      <ts:mode>${mode}</ts:mode>
    </ts:SetMode>
  </soapenv:Body>
</soapenv:Envelope>`;

  try {
    const response = await fetch(SIGNAL_SOAP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'SOAPAction': 'http://example.com/trafficsignal/SetMode'
      },
      body: envelope
    });
    const text = await response.text();
    const parser = new DOMParser();
    // Here we define xmlDoc
    const xmlDoc = parser.parseFromString(text, 'text/xml');

    const statusElem = xmlDoc.getElementsByTagNameNS('http://example.com/trafficsignal', 'status')[0];
    const modeElem = xmlDoc.getElementsByTagNameNS('http://example.com/trafficsignal', 'mode')[0];
    const timestampElem = xmlDoc.getElementsByTagNameNS('http://example.com/trafficsignal', 'timestamp')[0];

    return {
      status: statusElem ? statusElem.textContent : '',
      mode: modeElem ? modeElem.textContent : '',
      timestamp: timestampElem ? timestampElem.textContent : ''
    };
  } catch (error) {
    console.error('Error setting mode (SOAP):', error);
    return null;
  }
};

export const fetchMonitoringData = async () => {
  const soapEnvelope =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tm="http://example.com/trafficmonitoring">' +
      '<soapenv:Header/>' +
      '<soapenv:Body>' +
        '<tm:GetMonitoringData/>' +
      '</soapenv:Body>' +
    '</soapenv:Envelope>';

  try {
    const response = await fetch(MONITORING_SOAP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'SOAPAction': 'http://example.com/trafficmonitoring/GetMonitoringData'
      },
      body: soapEnvelope
    });
    const text = await response.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, 'text/xml');
    const dataElem = xmlDoc.getElementsByTagNameNS('http://example.com/trafficmonitoring', 'data')[0];
    return dataElem ? JSON.parse(dataElem.textContent) : null;
  } catch (error) {
    console.error('Error fetching monitoring data:', error);
    return null;
  }
};
