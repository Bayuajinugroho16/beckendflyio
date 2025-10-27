// routes/notifications.js
const express = require('express');
const router = express.Router();

// ✅ BROADCAST NOTIFICATION TO ALL CONNECTED CLIENTS
router.post('/broadcast', async (req, res) => {
  try {
    const { title, message, type = 'info', category = 'general' } = req.body;
    
    console.log('📢 Admin broadcasting notification:', { title, message, type, category });

    // Validasi input
    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: 'Title and message are required'
      });
    }

    // Validasi type notifikasi
    const validTypes = ['info', 'success', 'warning', 'error'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    // Buat data notifikasi
    const notificationData = {
      id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      title,
      message,
      type,
      category,
      from: 'admin',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 jam
    };

    console.log('📨 Notification data prepared:', notificationData);

    // Broadcast ke semua client menggunakan function global
    if (global.broadcastNotification) {
      global.broadcastNotification(notificationData);
      
      res.json({
        success: true,
        message: `Notification broadcasted to all connected clients`,
        notification: notificationData,
        stats: {
          sentAt: new Date().toISOString(),
          type: type,
          category: category
        }
      });
    } else {
      throw new Error('Broadcast function not available');
    }
    
  } catch (error) {
    console.error('❌ Notification broadcast error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to broadcast notification: ' + error.message
    });
  }
});

// ✅ SEND NOTIFICATION TO SPECIFIC USER BY EMAIL
router.post('/send-to-user', async (req, res) => {
  try {
    const { userEmail, title, message, type = 'info' } = req.body;
    
    console.log('📧 Admin sending notification to user:', userEmail);

    if (!userEmail || !title || !message) {
      return res.status(400).json({
        success: false,
        message: 'User email, title and message are required'
      });
    }

    // Validasi email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    const notificationData = {
      id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      title,
      message,
      type,
      userEmail,
      from: 'admin',
      createdAt: new Date().toISOString(),
      isPersonal: true
    };

    console.log('📨 Personal notification data:', notificationData);

    // Kirim ke user tertentu
    if (global.sendNotificationToUser) {
      global.sendNotificationToUser(userEmail, notificationData);
      
      res.json({
        success: true,
        message: `Notification sent to ${userEmail}`,
        notification: notificationData
      });
    } else {
      throw new Error('Send to user function not available');
    }
    
  } catch (error) {
    console.error('❌ User notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send notification to user: ' + error.message
    });
  }
});

// ✅ SEND NOTIFICATION TO USERS WHO BOOKED SPECIFIC MOVIE/SHOWTIME
router.post('/send-to-movie-audience', async (req, res) => {
  try {
    const { movieTitle, showtimeId, title, message, type = 'info' } = req.body;
    
    console.log('🎬 Sending notification to movie audience:', { movieTitle, showtimeId });

    if (!movieTitle || !title || !message) {
      return res.status(400).json({
        success: false,
        message: 'Movie title, title and message are required'
      });
    }

    const { pool } = require('../config/database');
    const connection = await pool.promise().getConnection();

    try {
      // Cari semua user yang booking film tertentu
      let query = `
        SELECT DISTINCT customer_email 
        FROM bookings 
        WHERE movie_title = ? AND status = 'confirmed'
      `;
      let params = [movieTitle];

      // Jika ada showtimeId, filter berdasarkan showtime juga
      if (showtimeId) {
        query += ' AND showtime_id = ?';
        params.push(showtimeId);
      }

      const [users] = await connection.execute(query, params);
      
      console.log(`📊 Found ${users.length} users for movie: ${movieTitle}`);

      const notificationData = {
        id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        title,
        message,
        type,
        movieTitle,
        showtimeId: showtimeId || null,
        from: 'admin',
        createdAt: new Date().toISOString(),
        targetAudience: users.length
      };

      // Kirim ke setiap user
      let sentCount = 0;
      if (global.sendNotificationToUser) {
        users.forEach(user => {
          global.sendNotificationToUser(user.customer_email, notificationData);
          sentCount++;
        });
      }

      res.json({
        success: true,
        message: `Notification sent to ${sentCount} users who booked ${movieTitle}`,
        notification: notificationData,
        stats: {
          totalUsers: users.length,
          notificationsSent: sentCount,
          movie: movieTitle,
          showtime: showtimeId || 'all'
        }
      });

    } finally {
      connection.release();
    }
    
  } catch (error) {
    console.error('❌ Movie audience notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send notification to movie audience: ' + error.message
    });
  }
});

// ✅ GET NOTIFICATION HISTORY (jika ingin menyimpan history)
router.get('/history', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    
    // Dalam implementasi real, ini akan query database
    // Untuk sekarang kita return dummy data atau empty array
    
    res.json({
      success: true,
      message: 'Notification history (not implemented yet)',
      data: [],
      pagination: {
        limit: parseInt(limit),
        total: 0
      }
    });
    
  } catch (error) {
    console.error('❌ Notification history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get notification history: ' + error.message
    });
  }
});

// ✅ GET CONNECTED CLIENTS COUNT (untuk admin monitor)
router.get('/connected-clients', async (req, res) => {
  try {
    if (!global.getConnectedClientsCount) {
      return res.json({
        success: true,
        connectedClients: 0,
        message: 'WebSocket server function not available'
      });
    }

    const clientCount = global.getConnectedClientsCount();
    
    res.json({
      success: true,
      connectedClients: clientCount,
      message: `Currently ${clientCount} clients connected`
    });
    
  } catch (error) {
    console.error('❌ Connected clients error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get connected clients count: ' + error.message
    });
  }
});

// ✅ SYSTEM NOTIFICATION TEMPLATES
router.post('/system/:template', async (req, res) => {
  try {
    const { template } = req.params;
    const { movieTitle, showtime, additionalInfo } = req.body;

    const templates = {
      'maintenance': {
        title: '🛠️ System Maintenance',
        message: 'System will undergo maintenance in 30 minutes. Please save your work.',
        type: 'warning'
      },
      'new-movie': {
        title: '🎬 New Movie Alert!',
        message: `New movie "${movieTitle || 'coming soon'}" is now available for booking!`,
        type: 'info'
      },
      'showtime-cancelled': {
        title: '❌ Showtime Cancelled',
        message: `Showtime ${showtime || ''} for "${movieTitle || 'the movie'}" has been cancelled.`,
        type: 'error'
      },
      'special-offer': {
        title: '🎉 Special Offer!',
        message: 'Get 20% off on all bookings today! Limited time offer.',
        type: 'success'
      },
      'system-update': {
        title: '🔄 System Updated',
        message: 'System has been updated with new features and improvements.',
        type: 'info'
      }
    };

    if (!templates[template]) {
      return res.status(404).json({
        success: false,
        message: `Template '${template}' not found. Available: ${Object.keys(templates).join(', ')}`
      });
    }

    const notificationData = {
      ...templates[template],
      id: 'tpl_' + Date.now(),
      from: 'system',
      template: template,
      createdAt: new Date().toISOString()
    };

    // Customize message jika ada additionalInfo
    if (additionalInfo) {
      notificationData.message += ` ${additionalInfo}`;
    }

    // Broadcast template notification
    if (global.broadcastNotification) {
      global.broadcastNotification(notificationData);
      
      res.json({
        success: true,
        message: `System notification '${template}' broadcasted`,
        notification: notificationData
      });
    } else {
      throw new Error('Broadcast function not available');
    }
    
  } catch (error) {
    console.error('❌ System notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send system notification: ' + error.message
    });
  }
});

module.exports = router;