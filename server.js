console.log('=== 🚨 EMERGENCY DEBUG SERVER LOADED 🚨 ===');
console.log('=== Admin Verification System ACTIVE ===');

import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from './config/database.js';
import fs from 'fs';
import multer from 'multer';

// ✅ MULTER CONFIG - MEMORY STORAGE ONLY
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

const app = express();

// ✅ INCREASE PAYLOAD LIMIT
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ✅ FIX CORS
app.use(cors({
  origin: [
    'https://pleaseee-one.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ==================== MIDDLEWARE ====================

// ✅ AUTH MIDDLEWARE
const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Access token required' 
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ 
      success: false, 
      message: 'Invalid token' 
    });
  }
};

// ✅ ADMIN MIDDLEWARE
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ 
      success: false, 
      message: 'Admin access required' 
    });
  }
  next();
};

// ==================== BOOKING ENDPOINTS ====================

// ✅ OCCUPIED SEATS ENDPOINT - DENGAN /api
app.get('/api/bookings/occupied-seats', async (req, res) => {
  let connection;
  try {
    const { showtime_id, movie_title } = req.query;
    
    console.log('🎯 Fetching occupied seats for:', { showtime_id, movie_title });
    
    if (!showtime_id) {
      return res.status(400).json({
        success: false,
        message: 'Showtime ID is required'
      });
    }

    connection = await pool.promise().getConnection();
    
    // ✅ PERBAIKI QUERY - tambahkan movie_title filter
    const [bookings] = await connection.execute(
      `SELECT seat_numbers FROM bookings 
       WHERE showtime_id = ? AND movie_title = ?
       AND status IN ('confirmed', 'pending_verification')`,
      [showtime_id, movie_title]
    );
    
    connection.release();

    console.log(`✅ Found ${bookings.length} bookings for showtime ${showtime_id}`);

    const occupiedSeats = new Set();
    
    bookings.forEach(booking => {
      try {
        let seats;
        if (typeof booking.seat_numbers === 'string') {
          try {
            seats = JSON.parse(booking.seat_numbers);
          } catch (e) {
            seats = booking.seat_numbers.split(',').map(seat => seat.trim());
          }
        } else {
          seats = booking.seat_numbers;
        }
        
        if (Array.isArray(seats)) {
          seats.forEach(seat => {
            if (seat && seat.trim() !== '') {
              occupiedSeats.add(seat.trim());
            }
          });
        }
      } catch (error) {
        console.error('Error processing seat numbers:', error);
      }
    });

    const occupiedSeatsArray = Array.from(occupiedSeats);
    console.log(`🎯 Occupied seats:`, occupiedSeatsArray);

    res.json({
      success: true,
      data: occupiedSeatsArray
    });

  } catch (error) {
    console.error('❌ Error in occupied-seats:', error);
    res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message,
      data: []
    });
  } finally {
    if (connection) connection.release();
  }
});


// ✅ Juga tambahkan endpoint CREATE BOOKING dengan /api
app.post('/api/bookings', async (req, res) => {
  let connection;
  try {
    const {
      showtime_id,
      customer_name,
      customer_email,
      customer_phone,
      seat_numbers,
      total_amount,
      movie_title
    } = req.body;

    console.log('📥 Creating booking via /api/bookings:', {
      showtime_id,
      customer_name,
      seat_numbers,
      total_amount
    });

    if (!showtime_id || !customer_name || !customer_email || !seat_numbers || !total_amount) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    connection = await pool.promise().getConnection();

    // Generate booking reference
    const booking_reference = 'BK' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
    const verification_code = Math.floor(100000 + Math.random() * 900000).toString();

    // Insert booking dengan status pending
    const query = `
      INSERT INTO bookings 
      (showtime_id, customer_name, customer_email, customer_phone, 
       seat_numbers, total_amount, movie_title, booking_reference, 
       verification_code, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `;

    const [result] = await connection.execute(query, [
      showtime_id,
      customer_name,
      customer_email,
      customer_phone || null,
      JSON.stringify(seat_numbers),
      total_amount,
      movie_title || null,
      booking_reference,
      verification_code
    ]);

    const bookingId = result.insertId;

    // Get the created booking
    const [newBookings] = await connection.execute(
      'SELECT * FROM bookings WHERE id = ?',
      [bookingId]
    );

    const newBooking = newBookings[0];

    // Parse seat numbers for response
    let parsedSeatNumbers;
    try {
      parsedSeatNumbers = JSON.parse(newBooking.seat_numbers);
    } catch (error) {
      parsedSeatNumbers = [newBooking.seat_numbers];
    }

    console.log('✅ Booking created via /api/bookings:', booking_reference);

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: {
        id: newBooking.id,
        booking_reference: newBooking.booking_reference,
        verification_code: newBooking.verification_code,
        customer_name: newBooking.customer_name,
        customer_email: newBooking.customer_email,
        customer_phone: newBooking.customer_phone,
        total_amount: newBooking.total_amount,
        seat_numbers: parsedSeatNumbers,
        status: newBooking.status,
        booking_date: newBooking.booking_date,
        movie_title: newBooking.movie_title,
        showtime_id: newBooking.showtime_id
      }
    });

  } catch (error) {
    console.error('❌ Booking creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create booking: ' + error.message
    });
  } finally {
    if (connection) connection.release();
  }
});


