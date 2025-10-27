console.log('=== 🚨 EMERGENCY DEBUG SERVER LOADED 🚨 ===');
console.log('=== Filesystem debugger ACTIVE ===');

import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from './config/database.js';
import fs from 'fs';
import multer from 'multer';

// 🚨 FILESYSTEM DEBUGGER
const originalOpen = fs.open;
fs.open = function(filePath, flags, mode, callback) {
  if (typeof filePath === 'string' && filePath.includes('uploads')) {
    console.log('\n🚨 🚨 🚨 FILESYSTEM UPLOADS ACCESS DETECTED! 🚨 🚨 🚨');
    console.log('📁 File path:', filePath);
    console.log('🎯 Flags:', flags);
    
    const stack = new Error().stack;
    console.log('🔍 Full stack trace:');
    console.log(stack);
    
    const error = new Error(`DEBUG: Filesystem access blocked to ${filePath}`);
    error.code = 'EBLOCKED';
    if (typeof callback === 'function') {
      callback(error);
    }
    return;
  }
  
  return originalOpen.call(this, filePath, flags, mode, callback);
};
console.log('✅ Filesystem debugger installed');

// Override filesystem methods
const originalWriteFileSync = fs.writeFileSync;
fs.writeFileSync = (path, data, options) => {
  if (path.includes('uploads')) {
    console.log('🚨 BLOCKED filesystem write to:', path);
    return;
  }
  return originalWriteFileSync(path, data, options);
};

// Force multer memoryStorage globally
multer.diskStorage = () => {
  console.log('🚨 diskStorage blocked - using memoryStorage');
  return multer.memoryStorage();
};

// ✅ MULTER CONFIG
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


