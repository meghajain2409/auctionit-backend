require('dotenv').config();
require('./config/db');

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const morgan      = require('morgan');

const app  = express();
const PORT = process.env.PORT || 5000;

// ─── MIDDLEWARE ───────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ─── HEALTH CHECK ─────────────────────────────
app.get('/', (req, res) => {
  res.json({
    success : true,
    message : '🏷️ AuctionIt API is running!',
    version : '1.0.0',
    env     : process.env.NODE_ENV
  });
});

app.get('/health', async (req, res) => {
  const db = require('./config/db');
  try {
    await db.query('SELECT NOW()');
    res.json({
      success  : true,
      status   : 'healthy',
      database : '✅ Connected',
      time     : new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({
      success  : false,
      status   : 'unhealthy',
      database : '❌ Disconnected',
      error    : err.message
    });
  }
});

// ─── API ROUTES ───────────────────────────────
app.use('/api/auth',     require('./routes/authRoutes'));
app.use('/api/auctions', require('./routes/auctionRoutes'));
app.use('/api/auctions/:auctionId/lots', require('./routes/lotRoutes'));

// ─── 404 HANDLER ─────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success : false,
    message : `Route ${req.method} ${req.url} not found`
  });
});

// ─── GLOBAL ERROR HANDLER ─────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  res.status(err.status || 500).json({
    success : false,
    message : err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ─── START SERVER ─────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('  🏷️  AuctionIt API Server');
  console.log('  ─────────────────────────────');
  console.log(`  🚀  Running on  : http://localhost:${PORT}`);
  console.log(`  🌍  Environment : ${process.env.NODE_ENV}`);
  console.log(`  📅  Started at  : ${new Date().toLocaleString('en-IN')}`);
  console.log('  ─────────────────────────────');
  console.log('');
});

module.exports = app;