// ==================== PAYMENT & VERIFICATION ENDPOINTS ====================

// ✅ Tambahkan juga endpoint confirm-payment dengan /api
app.post('/api/bookings/confirm-payment', async (req, res) => {
  let connection;
  try {
    const { booking_reference } = req.body;
    
    console.log('💰 Confirming payment via /api for:', booking_reference);

    if (!booking_reference) {
      return res.status(400).json({
        success: false,
        message: 'Booking reference is required'
      });
    }

    connection = await pool.promise().getConnection();
    
    // ✅ UPDATE STATUS KE pending_verification BUKAN confirmed
    const [result] = await connection.execute(
      'UPDATE bookings SET status = "pending_verification", payment_date = NOW() WHERE booking_reference = ?',
      [booking_reference]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }
    
    // Get updated booking
    const [bookings] = await connection.execute(
      'SELECT * FROM bookings WHERE booking_reference = ?',
      [booking_reference]
    );
    
    const updatedBooking = bookings[0];
    
    // Parse seat numbers
    let seatNumbers;
    try {
      seatNumbers = JSON.parse(updatedBooking.seat_numbers);
    } catch (error) {
      seatNumbers = typeof updatedBooking.seat_numbers === 'string' 
        ? updatedBooking.seat_numbers.split(',').map(s => s.trim())
        : [updatedBooking.seat_numbers];
    }
    
    console.log('✅ Payment confirmed via /api, waiting verification:', booking_reference);
    
    const responseData = {
      ...updatedBooking,
      seat_numbers: seatNumbers
    };
    
    res.json({
      success: true,
      message: 'Payment proof uploaded! Waiting for admin verification.',
      data: responseData
    });
    
  } catch (error) {
    console.error('❌ Payment confirmation error:', error);
    res.status(500).json({
      success: false,
      message: 'Payment confirmation failed: ' + error.message
    });
  } finally {
    if (connection) connection.release();
  }
});

// ✅ UPLOAD PAYMENT PROOF - BASE64 VERSION
app.post('/api/update-payment-base64', async (req, res) => {
  console.log('=== 🚀 UPDATE PAYMENT BASE64 ===');
  
  try {
    const { booking_reference, payment_filename, payment_base64, payment_mimetype } = req.body;

    console.log('📦 Request received:', {
      booking_reference,
      payment_filename, 
      payment_base64_length: payment_base64 ? payment_base64.length : 0,
      payment_mimetype
    });

    if (!booking_reference || !payment_base64) {
      return res.status(400).json({ 
        success: false, 
        message: 'Booking reference and payment data required' 
      });
    }

    const connection = await pool.promise().getConnection();
    
    // Update database dengan base64 dan status pending_verification
    const [result] = await connection.execute(
      `UPDATE bookings SET 
        payment_proof = ?,
        payment_filename = ?,
        payment_base64 = ?,
        payment_mimetype = ?,
        status = 'pending_verification',  // ✅ STATUS VERIFICATION
        payment_date = NOW()
      WHERE booking_reference = ?`,
      [payment_filename, payment_filename, payment_base64, payment_mimetype, booking_reference]
    );
    
    connection.release();
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Booking not found' 
      });
    }
    
    console.log('✅ Payment base64 saved, waiting verification');
    
    res.json({ 
      success: true, 
      message: 'Payment proof uploaded! Waiting for admin verification.',
      fileName: payment_filename
    });
    
  } catch (error) {
    console.error('❌ Update payment error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Upload failed: ' + error.message 
    });
  }
});

