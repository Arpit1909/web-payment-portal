import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Admin from './pages/Admin';
import PaymentCallback from './pages/PaymentCallback';
import MaintenanceEbook from './pages/MaintenanceEbook';
import PrivacyPolicy from './pages/PrivacyPolicy';
import RefundPolicy from './pages/RefundPolicy';
import CancellationPolicy from './pages/CancellationPolicy';
import { apiUrl } from './apiConfig';

function AppRoutes({ maintenanceMode, settings }) {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');

  if (maintenanceMode && !isAdmin) {
    return (
      <Routes>
        <Route path="/admin" element={<Admin />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/refund-policy" element={<RefundPolicy />} />
        <Route path="/cancellation-policy" element={<CancellationPolicy />} />
        <Route path="*" element={<MaintenanceEbook settings={settings} />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/payment/callback" element={<PaymentCallback />} />
      <Route path="/privacy-policy" element={<PrivacyPolicy />} />
      <Route path="/refund-policy" element={<RefundPolicy />} />
      <Route path="/cancellation-policy" element={<CancellationPolicy />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [settings, setSettings] = useState(null);
  const [bootLoading, setBootLoading] = useState(true);

  useEffect(() => {
    fetch(apiUrl('/api/public/data'))
      .then(r => r.json())
      .then(data => {
        if (data.settings) {
          setSettings(data.settings);
          if (data.settings.maintenance_mode == 1) setMaintenanceMode(true);
        }
      })
      .catch(() => {})
      .finally(() => setBootLoading(false));
  }, []);

  if (bootLoading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#080b12',
        color: '#d9e8ff',
        fontFamily: 'Inter, sans-serif'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 42,
            height: 42,
            borderRadius: '50%',
            border: '3px solid rgba(255,255,255,0.18)',
            borderTopColor: '#60a5fa',
            margin: '0 auto .8rem',
            animation: 'appSpin 0.9s linear infinite'
          }} />
          <div style={{ fontSize: '.9rem', color: '#aac4e8' }}>Loading...</div>
        </div>
        <style>{`
          @keyframes appSpin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <AppRoutes maintenanceMode={maintenanceMode} settings={settings} />
    </BrowserRouter>
  );
}

export default App;
