const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const bookingRoutes = require('./routes/bookings.js');
const { pool } = require('./config/database.js');

const app = express();
app.use(cors());
app.use(express.json());

// ✅ BASIC ROUTES
app.get('/', (req, res) => {
  res.json({ 
    message: 'Cinema Booking API is RUNNING!',
    timestamp: new Date().toISOString(),
    status: 'OK',
    websocket: 'Active on /ws'
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Other routes...
app.use('/api/bookings', bookingRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;