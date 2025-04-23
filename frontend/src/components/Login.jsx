import React, { useState } from 'react';
import axios from 'axios';
import './Login.css';
import logo from '../assets/logo.png';

const Login = ({ setLoggedIn }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();

    // Build a one-line SOAP envelope including the <log:request> wrapper
    const soapEnvelope = '<?xml version="1.0" encoding="UTF-8"?>' +
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:log="http://example.com/login">' +
        '<soapenv:Header/>' +
        '<soapenv:Body>' +
          '<log:Login>' +
            '<log:request>' +
              '<log:email>' + email + '</log:email>' +
              '<log:password>' + password + '</log:password>' +
            '</log:request>' +
          '</log:Login>' +
        '</soapenv:Body>' +
      '</soapenv:Envelope>';

    try {
      // Send the SOAP envelope to your service (host port 5005)
      const response = await axios.post('http://localhost:5005', soapEnvelope, {
        headers: {
          'Content-Type': 'text/xml',
          'SOAPAction': 'http://example.com/login/Login'
        },
      });           

      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(response.data, 'text/xml');
      
      // Use namespace-aware queries to extract <success> and <message>
      const successElem = xmlDoc.getElementsByTagNameNS('http://example.com/login', 'success')[0];
      const messageElem = xmlDoc.getElementsByTagNameNS('http://example.com/login', 'message')[0];

      const success = successElem && successElem.textContent.trim() === 'true';
      const message = messageElem ? messageElem.textContent : 'Unknown error';

      if (success) {
        setLoggedIn(true);
      } else {
        setErrorMsg(message);
      }
    } catch (error) {
      console.error('SOAP request error:', error);
      setErrorMsg('Login failed. Please try again.');
    }
  };

  return (
    <div className="login-container">
      <div className="login-brand">
        <img src={logo} alt="OptiTraffic AI Logo" className="login-logo" />
        <h1>OptiTraffic AI</h1>
      </div>
      <form className="login-box" onSubmit={handleLogin}>
        <h2>Login</h2>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {errorMsg && <p className="error">{errorMsg}</p>}
        <button type="submit">Login</button>
      </form>
    </div>
  );
};

export default Login;