// ✅ OCCUPIED SEATS ENDPOINT - YANG DIPERLUKAN FRONTEND
app.get('/bookings/occupied-seats', async (req, res) => {
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
    
    // Query untuk mendapatkan kursi yang sudah dipesan
    const [bookings] = await connection.execute(
      `SELECT seat_numbers FROM bookings 
       WHERE showtime_id = ? AND status = 'confirmed'`,
      [showtime_id]
    );
    
    connection.release();

    console.log(`✅ Found ${bookings.length} bookings for showtime ${showtime_id}`);

    // Process seat numbers
    const occupiedSeats = new Set();
    
    bookings.forEach(booking => {
      try {
        let seats;
        if (typeof booking.seat_numbers === 'string') {
          try {
            seats = JSON.parse(booking.seat_numbers);
          } catch (e) {
            // Fallback: treat as comma-separated string
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

// ✅ CREATE BOOKING ENDPOINT - YANG DIPERLUKAN FRONTEND
app.post('/bookings', async (req, res) => {
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

    console.log('📥 Creating booking:', {
      showtime_id,
      customer_name,
      seat_numbers,
      total_amount
    });

    // Validasi
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

    // Insert booking
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

    console.log('✅ Booking created:', booking_reference);

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


// ✅ CONFIRM PAYMENT ENDPOINT - YANG DIPERLUKAN FRONTEND
app.post('/bookings/confirm-payment', async (req, res) => {
  let connection;
  try {
    const { booking_reference } = req.body;
    
    console.log('💰 Confirming payment for:', booking_reference);

    if (!booking_reference) {
      return res.status(400).json({
        success: false,
        message: 'Booking reference is required'
      });
    }

    connection = await pool.promise().getConnection();
    
    // Update status to confirmed
    const [result] = await connection.execute(
      'UPDATE bookings SET status = "confirmed" WHERE booking_reference = ?',
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
    
    console.log('✅ Payment confirmed for:', booking_reference);
    
    // Response data
    const responseData = {
      ...updatedBooking,
      seat_numbers: seatNumbers
    };
    
    res.json({
      success: true,
      message: 'Payment confirmed successfully!',
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

// ==================== PAYMENT UPLOAD ENDPOINTS ====================

// ✅ ENDPOINT UPDATE PAYMENT BASE64 - YANG UTAMA
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
    
    // Update database dengan base64
    const [result] = await connection.execute(
      `UPDATE bookings SET 
        payment_proof = ?,
        payment_filename = ?,
        payment_base64 = ?,
        payment_mimetype = ?,
        status = 'confirmed',
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
    
    console.log('✅ Payment base64 saved successfully');
    
    res.json({ 
      success: true, 
      message: 'Payment proof saved successfully',
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

// ✅ UPLOAD PAYMENT ENDPOINT - STANDALONE (MULTER)
app.post('/api/upload-payment', upload.single('payment_proof'), async (req, res) => {
  console.log('=== 🚀 UPLOAD PAYMENT (STANDALONE ENDPOINT) ===');
  
  if (!req.file || !req.body.booking_reference) {
    return res.status(400).json({ 
      success: false, 
      message: 'File and booking reference required' 
    });
  }

  let connection;
  try {
    // ✅ BASE64 ONLY - NO FILESYSTEM
    const base64Image = req.file.buffer.toString('base64');
    const fileName = `payment-${Date.now()}-${req.file.originalname}`;
    
    console.log('📤 Uploading for booking:', req.body.booking_reference);
    console.log('📊 File buffer size:', req.file.buffer.length);
    
    connection = await pool.promise().getConnection();

    // Update database
    const [result] = await connection.execute(
      `UPDATE bookings SET 
        payment_proof = ?, 
        payment_filename = ?, 
        payment_base64 = ?, 
        payment_mimetype = ?,
        status = 'confirmed',
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
    
    console.log('✅ Upload successful (Base64)');
    
    res.json({
      success: true,
      message: 'Payment proof uploaded successfully',
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

// ==================== ADMIN ENDPOINTS ====================

// ✅ ADMIN GET ALL BOOKINGS (Untuk Database Viewer)
app.get('/api/admin/all-bookings', async (req, res) => {
  try {
    console.log('=== 📋 ADMIN ALL BOOKINGS REQUEST ===');
    
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
      if (decoded.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin access required' });
      }
    } catch (jwtError) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

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
        is_verified,
        DATE_FORMAT(booking_date, '%Y-%m-%d %H:%i') as booking_date,
        DATE_FORMAT(verified_at, '%Y-%m-%d %H:%i') as verified_at
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

// ✅ ADMIN VIEW PAYMENT PROOF IMAGE (Untuk lihat bukti pembayaran)
app.get('/api/admin/payment-proof/:bookingReference', async (req, res) => {
  try {
    const { bookingReference } = req.params;
    console.log('=== 🖼️ ADMIN VIEW PAYMENT PROOF ===', bookingReference);
    
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
      if (decoded.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin access required' });
      }
    } catch (jwtError) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    const connection = await pool.promise().getConnection();
    const [bookings] = await connection.execute(
      `SELECT payment_base64, payment_filename, payment_mimetype 
       FROM bookings WHERE booking_reference = ?`,
      [bookingReference]
    );
    
    connection.release();

    if (bookings.length === 0) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const booking = bookings[0];
    
    if (booking.payment_base64) {
      // Return full base64 image
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

// ✅ ADMIN UPDATE BOOKING STATUS
app.put('/api/admin/bookings/:bookingReference/status', async (req, res) => {
  try {
    const { bookingReference } = req.params;
    const { status } = req.body;
    
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
      if (decoded.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin access required' });
      }
    } catch (jwtError) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    const connection = await pool.promise().getConnection();
    
    const [result] = await connection.execute(
      `UPDATE bookings SET 
        status = ?,
        is_verified = ?,
        verified_at = ?
       WHERE booking_reference = ?`,
      [
        status, 
        status === 'confirmed' ? 1 : 0,
        status === 'confirmed' ? new Date() : null,
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

// ✅ GET ALL BOOKINGS (Untuk regular bookings)
app.get('/api/bookings', async (req, res) => {
  try {
    console.log('=== 📋 ALL BOOKINGS REQUEST ===');
    
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
        // Optional: Check if admin for additional data
      } catch (jwtError) {
        console.log('⚠️ Invalid token, but proceeding with bookings');
      }
    }

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

// ✅ BUNDLE ORDERS ENDPOINT - SIMPLE
app.get('/api/bookings/bundle-orders', async (req, res) => {
  try {
    console.log('=== 📦 BUNDLE ORDERS REQUEST ===');
    
    // Return empty array since we don't have bundle orders table yet
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
    
    // Cari bookings berdasarkan username atau email
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
      return res.status(400).json({ success: false, message: 'Username and password required' });
    }

    const connection = await pool.promise().getConnection();
    const [users] = await connection.execute(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );
    connection.release();

    if (users.length === 0) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ success: false, message: 'Invalid password' });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
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
    res.status(500).json({ success: false, message: error.message });
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
  res.json({ message: 'Emergency Server Running!', status: 'OK' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚨 Emergency server running on port ${PORT}`);
});

export default app;