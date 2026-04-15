import { useMemo, useState } from 'react';
import { BookOpen, ShoppingCart, Plus, Minus, Trash2, CreditCard } from 'lucide-react';

const EBOOKS = [
  {
    id: 'ebk-1',
    title: 'Digital Marketing Blueprint',
    author: 'A. Sharma',
    price: 299,
    cover: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=500&q=80',
    blurb: 'Step-by-step strategies to grow online sales and social reach.'
  },
  {
    id: 'ebk-2',
    title: 'Canva Design Mastery',
    author: 'R. Verma',
    price: 249,
    cover: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=500&q=80',
    blurb: 'Create high-converting creatives for ads, reels, and stories.'
  },
  {
    id: 'ebk-3',
    title: 'Instagram Growth Secrets',
    author: 'P. Gupta',
    price: 349,
    cover: 'https://images.unsplash.com/photo-1495446815901-a7297e633e8d?auto=format&fit=crop&w=500&q=80',
    blurb: 'Organic + paid growth framework for creators and businesses.'
  },
  {
    id: 'ebk-4',
    title: 'Freelancer Income System',
    author: 'N. Singh',
    price: 399,
    cover: 'https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=500&q=80',
    blurb: 'Get clients, price your services, and build recurring income.'
  }
];

function formatInr(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
}

export default function MaintenanceEbook() {
  const [cart, setCart] = useState({});
  const [paymentMethod, setPaymentMethod] = useState('razorpay');

  const items = useMemo(() => {
    return EBOOKS
      .map(book => ({ ...book, qty: cart[book.id] || 0 }))
      .filter(book => book.qty > 0);
  }, [cart]);

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.qty, 0),
    [items]
  );

  const platformFee = subtotal > 0 ? 9 : 0;
  const total = subtotal + platformFee;

  const add = (id) => setCart(prev => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
  const remove = (id) =>
    setCart(prev => {
      const next = { ...prev };
      if (!next[id]) return prev;
      next[id] -= 1;
      if (next[id] <= 0) delete next[id];
      return next;
    });
  const clearItem = (id) =>
    setCart(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const handlePay = () => {
    if (!items.length) return;
    alert('Temporary maintenance template: connect this button to your Razorpay checkout flow.');
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0b0d12', color: '#f5f7fa', padding: '1.25rem' }}>
      <div style={{ maxWidth: 1150, margin: '0 auto' }}>
        <div style={{
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 18,
          padding: '1rem 1.1rem',
          marginBottom: '1rem',
          background: 'linear-gradient(135deg, rgba(41,92,255,0.18), rgba(26,188,156,0.16))'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', fontWeight: 800 }}>
            <BookOpen size={20} />
            Ebook Store is Live
          </div>
          <p style={{ margin: '.35rem 0 0', color: '#d6deea', fontSize: '.92rem' }}>
            Our main website is under maintenance. You can continue buying premium ebooks here.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '1rem' }}>
            {EBOOKS.map(book => {
              const qty = cart[book.id] || 0;
              return (
                <div key={book.id} style={{
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 16,
                  overflow: 'hidden',
                  background: 'rgba(255,255,255,0.03)'
                }}>
                  <img src={book.cover} alt={book.title} style={{ width: '100%', height: 160, objectFit: 'cover' }} />
                  <div style={{ padding: '.8rem' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem' }}>{book.title}</h3>
                    <p style={{ margin: '.2rem 0 .5rem', color: '#9db0c7', fontSize: '.82rem' }}>by {book.author}</p>
                    <p style={{ margin: 0, color: '#c8d4e4', fontSize: '.82rem', minHeight: 38 }}>{book.blurb}</p>
                    <div style={{ marginTop: '.7rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ color: '#61dafb' }}>{formatInr(book.price)}</strong>
                      {qty === 0 ? (
                        <button onClick={() => add(book.id)} style={btnSmall()}>
                          <Plus size={14} /> Add
                        </button>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                          <button onClick={() => remove(book.id)} style={iconBtn()}><Minus size={14} /></button>
                          <span style={{ minWidth: 18, textAlign: 'center' }}>{qty}</span>
                          <button onClick={() => add(book.id)} style={iconBtn()}><Plus size={14} /></button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <aside style={{
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 16,
            background: 'rgba(255,255,255,0.03)',
            padding: '.9rem',
            alignSelf: 'start',
            position: 'sticky',
            top: 16
          }}>
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '.4rem' }}>
              <ShoppingCart size={18} /> Cart
            </h3>
            {!items.length ? (
              <p style={{ color: '#9db0c7', fontSize: '.9rem' }}>No ebooks selected yet.</p>
            ) : (
              <div style={{ display: 'grid', gap: '.6rem' }}>
                {items.map(item => (
                  <div key={item.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '.45rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem' }}>
                      <div>
                        <div style={{ fontSize: '.92rem', fontWeight: 600 }}>{item.title}</div>
                        <div style={{ color: '#8aa0bc', fontSize: '.8rem' }}>
                          {formatInr(item.price)} x {item.qty}
                        </div>
                      </div>
                      <button onClick={() => clearItem(item.id)} style={iconBtn()}><Trash2 size={13} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: '.9rem', borderTop: '1px solid rgba(255,255,255,0.09)', paddingTop: '.75rem' }}>
              <Row label="Subtotal" value={formatInr(subtotal)} />
              <Row label="Platform fee" value={formatInr(platformFee)} />
              <Row label="Total" value={formatInr(total)} strong />
            </div>

            <div style={{ marginTop: '.9rem' }}>
              <div style={{ fontSize: '.86rem', color: '#9db0c7', marginBottom: '.4rem' }}>Payment option</div>
              <label style={payOption(paymentMethod === 'razorpay')}>
                <input
                  type="radio"
                  name="payment"
                  value="razorpay"
                  checked={paymentMethod === 'razorpay'}
                  onChange={() => setPaymentMethod('razorpay')}
                />
                <span style={{ display: 'flex', alignItems: 'center', gap: '.45rem' }}>
                  <CreditCard size={15} /> Razorpay
                </span>
              </label>
            </div>

            <button
              onClick={handlePay}
              disabled={!items.length}
              style={{
                marginTop: '.9rem',
                width: '100%',
                border: 0,
                borderRadius: 12,
                padding: '.78rem .9rem',
                fontWeight: 800,
                cursor: items.length ? 'pointer' : 'not-allowed',
                background: items.length ? 'linear-gradient(135deg,#2b90ff,#1abc9c)' : 'rgba(255,255,255,0.12)',
                color: items.length ? '#fff' : '#9ea9b9'
              }}
            >
              Proceed to Razorpay
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', margin: '.22rem 0', fontWeight: strong ? 800 : 500 }}>
      <span style={{ color: strong ? '#f2f7ff' : '#9db0c7' }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function btnSmall() {
  return {
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 10,
    padding: '.33rem .55rem',
    background: 'rgba(255,255,255,0.07)',
    color: '#eaf2ff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '.25rem'
  };
}

function iconBtn() {
  return {
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 8,
    width: 26,
    height: 26,
    display: 'grid',
    placeItems: 'center',
    background: 'rgba(255,255,255,0.06)',
    color: '#d7e3f7',
    cursor: 'pointer'
  };
}

function payOption(active) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '.45rem',
    border: `1px solid ${active ? 'rgba(43,144,255,0.7)' : 'rgba(255,255,255,0.2)'}`,
    borderRadius: 10,
    padding: '.55rem .65rem',
    background: active ? 'rgba(43,144,255,0.12)' : 'transparent',
    fontSize: '.9rem',
    cursor: 'pointer'
  };
}
