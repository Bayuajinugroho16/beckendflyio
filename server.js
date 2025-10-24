const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const authRoutes = require('./routes/auth');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ✅ HANYA BUAT 1 SERVER - HAPUS app.listen() YANG PERTAMA
const server = http.createServer(app);

// ✅ WEBSOCKET SERVER MENGGUNAKAN SERVER YANG SAMA
const wss = new WebSocket.Server({ 
  server, // Gunakan server HTTP yang sama
  path: '/ws' // Optional: path khusus untuk WebSocket
});

// Store connected clients per showtime
const clients = new Map();
// Store user connections untuk notifikasi personal
const userConnections = new Map();

wss.on('connection', (ws, req) => {
  console.log('🔌 New WebSocket connection');
  
  // Extract showtime dan user email dari query parameters
  const url = new URL(req.url, `http://${req.headers.host}`);
  const showtime = url.searchParams.get('showtime');
  const userEmail = url.searchParams.get('userEmail'); // Untuk notifikasi personal
  
  if (showtime) {
    if (!clients.has(showtime)) {
      clients.set(showtime, new Set());
    }
    clients.get(showtime).add(ws);
    ws.showtimeId = showtime;
    
    console.log(`📡 Client subscribed to showtime: ${showtime}`);
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: 'CONNECTED',
      message: `Subscribed to showtime ${showtime}`,
      timestamp: new Date().toISOString()
    }));
  }
  
  // Store user email jika ada (untuk notifikasi personal)
  if (userEmail) {
    ws.userEmail = userEmail;
    if (!userConnections.has(userEmail)) {
      userConnections.set(userEmail, new Set());
    }
    userConnections.get(userEmail).add(ws);
    
    console.log(`👤 User ${userEmail} connected to WebSocket`);
  }
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('📨 WebSocket message received:', data);
      
      // Handle different message types
      if (data.type === 'PING') {
        ws.send(JSON.stringify({
          type: 'PONG',
          timestamp: new Date().toISOString()
        }));
      }
    } catch (error) {
      console.error('❌ WebSocket message parse error:', error);
    }
  });
  
  ws.on('close', () => {
    console.log(`🔌 WebSocket connection closed for showtime: ${ws.showtimeId}, user: ${ws.userEmail}`);
    
    // Remove dari clients map
    if (ws.showtimeId && clients.has(ws.showtimeId)) {
      clients.get(ws.showtimeId).delete(ws);
      if (clients.get(ws.showtimeId).size === 0) {
        clients.delete(ws.showtimeId);
      }
    }
    
    // Remove dari user connections map
    if (ws.userEmail && userConnections.has(ws.userEmail)) {
      userConnections.get(ws.userEmail).delete(ws);
      if (userConnections.get(ws.userEmail).size === 0) {
        userConnections.delete(ws.userEmail);
      }
    }
  });
  
  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });
});

// ✅ GLOBAL NOTIFICATION FUNCTIONS
global.broadcastNotification = function(notificationData) {
  const message = JSON.stringify({
    type: 'NOTIFICATION',
    notification: notificationData,
    timestamp: new Date().toISOString()
  });
  
  let sentCount = 0;
  
  // Broadcast ke semua connected clients
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      sentCount++;
    }
  });
  
  console.log(`📢 Notification broadcast to ${sentCount} clients:`, notificationData.title);
  return sentCount;
};

global.sendNotificationToUser = function(userEmail, notificationData) {
  const message = JSON.stringify({
    type: 'NOTIFICATION',
    notification: notificationData,
    timestamp: new Date().toISOString()
  });
  
  let sentCount = 0;
  
  // Cari client dengan email tertentu
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.userEmail === userEmail) {
      client.send(message);
      sentCount++;
    }
  });
  
  console.log(`📧 Notification sent to ${userEmail} (${sentCount} clients):`, notificationData.title);
  return sentCount;
};

global.getConnectedClientsCount = function() {
  let count = 0;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) count++;
  });
  return count;
};

global.broadcastSeatUpdate = function(showtimeId, seatData) {
  if (!clients.has(showtimeId)) {
    console.log(`⚠️ No clients subscribed to showtime ${showtimeId}`);
    return;
  }
  
  const showtimeClients = clients.get(showtimeId);
  const message = JSON.stringify({
    type: 'SEAT_UPDATE',
    showtimeId: showtimeId,
    seats: seatData,
    timestamp: new Date().toISOString()
  });
  
  let sentCount = 0;
  showtimeClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      sentCount++;
    }
  });
  
  console.log(`📢 Broadcast seat update to ${sentCount} clients for showtime ${showtimeId}:`, seatData);
};

// ✅ LOAD ROUTES
try {
  const movieRoutes = require('./routes/movies');
  const bookingRoutes = require('./routes/bookings');
  const notificationRoutes = require('./routes/notifications');
  
  app.use('/api/auth', authRoutes);
  app.use('/api/movies', movieRoutes);
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/notifications', notificationRoutes);
  console.log('✅ Routes loaded successfully');
} catch (error) {
  console.error('❌ Route loading failed:', error);
}

// Basic route
app.get('/', (req, res) => {
  res.json({ 
    message: '🎬 Cinema Booking API is RUNNING!',
    timestamp: new Date().toISOString(),
    status: 'OK',
    websocket: 'Active on /ws',
    environment: process.env.NODE_ENV || 'development'
  });
});

// ✅ HEALTH CHECK ENDPOINT (WAJIB untuk Vercel/Railway)
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    websocket_clients: global.getConnectedClientsCount ? global.getConnectedClientsCount() : 0,
    memory_usage: process.memoryUsage(),
    uptime: process.uptime()
  });
});

// ✅ DATABASE TEST ENDPOINT
app.get('/api/debug/db', async (req, res) => {
  try {
    const { pool } = require('./config/database');
    const connection = await pool.promise().getConnection();
    const [result] = await connection.execute('SELECT NOW() as time, DATABASE() as db, USER() as user');
    connection.release();
    
    res.json({
      success: true,
      message: 'Database connection successful!',
      data: result[0],
      environment: {
        host: process.env.MYSQLHOST || process.env.DB_HOST,
        database: process.env.MYSQLDATABASE || process.env.DB_NAME,
        node_env: process.env.NODE_ENV
      }
    });
  } catch (error) {
    console.error('Database test error:', error);
    res.status(500).json({
      success: false,
      message: 'Database connection failed: ' + error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('🚨 Server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Handle 404
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.originalUrl} not found`
  });
});

// ✅ START SERVER YANG SAMA UNTUK BOTH HTTP & WEBSOCKET
// HAPUS: app.listen() yang di atas, gunakan ini saja
server.listen(PORT, '0.0.0.0', () => {
  console.log(`⚡ Server running on port ${PORT}`);
  console.log(`🔌 WebSocket available on ws://localhost:${PORT}/ws`);
  console.log(`⏰ Started at: ${new Date().toLocaleTimeString()}`);
  
  // Debug: Show registered routes
  console.log('🔄 Registered routes:');
  console.log('   GET  /');
  console.log('   GET  /health');
  console.log('   POST /api/auth/login');
  console.log('   POST /api/auth/register');
  console.log('   GET  /api/debug/db');
});

// ✅ Export untuk Vercel
module.exports = app;