// ✅ UPLOAD PAYMENT - MULTER VERSION
app.post('/api/upload-payment', upload.single('payment_proof'), async (req, res) => {
  console.log('=== 🚀 UPLOAD PAYMENT (MULTER) ===');
  
  if (!req.file || !req.body.booking_reference) {
    return res.status(400).json({ 
      success: false, 
      message: 'File and booking reference required' 
    });
  }

  let connection;
  try {
    const base64Image = req.file.buffer.toString('base64');
    const fileName = `payment-${Date.now()}-${req.file.originalname}`;
    
    console.log('📤 Uploading for booking:', req.body.booking_reference);
    
    connection = await pool.promise().getConnection();

    // Update dengan status pending_verification
    const [result] = await connection.execute(
      `UPDATE bookings SET 
        payment_proof = ?, 
        payment_filename = ?, 
        payment_base64 = ?, 
        payment_mimetype = ?,
        status = 'pending_verification',  // ✅ STATUS VERIFICATION
        payment_date = NOW()
      WHERE booking_reference = ?`,
      [fileName, req.file.originalname, base64Image, req.file.mimetype, req.body.booking_reference]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }
    
    console.log('✅ Upload successful (Base64), waiting verification');
    
    res.json({
      success: true,
      message: 'Payment proof uploaded! Waiting for admin verification.',
      fileName: fileName,
      bookingReference: req.body.booking_reference
    });
    
  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Upload failed: ' + error.message
    });
  } finally {
    if (connection) connection.release();
  }
});

// ==================== ADMIN VERIFICATION ENDPOINTS ====================

// ✅ GET PENDING VERIFICATIONS
app.get('/api/admin/pending-verifications', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('=== 📋 ADMIN PENDING VERIFICATIONS ===');
    
    const connection = await pool.promise().getConnection();
    
    const [verifications] = await connection.execute(`
      SELECT 
        b.id,
        b.booking_reference,
        b.movie_title,
        b.showtime,
        b.seat_numbers,
        b.total_amount,
        b.payment_proof,
        b.payment_base64,
        b.status,
        b.created_at,
        b.verified_at,
        b.verified_by,
        u.name as customer_name,
        u.email as customer_email,
        u.phone as customer_phone
      FROM bookings b
      LEFT JOIN users u ON b.user_id = u.id
      WHERE b.status = 'pending_verification'
      ORDER BY b.created_at ASC
    `);
    
    connection.release();

    console.log(`✅ Found ${verifications.length} pending verifications`);

    // Format data
    const formattedVerifications = verifications.map(booking => ({
      ...booking,
      has_payment_proof: !!(booking.payment_proof || booking.payment_base64),
      seat_numbers: typeof booking.seat_numbers === 'string' 
        ? JSON.parse(booking.seat_numbers) 
        : booking.seat_numbers
    }));

    res.json({
      success: true,
      data: formattedVerifications
    });

  } catch (error) {
    console.error('❌ Pending verifications error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch pending verifications: ' + error.message 
    });
  }
});

// ✅ VERIFY PAYMENT (APPROVE/REJECT)
app.post('/api/admin/verify-payment', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { booking_reference, action, admin_notes } = req.body;
    
    console.log('=== ✅ ADMIN VERIFY PAYMENT ===', { booking_reference, action, admin_notes });

    if (!booking_reference || !action) {
      return res.status(400).json({
        success: false,
        message: 'Booking reference and action required'
      });
    }

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid action. Use 'approve' or 'reject'"
      });
    }

    const connection = await pool.promise().getConnection();
    
    const newStatus = action === 'approve' ? 'confirmed' : 'payment_rejected';
    const verifiedBy = req.user.username || 'admin';

    // Update booking status
    const [result] = await connection.execute(
      `UPDATE bookings SET 
        status = ?,
        verified_at = NOW(),
        verified_by = ?,
        admin_notes = ?
       WHERE booking_reference = ?`,
      [newStatus, verifiedBy, admin_notes || '', booking_reference]
    );
    
    if (result.affectedRows === 0) {
      connection.release();
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Get updated booking
    const [updatedBookings] = await connection.execute(
      'SELECT * FROM bookings WHERE booking_reference = ?',
      [booking_reference]
    );
    
    connection.release();

    const updatedBooking = updatedBookings[0];
    
    console.log(`✅ Payment ${action}ed for:`, booking_reference);

    res.json({
      success: true,
      message: `Payment ${action === 'approve' ? 'approved' : 'rejected'} successfully`,
      data: updatedBooking
    });

  } catch (error) {
    console.error('❌ Verify payment error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Verification failed: ' + error.message 
    });
  }
});

