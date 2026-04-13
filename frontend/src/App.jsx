import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Admin from './pages/Admin';
import PaymentCallback from './pages/PaymentCallback';
import { apiUrl } from './apiConfig';

function CountdownBox({ value, label }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      background: 'rgba(229,165,75,0.08)',
      border: '1.5px solid rgba(229,165,75,0.25)',
      borderRadius: '16px',
      padding: '1.1rem 0.8rem',
      minWidth: '72px',
    }}>
      <span style={{
        fontSize: 'clamp(1.8rem, 6vw, 2.8rem)',
        fontWeight: 900,
        background: 'linear-gradient(135deg, #F0C060 0%, #E5A54B 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {String(value).padStart(2, '0')}
      </span>
      <span style={{ fontSize: '0.7rem', color: '#6B7280', marginTop: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
        {label}
      </span>
    </div>
  );
}

function MaintenancePage({ settings }) {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0, expired: false });

  useEffect(() => {
    const endTime = settings?.maintenance_end_time
      ? new Date(settings.maintenance_end_time)
      : new Date(Date.now() + 24 * 60 * 60 * 1000);

    const calculate = () => {
      const diff = endTime - new Date();
      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0, expired: true });
        return;
      }
      setTimeLeft({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((diff % (1000 * 60)) / 1000),
        expired: false,
      });
    };

    calculate();
    const interval = setInterval(calculate, 1000);
    return () => clearInterval(interval);
  }, [settings?.maintenance_end_time]);

  const title = settings?.maintenance_title || '✨ Something special is coming for you!';

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#0d0d0d', color: '#FAFAF9',
      fontFamily: "'Inter', sans-serif", textAlign: 'center',
      padding: '2rem', position: 'relative', overflow: 'hidden',
    }}>
      {/* Background glow */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0,
        background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(229,165,75,0.12) 0%, transparent 65%), radial-gradient(ellipse 60% 50% at 20% 100%, rgba(244,63,94,0.08) 0%, transparent 60%)',
        pointerEvents: 'none',
      }} />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: '560px', width: '100%' }}>
        {/* Icon */}
        <div style={{
          width: 80, height: 80, borderRadius: '50%',
          background: 'linear-gradient(135deg, rgba(229,165,75,0.15) 0%, rgba(229,165,75,0.05) 100%)',
          border: '1.5px solid rgba(229,165,75,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 2rem', fontSize: '2rem',
        }}>
          🎁
        </div>

        <h1 style={{
          fontSize: 'clamp(1.6rem, 4.5vw, 2.4rem)', fontWeight: 900,
          background: 'linear-gradient(135deg, #F0C060 0%, #E5A54B 50%, #C8892E 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          marginBottom: '0.75rem', lineHeight: 1.3,
        }}>
          {title}
        </h1>

        <p style={{ fontSize: '0.95rem', color: '#9CA3AF', lineHeight: 1.7, marginBottom: '2.5rem' }}>
          Stay tuned — we'll be back soon! 🔥
        </p>

        {/* Countdown Timer */}
        {!timeLeft.expired ? (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', marginBottom: '2.5rem', flexWrap: 'wrap' }}>
            {timeLeft.days > 0 && <CountdownBox value={timeLeft.days} label="Days" />}
            <CountdownBox value={timeLeft.hours} label="Hours" />
            <CountdownBox value={timeLeft.minutes} label="Minutes" />
            <CountdownBox value={timeLeft.seconds} label="Seconds" />
          </div>
        ) : (
          <div style={{ marginBottom: '2.5rem', fontSize: '1.1rem', color: '#E5A54B', fontWeight: 600 }}>
            🎉 Almost here!
          </div>
        )}

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
          background: 'rgba(229,165,75,0.08)', border: '1px solid rgba(229,165,75,0.2)',
          borderRadius: '9999px', padding: '0.6rem 1.4rem',
          fontSize: '0.85rem', color: '#E5A54B', fontWeight: 500,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#E5A54B', display: 'inline-block', animation: 'pulse 2s ease-in-out infinite' }} />
          Something exciting is on the way
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

function AppRoutes({ maintenanceMode, settings }) {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');

  if (maintenanceMode && !isAdmin) {
    return (
      <Routes>
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<MaintenancePage settings={settings} />} />
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
