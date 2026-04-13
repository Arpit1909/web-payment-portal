import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Admin from './pages/Admin';
import PaymentCallback from './pages/PaymentCallback';
import { apiUrl } from './apiConfig';

function MaintenancePage() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0d0d0d',
      color: '#FAFAF9',
      fontFamily: "'Inter', sans-serif",
      textAlign: 'center',
      padding: '2rem',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background glow */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0,
        background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(229,165,75,0.12) 0%, transparent 65%), radial-gradient(ellipse 60% 50% at 20% 100%, rgba(244,63,94,0.08) 0%, transparent 60%)',
        pointerEvents: 'none',
      }} />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: '520px', width: '100%' }}>
        {/* Icon */}
        <div style={{
          width: 80, height: 80, borderRadius: '50%',
          background: 'linear-gradient(135deg, rgba(229,165,75,0.15) 0%, rgba(229,165,75,0.05) 100%)',
          border: '1.5px solid rgba(229,165,75,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 2rem',
          fontSize: '2rem',
        }}>
          🔧
        </div>

        <h1 style={{
          fontSize: 'clamp(2rem, 5vw, 3rem)',
          fontWeight: 900,
          background: 'linear-gradient(135deg, #F0C060 0%, #E5A54B 50%, #C8892E 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          marginBottom: '1rem',
          lineHeight: 1.2,
        }}>
          Under Maintenance
        </h1>

        <p style={{
          fontSize: '1.05rem',
          color: '#9CA3AF',
          lineHeight: 1.7,
          marginBottom: '2rem',
        }}>
          We're making some improvements to bring you an even better experience.
          <br />Please check back soon!
        </p>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
          background: 'rgba(229,165,75,0.08)',
          border: '1px solid rgba(229,165,75,0.2)',
          borderRadius: '9999px',
          padding: '0.6rem 1.4rem',
          fontSize: '0.85rem',
          color: '#E5A54B',
          fontWeight: 500,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#E5A54B', display: 'inline-block', animation: 'pulse 2s ease-in-out infinite' }} />
          We'll be back shortly
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }
      `}</style>
    </div>
  );
}

function AppRoutes({ maintenanceMode }) {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');

  if (maintenanceMode && !isAdmin) {
    return (
      <Routes>
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<MaintenancePage />} />
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

  useEffect(() => {
    fetch(apiUrl('/api/public/data'))
      .then(r => r.json())
      .then(data => {
        if (data.settings && data.settings.maintenance_mode == 1) {
          setMaintenanceMode(true);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <BrowserRouter>
      <AppRoutes maintenanceMode={maintenanceMode} />
    </BrowserRouter>
  );
}

export default App;