// ✅ GET VERIFICATION STATISTICS
app.get('/api/admin/verification-stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('=== 📊 VERIFICATION STATS ===');
    
    const connection = await pool.promise().getConnection();
    
    // Status counts
    const [statusCounts] = await connection.execute(`
      SELECT 
        status,
        COUNT(*) as count
      FROM bookings 
      WHERE status IN ('pending_verification', 'confirmed', 'payment_rejected')
      GROUP BY status
    `);
    
    // Today's processed count
    const [todayProcessed] = await connection.execute(`
      SELECT COUNT(*) as count 
      FROM bookings 
      WHERE verified_at::date = CURRENT_DATE
    `);
    
    connection.release();

    const stats = {
      pending_verification: 0,
      confirmed: 0,
      payment_rejected: 0,
      today_processed: parseInt(todayProcessed[0]?.count) || 0
    };

    statusCounts.forEach(row => {
      stats[row.status] = parseInt(row.count);
    });

    console.log('✅ Verification stats:', stats);

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('❌ Verification stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch stats: ' + error.message 
    });
  }
});

// ✅ GET PAYMENT PROOF FOR VERIFICATION
app.get('/api/admin/payment-proof/:bookingReference', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { bookingReference } = req.params;
    console.log('=== 🖼️ ADMIN PAYMENT PROOF ===', bookingReference);

    const connection = await pool.promise().getConnection();
    const [bookings] = await connection.execute(
      `SELECT payment_base64, payment_filename, payment_mimetype 
       FROM bookings WHERE booking_reference = ?`,
      [bookingReference]
    );
    
    connection.release();

    if (bookings.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Booking not found' 
      });
    }

    const booking = bookings[0];
    
    if (booking.payment_base64) {
      res.json({
        success: true,
        data: {
          image_data: `data:${booking.payment_mimetype};base64,${booking.payment_base64}`,
          filename: booking.payment_filename,
          mimetype: booking.payment_mimetype
        }
      });
    } else {
      res.status(404).json({ 
        success: false, 
        message: 'No payment proof image available' 
      });
    }

  } catch (error) {
    console.error('❌ Get payment proof error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get payment proof: ' + error.message 
    });
  }
});

// ==================== ADMIN DATABASE ENDPOINTS ====================

// ✅ ADMIN GET ALL BOOKINGS
app.get('/api/admin/all-bookings', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('=== 📋 ADMIN ALL BOOKINGS ===');
    
    const connection = await pool.promise().getConnection();
    
    const [bookings] = await connection.execute(`
      SELECT 
        id,
        booking_reference,
        customer_name,
        customer_email,
        customer_phone,
        movie_title,
        total_amount,
        seat_numbers,
        status,
        payment_proof,
        payment_filename,
        payment_base64 IS NOT NULL as has_payment_image,
        verified_at,
        verified_by,
        admin_notes,
        DATE_FORMAT(booking_date, '%Y-%m-%d %H:%i') as booking_date
      FROM bookings 
      ORDER BY booking_date DESC
    `);
    
    connection.release();

    console.log(`✅ Found ${bookings.length} bookings for admin`);

    res.json({
      success: true,
      data: bookings
    });

  } catch (error) {
    console.error('❌ Admin all bookings error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch bookings: ' + error.message 
    });
  }
});

// ✅ ADMIN UPDATE BOOKING STATUS
app.put('/api/admin/bookings/:bookingReference/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { bookingReference } = req.params;
    const { status } = req.body;
    
    console.log('=== 🔄 UPDATE BOOKING STATUS ===', { bookingReference, status });

    const connection = await pool.promise().getConnection();
    
    const [result] = await connection.execute(
      `UPDATE bookings SET 
        status = ?,
        verified_at = ?,
        verified_by = ?
       WHERE booking_reference = ?`,
      [
        status, 
        status === 'confirmed' ? new Date() : null,
        status === 'confirmed' ? req.user.username : null,
        bookingReference
      ]
    );
    
    connection.release();

    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Booking not found' 
      });
    }

    res.json({
      success: true,
      message: `Booking status updated to ${status}`,
      data: {
        booking_reference: bookingReference,
        status: status
      }
    });

  } catch (error) {
    console.error('❌ Update status error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update status: ' + error.message 
    });
  }
});

// ==================== USER ENDPOINTS ====================

