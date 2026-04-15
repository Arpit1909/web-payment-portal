import { useMemo, useState } from 'react';
import {
  BookOpen,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  CreditCard,
  Search,
  Sparkles,
  X,
  Star
} from 'lucide-react';

const EBOOKS = [
  {
    id: 'ebk-1',
    title: 'Atomic Habits',
    author: 'James Clear',
    price: 399,
    category: 'Self Growth',
    popularity: 98,
    releasedAt: '2018-10-16',
    bestSeller: true,
    isNew: false,
    cover: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=500&q=80',
    blurb: 'Build better habits with practical, science-backed methods.',
    pages: 320,
    language: 'English',
    format: 'PDF + EPUB'
  },
  {
    id: 'ebk-2',
    title: 'The Psychology of Money',
    author: 'Morgan Housel',
    price: 349,
    category: 'Finance',
    popularity: 96,
    releasedAt: '2020-09-08',
    bestSeller: true,
    isNew: false,
    cover: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=500&q=80',
    blurb: 'Timeless lessons on wealth, greed, and financial behavior.',
    pages: 256,
    language: 'English',
    format: 'PDF + EPUB'
  },
  {
    id: 'ebk-3',
    title: 'Rich Dad Poor Dad',
    author: 'Robert T. Kiyosaki',
    price: 299,
    category: 'Finance',
    popularity: 92,
    releasedAt: '1997-04-01',
    bestSeller: true,
    isNew: false,
    cover: 'https://images.unsplash.com/photo-1495446815901-a7297e633e8d?auto=format&fit=crop&w=500&q=80',
    blurb: 'A bestselling mindset shift for money, assets, and investing.',
    pages: 336,
    language: 'English',
    format: 'PDF + EPUB'
  },
  {
    id: 'ebk-4',
    title: 'The 7 Habits of Highly Effective People',
    author: 'Stephen R. Covey',
    price: 449,
    category: 'Leadership',
    popularity: 88,
    releasedAt: '1989-08-15',
    bestSeller: false,
    isNew: false,
    cover: 'https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=500&q=80',
    blurb: 'Powerful principles for personal and professional effectiveness.',
    pages: 432,
    language: 'English',
    format: 'PDF + EPUB'
  },
  {
    id: 'ebk-5',
    title: 'Ikigai',
    author: 'Hector Garcia & Francesc Miralles',
    price: 299,
    category: 'Self Growth',
    popularity: 84,
    releasedAt: '2016-04-29',
    bestSeller: false,
    isNew: false,
    cover: 'https://images.unsplash.com/photo-1455885666463-9ad48653f7ce?auto=format&fit=crop&w=500&q=80',
    blurb: 'Japanese wisdom for a meaningful, balanced, and joyful life.',
    pages: 224,
    language: 'English',
    format: 'PDF + EPUB'
  },
  {
    id: 'ebk-6',
    title: 'Think and Grow Rich',
    author: 'Napoleon Hill',
    price: 279,
    category: 'Self Growth',
    popularity: 85,
    releasedAt: '1937-01-01',
    bestSeller: false,
    isNew: false,
    cover: 'https://images.unsplash.com/photo-1516979187457-637abb4f9353?auto=format&fit=crop&w=500&q=80',
    blurb: 'Classic success philosophy used by entrepreneurs worldwide.',
    pages: 320,
    language: 'English',
    format: 'PDF + EPUB'
  },
  {
    id: 'ebk-7',
    title: 'Deep Work',
    author: 'Cal Newport',
    price: 359,
    category: 'Productivity',
    popularity: 90,
    releasedAt: '2016-01-05',
    bestSeller: false,
    isNew: false,
    cover: 'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?auto=format&fit=crop&w=500&q=80',
    blurb: 'Master focus and produce high-value work in less time.',
    pages: 304,
    language: 'English',
    format: 'PDF + EPUB'
  },
  {
    id: 'ebk-8',
    title: 'The Almanack of Naval Ravikant',
    author: 'Eric Jorgenson',
    price: 399,
    category: 'Business',
    popularity: 87,
    releasedAt: '2020-12-01',
    bestSeller: false,
    isNew: true,
    cover: 'https://images.unsplash.com/photo-1509266272358-7701da638078?auto=format&fit=crop&w=500&q=80',
    blurb: 'Wisdom on wealth, happiness, leverage, and long-term thinking.',
    pages: 252,
    language: 'English',
    format: 'PDF + EPUB'
  },
  {
    id: 'ebk-9',
    title: 'The Subtle Art of Not Giving a F*ck',
    author: 'Mark Manson',
    price: 379,
    category: 'Self Growth',
    popularity: 89,
    releasedAt: '2016-09-13',
    bestSeller: true,
    isNew: false,
    cover: 'https://images.unsplash.com/photo-1515098506762-79e1384e9d8e?auto=format&fit=crop&w=500&q=80',
    blurb: 'A brutally honest approach to living a better life.',
    pages: 224,
    language: 'English',
    format: 'PDF + EPUB'
  },
  {
    id: 'ebk-10',
    title: 'Sapiens',
    author: 'Yuval Noah Harari',
    price: 499,
    category: 'History',
    popularity: 91,
    releasedAt: '2011-01-01',
    bestSeller: true,
    isNew: false,
    cover: 'https://images.unsplash.com/photo-1496104679561-38b3b4f4d5f4?auto=format&fit=crop&w=500&q=80',
    blurb: 'A brief history of humankind from evolution to modern society.',
    pages: 512,
    language: 'English',
    format: 'PDF + EPUB'
  },
  {
    id: 'ebk-11',
    title: 'Start With Why',
    author: 'Simon Sinek',
    price: 339,
    category: 'Leadership',
    popularity: 83,
    releasedAt: '2009-10-06',
    bestSeller: false,
    isNew: false,
    cover: 'https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&w=500&q=80',
    blurb: 'How great leaders inspire action and build loyal communities.',
    pages: 256,
    language: 'English',
    format: 'PDF + EPUB'
  },
  {
    id: 'ebk-12',
    title: 'Zero to One',
    author: 'Peter Thiel',
    price: 329,
    category: 'Business',
    popularity: 86,
    releasedAt: '2014-09-16',
    bestSeller: false,
    isNew: false,
    cover: 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=500&q=80',
    blurb: 'Notes on startups and building truly innovative businesses.',
    pages: 224,
    language: 'English',
    format: 'PDF + EPUB'
  },
  {
    id: 'ebk-13',
    title: 'The Lean Startup',
    author: 'Eric Ries',
    price: 369,
    category: 'Business',
    popularity: 82,
    releasedAt: '2011-09-13',
    bestSeller: false,
    isNew: true,
    cover: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=500&q=80',
    blurb: 'How today’s entrepreneurs use continuous innovation to create businesses.',
    pages: 336,
    language: 'English',
    format: 'PDF + EPUB'
  },
  {
    id: 'ebk-14',
    title: 'Can’t Hurt Me',
    author: 'David Goggins',
    price: 429,
    category: 'Self Growth',
    popularity: 94,
    releasedAt: '2018-12-04',
    bestSeller: true,
    isNew: true,
    cover: 'https://images.unsplash.com/photo-1476275466078-4007374efbbe?auto=format&fit=crop&w=500&q=80',
    blurb: 'Master your mind and defy the odds with mental toughness.',
    pages: 364,
    language: 'English',
    format: 'PDF + EPUB'
  }
];

