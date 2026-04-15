import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Admin from './pages/Admin';
import PaymentCallback from './pages/PaymentCallback';
import MaintenanceEbook from './pages/MaintenanceEbook';
import { apiUrl } from './apiConfig';

function AppRoutes({ maintenanceMode, settings }) {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');

  if (maintenanceMode && !isAdmin) {
    return (
      <Routes>
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<MaintenanceEbook settings={settings} />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/payment/callback" element={<PaymentCallback />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    fetch(apiUrl('/api/public/data'))
      .then(r => r.json())
      .then(data => {
        if (data.settings) {
          setSettings(data.settings);
          if (data.settings.maintenance_mode == 1) setMaintenanceMode(true);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <BrowserRouter>
      <AppRoutes maintenanceMode={maintenanceMode} settings={settings} />
    </BrowserRouter>
  );
}

export default App;