// ✅ GET ALL BOOKINGS (Regular)
app.get('/api/bookings', async (req, res) => {
  try {
    console.log('=== 📋 ALL BOOKINGS REQUEST ===');
    
    const connection = await pool.promise().getConnection();
    
    const [bookings] = await connection.execute(`
      SELECT 
        id,
        booking_reference,
        customer_name,
        customer_email,
        movie_title,
        total_amount,
        seat_numbers,
        status,
        payment_proof,
        payment_filename,
        payment_base64 IS NOT NULL as has_payment_image,
        DATE_FORMAT(booking_date, '%Y-%m-%d %H:%i') as booking_date
      FROM bookings 
      WHERE status != 'cancelled'
      ORDER BY booking_date DESC
    `);
    
    connection.release();

    console.log(`✅ Found ${bookings.length} regular bookings`);

    res.json({
      success: true,
      data: bookings
    });

  } catch (error) {
    console.error('❌ All bookings error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch bookings: ' + error.message 
    });
  }
});

// ✅ BUNDLE ORDERS ENDPOINT
app.get('/api/bookings/bundle-orders', async (req, res) => {
  try {
    console.log('=== 📦 BUNDLE ORDERS REQUEST ===');
    
    res.json({
      success: true,
      data: [],
      message: 'Bundle orders feature coming soon'
    });

  } catch (error) {
    console.error('❌ Bundle orders error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch bundle orders: ' + error.message 
    });
  }
});

// ✅ MY BOOKINGS ENDPOINT
app.get('/api/bookings/my-bookings', async (req, res) => {
  try {
    const { username, email } = req.query;
    
    console.log('=== 🎫 MY BOOKINGS REQUEST ===', { username, email });

    if (!username && !email) {
      return res.status(400).json({
        success: false,
        message: 'Username or email required'
      });
    }

    const connection = await pool.promise().getConnection();
    
    let query = `
      SELECT 
        id,
        booking_reference,
        customer_name,
        customer_email, 
        movie_title,
        total_amount,
        seat_numbers,
        status,
        payment_proof,
        payment_filename,
        payment_base64 IS NOT NULL as has_payment_image,
        booking_date
      FROM bookings 
      WHERE status != 'cancelled'
    `;
    
    let params = [];
    
    if (username) {
      query += ' AND customer_name = ?';
      params.push(username);
    }
    
    if (email) {
      query += ' AND customer_email = ?';
      params.push(email);
    }
    
    query += ' ORDER BY booking_date DESC';

    const [bookings] = await connection.execute(query, params);
    
    connection.release();

    console.log(`✅ Found ${bookings.length} bookings for`, username || email);

    res.json({
      success: true,
      data: bookings
    });

  } catch (error) {
    console.error('❌ My bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bookings: ' + error.message
    });
  }
});

// ==================== AUTH ENDPOINTS ====================

// ✅ LOGIN ADMIN
app.post('/api/auth/login', async (req, res) => {
  try {
    console.log('🔐 Login attempt:', req.body);
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username and password required' 
      });
    }

    const connection = await pool.promise().getConnection();
    const [users] = await connection.execute(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );
    connection.release();

    if (users.length === 0) {
      return res.status(401).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid password' 
      });
    }

    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username, 
        role: user.role 
      },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role
        },
        token
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ✅ CREATE ADMIN USER
app.post('/api/auth/create-admin', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username and password required' 
      });
    }

    const connection = await pool.promise().getConnection();
    
    // Check if admin already exists
    const [existing] = await connection.execute(
      'SELECT * FROM users WHERE username = ? OR role = "admin"',
      [username]
    );

    if (existing.length > 0) {
      connection.release();
      return res.status(400).json({ 
        success: false, 
        message: 'Admin user already exists' 
      });
    }

    // Hash password and create admin
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const [result] = await connection.execute(
      'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, "admin")',
      [username, email || `${username}@admin.com`, hashedPassword]
    );
    
    connection.release();

    res.json({
      success: true,
      message: 'Admin user created successfully',
      data: {
        id: result.insertId,
        username: username,
        role: 'admin'
      }
    });

  } catch (error) {
    console.error('Create admin error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ==================== BASIC ROUTES ====================

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Server is working!',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'Admin Verification Server Running!', 
    status: 'OK',
    features: ['Payment Verification System', 'Admin Dashboard', 'Base64 Image Storage']
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    verification_system: 'ACTIVE'
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚨 Admin Verification Server running on port ${PORT}`);
  console.log(`✅ Payment Verification System: ACTIVE`);
  console.log(`✅ Admin Endpoints: ENABLED`);
  console.log(`✅ Base64 Image Storage: ACTIVE`);
});

export default app;