function formatInr(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(value);
}

function toTime(ts) {
  return new Date(ts).getTime();
}

export default function MaintenanceEbook() {
  const [cart, setCart] = useState({});
  const [paymentMethod, setPaymentMethod] = useState('payment');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('All');
  const [sortBy, setSortBy] = useState('popularity');
  const [selectedBook, setSelectedBook] = useState(null);

  const tabs = useMemo(() => ['All', ...Array.from(new Set(EBOOKS.map((b) => b.category)))], []);

  const visibleBooks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    let filtered = EBOOKS.filter((book) => {
      const inCategory = activeTab === 'All' || book.category === activeTab;
      const inSearch =
        !query ||
        book.title.toLowerCase().includes(query) ||
        book.author.toLowerCase().includes(query) ||
        book.category.toLowerCase().includes(query);
      return inCategory && inSearch;
    });

    filtered = [...filtered].sort((a, b) => {
      if (sortBy === 'priceLowHigh') return a.price - b.price;
      if (sortBy === 'newest') return toTime(b.releasedAt) - toTime(a.releasedAt);
      return b.popularity - a.popularity;
    });

    return filtered;
  }, [activeTab, searchQuery, sortBy]);

  const items = useMemo(
    () => EBOOKS.map((book) => ({ ...book, qty: cart[book.id] || 0 })).filter((book) => book.qty > 0),
    [cart]
  );

  const subtotal = useMemo(() => items.reduce((sum, item) => sum + item.price * item.qty, 0), [items]);
  const platformFee = subtotal > 0 ? 9 : 0;
  const total = subtotal + platformFee;

  const add = (id) => setCart((prev) => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
  const remove = (id) =>
    setCart((prev) => {
      const next = { ...prev };
      if (!next[id]) return prev;
      next[id] -= 1;
      if (next[id] <= 0) delete next[id];
      return next;
    });

  const clearItem = (id) =>
    setCart((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const handlePay = () => {
    if (!items.length) return;
    alert('Temporary maintenance template: connect this button to your payment checkout flow.');
  };

  return (
    <div style={{ minHeight: '100vh', background: '#080b12', color: '#f5f7fa', padding: '1.2rem' }}>
      <div style={{ maxWidth: 1650, margin: '0 auto' }}>
        <div
          style={{
            border: '1px solid rgba(96,165,250,0.28)',
            borderRadius: 22,
            padding: '1.15rem 1.3rem',
            marginBottom: '1rem',
            background:
              'linear-gradient(110deg, rgba(18,29,49,0.96) 0%, rgba(24,52,99,0.94) 34%, rgba(15,106,126,0.9) 65%, rgba(22,34,58,0.95) 100%)',
            backgroundSize: '220% 220%',
            animation: 'heroFlow 8s ease-in-out infinite',
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: '.85rem 1rem',
            alignItems: 'center',
            position: 'relative',
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              position: 'absolute',
              width: 280,
              height: 280,
              borderRadius: '50%',
              right: -70,
              top: -120,
              background: 'radial-gradient(circle, rgba(56,189,248,0.3), transparent 65%)',
              animation: 'orbPulse 4s ease-in-out infinite',
              pointerEvents: 'none'
            }}
          />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.55rem', fontWeight: 900, letterSpacing: '.01em' }}>
              <BookOpen size={20} />
              <span style={{ fontSize: '1.07rem' }}>Premium Ebook Collection</span>
            </div>
            <p style={{ margin: '.42rem 0 .62rem', color: '#d9e8ff', fontSize: '.9rem' }}>
              Curated bestselling titles across business, finance, productivity, leadership, and personal growth.
            </p>
            <div style={{ display: 'flex', gap: '.45rem', flexWrap: 'wrap' }}>
              <span style={heroChip('rgba(56,189,248,0.18)')}>Instant Download</span>
              <span style={heroChip('rgba(16,185,129,0.18)')}>Secure Checkout</span>
              <span style={heroChip('rgba(168,85,247,0.18)')}>Curated Bestsellers</span>
            </div>
          </div>
          <div
            style={{
              position: 'relative',
              zIndex: 1,
              display: 'grid',
              gap: '.45rem'
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '.45rem',
                border: '1px solid rgba(255,255,255,0.22)',
                borderRadius: 999,
                padding: '.42rem .78rem',
                background: 'rgba(255,255,255,0.1)',
                color: '#e7f3ff',
                fontSize: '.82rem',
                fontWeight: 700,
                whiteSpace: 'nowrap'
              }}
            >
              <Sparkles size={14} />
              Trusted by 25,000+ readers
            </div>
            <div style={{ textAlign: 'right', color: '#cde4ff', fontSize: '.78rem', opacity: 0.92 }}>
              14+ curated titles · daily offers
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,3fr) minmax(300px,1fr)', gap: '1rem' }}>
          <div>
            <div
              style={{
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 14,
                background: 'rgba(255,255,255,0.03)',
                padding: '.8rem',
                marginBottom: '.9rem'
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(240px, 1.2fr) 2fr auto',
                  gap: '.7rem',
                  alignItems: 'center'
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 10,
                    overflow: 'hidden',
                    background: 'rgba(0,0,0,0.25)'
                  }}
                >
                  <Search
                    size={15}
                    style={{
                      position: 'absolute',
                      left: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: '#91a7c7'
                    }}
                  />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by title, author, or category..."
                    style={{
                      width: '100%',
                      padding: '.62rem .7rem .62rem 2rem',
                      border: 0,
                      outline: 0,
                      background: 'transparent',
                      color: '#eef4ff',
                      fontSize: '.9rem'
                    }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '.45rem', overflowX: 'auto', paddingBottom: '.2rem' }}>
                  {tabs.map((tab) => {
                    const active = tab === activeTab;
                    return (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        style={{
                          border: `1px solid ${active ? 'rgba(43,144,255,0.7)' : 'rgba(255,255,255,0.2)'}`,
                          background: active ? 'rgba(43,144,255,0.17)' : 'rgba(255,255,255,0.04)',
                          color: active ? '#d9ebff' : '#b7c6dd',
                          borderRadius: 999,
                          padding: '.45rem .75rem',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          fontSize: '.82rem',
                          fontWeight: 700
                        }}
                      >
                        {tab}
                      </button>
                    );
                  })}
                </div>

                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  style={{
                    border: '1px solid rgba(255,255,255,0.2)',
                    background: 'rgba(255,255,255,0.04)',
                    color: '#d9e8ff',
                    borderRadius: 10,
                    padding: '.52rem .62rem',
                    fontSize: '.82rem',
                    fontWeight: 700,
                    outline: 'none',
                    minWidth: 165
                  }}
                >
                  <option style={{ background: '#101824' }} value="popularity">
                    Sort: Popularity
                  </option>
                  <option style={{ background: '#101824' }} value="priceLowHigh">
                    Sort: Price Low-High
                  </option>
                  <option style={{ background: '#101824' }} value="newest">
                    Sort: Newest
                  </option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '.9rem' }}>
              {visibleBooks.map((book) => {
                const qty = cart[book.id] || 0;
                return (
                  <div
                    key={book.id}
                    onClick={() => setSelectedBook(book)}
                    style={{
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 16,
                      overflow: 'hidden',
                      background: 'rgba(255,255,255,0.03)',
                      display: 'flex',
                      flexDirection: 'column',
                      cursor: 'pointer',
                      position: 'relative'
                    }}
                  >
                    {book.bestSeller && <Ribbon type="best">Best Seller</Ribbon>}
                    {!book.bestSeller && book.isNew && <Ribbon type="new">New</Ribbon>}
                    <img src={book.cover} alt={book.title} style={{ width: '100%', height: 160, objectFit: 'cover' }} />
                    <div style={{ padding: '.8rem', display: 'flex', flexDirection: 'column', flex: 1 }}>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 'fit-content',
                          borderRadius: 999,
                          border: '1px solid rgba(43,144,255,0.4)',
                          color: '#9bccff',
                          background: 'rgba(43,144,255,0.14)',
                          fontSize: '.67rem',
                          padding: '.15rem .45rem',
                          marginBottom: '.4rem',
                          fontWeight: 700
                        }}
                      >
                        {book.category}
                      </span>
                      <h3 style={{ margin: 0, fontSize: '1rem' }}>{book.title}</h3>
                      <p style={{ margin: '.2rem 0 .5rem', color: '#9db0c7', fontSize: '.82rem' }}>by {book.author}</p>
                      <p style={{ margin: 0, color: '#c8d4e4', fontSize: '.82rem', minHeight: 44, flex: 1 }}>{book.blurb}</p>
                      <div style={{ marginTop: '.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ color: '#61dafb' }}>{formatInr(book.price)}</strong>
                        {qty === 0 ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              add(book.id);
                            }}
                            style={btnSmall()}
                          >
                            <Plus size={14} /> Add
                          </button>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                remove(book.id);
                              }}
                              style={iconBtn()}
                            >
                              <Minus size={14} />
                            </button>
                            <span style={{ minWidth: 18, textAlign: 'center' }}>{qty}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                add(book.id);
                              }}
                              style={iconBtn()}
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {!visibleBooks.length && (
                <div
                  style={{
                    gridColumn: '1 / -1',
                    textAlign: 'center',
                    border: '1px dashed rgba(255,255,255,0.22)',
                    borderRadius: 14,
                    padding: '1.5rem',
                    color: '#9db0c7'
                  }}
                >
                  No books found for this search/filter.
                </div>
              )}
            </div>
          </div>

          <aside
            style={{
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 16,
              background: 'rgba(255,255,255,0.03)',
              padding: '.9rem',
              alignSelf: 'start',
              position: 'sticky',
              top: 16
            }}
          >
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '.4rem' }}>
              <ShoppingCart size={18} /> Cart
            </h3>
            {!items.length ? (
              <p style={{ color: '#9db0c7', fontSize: '.9rem' }}>No ebooks selected yet.</p>
            ) : (
              <div style={{ display: 'grid', gap: '.6rem' }}>
                {items.map((item) => (
                  <div key={item.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '.45rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem' }}>
                      <div>
                        <div style={{ fontSize: '.92rem', fontWeight: 600 }}>{item.title}</div>
                        <div style={{ color: '#8aa0bc', fontSize: '.8rem' }}>
                          {formatInr(item.price)} x {item.qty}
                        </div>
                      </div>
                      <button onClick={() => clearItem(item.id)} style={iconBtn()}>
                        <Trash2 size={13} />
                      </button>
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
              <label style={payOption(paymentMethod === 'payment')}>
                <input
                  type="radio"
                  name="payment"
                  value="payment"
                  checked={paymentMethod === 'payment'}
                  onChange={() => setPaymentMethod('payment')}
                />
                <span style={{ display: 'flex', alignItems: 'center', gap: '.45rem' }}>
                  <CreditCard size={15} /> Make Payment
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
              Make Payment
            </button>
          </aside>
        </div>
      </div>

      {selectedBook && (
        <BookModal
          book={selectedBook}
          qty={cart[selectedBook.id] || 0}
          onClose={() => setSelectedBook(null)}
          onAdd={() => add(selectedBook.id)}
          onRemove={() => remove(selectedBook.id)}
        />
      )}
      <style>{`
        @keyframes heroFlow {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes orbPulse {
          0%, 100% { transform: scale(1); opacity: .6; }
          50% { transform: scale(1.1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function Ribbon({ type, children }) {
  const isBest = type === 'best';
  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        left: 10,
        zIndex: 2,
        fontSize: '.68rem',
        fontWeight: 800,
        padding: '.2rem .48rem',
        borderRadius: 999,
        color: '#fff',
        background: isBest ? 'linear-gradient(135deg,#f59e0b,#ef4444)' : 'linear-gradient(135deg,#10b981,#3b82f6)',
        border: '1px solid rgba(255,255,255,0.35)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '.25rem'
      }}
    >
      {isBest ? <Star size={11} /> : <Sparkles size={11} />}
      {children}
    </div>
  );
}

function BookModal({ book, qty, onClose, onAdd, onRemove }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(3,7,18,0.75)',
        backdropFilter: 'blur(2px)',
        display: 'grid',
        placeItems: 'center',
        padding: '1rem',
        zIndex: 50
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(920px, 100%)',
          border: '1px solid rgba(255,255,255,0.14)',
          borderRadius: 18,
          background: '#0f1624',
          overflow: 'hidden'
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr' }}>
          <img src={book.cover} alt={book.title} style={{ width: '100%', height: '100%', minHeight: 340, objectFit: 'cover' }} />
          <div style={{ padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem' }}>
              <div>
                <div style={{ display: 'flex', gap: '.4rem', marginBottom: '.35rem' }}>
                  <span style={tagStyle()}>{book.category}</span>
                  {book.bestSeller && <span style={tagStyle('best')}>Best Seller</span>}
                  {!book.bestSeller && book.isNew && <span style={tagStyle('new')}>New</span>}
                </div>
                <h2 style={{ margin: 0 }}>{book.title}</h2>
                <p style={{ margin: '.2rem 0 0', color: '#99b0cc' }}>by {book.author}</p>
              </div>
              <button onClick={onClose} style={iconBtn()}>
                <X size={15} />
              </button>
            </div>

            <p style={{ marginTop: '.9rem', color: '#d0dbee', lineHeight: 1.6 }}>{book.blurb}</p>

            <div style={{ marginTop: '.8rem', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: '.6rem' }}>
              <Meta label="Pages" value={book.pages} />
              <Meta label="Language" value={book.language} />
              <Meta label="Format" value={book.format} />
            </div>

            <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
              <strong style={{ color: '#61dafb', fontSize: '1.2rem' }}>{formatInr(book.price)}</strong>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem' }}>
                {qty > 0 && (
                  <>
                    <button onClick={onRemove} style={iconBtn()}><Minus size={14} /></button>
                    <span style={{ minWidth: 20, textAlign: 'center' }}>{qty}</span>
                  </>
                )}
                <button onClick={onAdd} style={btnSmall()}>
                  <Plus size={14} /> {qty ? 'Add More' : 'Add to Cart'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }) {
  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '.5rem .55rem' }}>
      <div style={{ fontSize: '.7rem', color: '#8ea4c0', marginBottom: '.12rem' }}>{label}</div>
      <div style={{ fontSize: '.84rem', color: '#e8f1ff', fontWeight: 700 }}>{value}</div>
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
    border: '1px solid rgba(255,255,255,0.25)',
    borderRadius: 10,
    padding: '.33rem .6rem',
    background: 'rgba(255,255,255,0.09)',
    color: '#eaf2ff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '.25rem'
  };
}

function iconBtn() {
  return {
    border: '1px solid rgba(255,255,255,0.25)',
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

function tagStyle(type) {
  if (type === 'best') {
    return {
      borderRadius: 999,
      border: '1px solid rgba(245,158,11,0.6)',
      background: 'rgba(245,158,11,0.16)',
      color: '#ffdca8',
      fontSize: '.68rem',
      padding: '.15rem .45rem',
      fontWeight: 800
    };
  }
  if (type === 'new') {
    return {
      borderRadius: 999,
      border: '1px solid rgba(16,185,129,0.6)',
      background: 'rgba(16,185,129,0.16)',
      color: '#b9ffe6',
      fontSize: '.68rem',
      padding: '.15rem .45rem',
      fontWeight: 800
    };
  }
  return {
    borderRadius: 999,
    border: '1px solid rgba(43,144,255,0.6)',
    background: 'rgba(43,144,255,0.16)',
    color: '#b8d9ff',
    fontSize: '.68rem',
    padding: '.15rem .45rem',
    fontWeight: 800
  };
}

function heroChip(bg) {
  return {
    border: '1px solid rgba(255,255,255,0.24)',
    borderRadius: 999,
    padding: '.22rem .58rem',
    background: bg,
    color: '#dff0ff',
    fontSize: '.73rem',
    fontWeight: 700
  };
}
