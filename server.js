console.log('=== 🚨 EMERGENCY DEBUG SERVER LOADED 🚨 ===');
console.log('=== Admin Verification System ACTIVE ===');

import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from './config/database.js';
import multer from 'multer';
import authRoutes from './routes/auth.js';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import cron from 'node-cron';



const app = express();

// ==================== MIDDLEWARE ====================
// ✅ FIX CORS (pastikan ini DIATAS semua route)
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'https://pleaseee-one.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors()); // handle preflight for all routes

// ✅ INCREASE PAYLOAD LIMIT
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/api/auth', authRoutes);

// ==================== SUPABASE CONFIG ====================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ✅ MULTER: gunakan memory storage (tidak menulis ke disk)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Hanya file gambar yang diizinkan'), false);
  }
});

// ==================== AUTH MIDDLEWARE ====================
const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, message: 'Access token required' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

const requireAdmin = (req, res, next) => {
  console.log('🔹 User role:', req.user?.role);
  if (req.user?.role !== 'admin') {
    console.log('❌ Forbidden: admin required');
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
};

cron.schedule('*/5 * * * *', async () => {
  console.log('⏳ Checking expired waiting_verification bookings...');
  await pool.promise().execute(`
    UPDATE bookings
    SET status = 'rejected'
    WHERE status = 'waiting_verification'
      AND TIMESTAMPDIFF(MINUTE, uploaded_at, NOW()) > 10
  `);
});




// ==================== BOOKING ENDPOINTS ====================
app.get('/api/bookings/occupied-seats', async (req, res) => {
  let connection;
  try {
    const { showtime_id, movie_title } = req.query;
    if (!showtime_id) return res.status(400).json({ success: false, message: 'Showtime ID is required' });

    connection = await pool.promise().getConnection();
    const [bookings] = await connection.execute(
      `SELECT seat_numbers FROM bookings WHERE showtime_id = ? AND movie_title = ? AND status IN ('confirmed','pending_verification')`,
      [showtime_id, movie_title]
    );
    connection.release();

    const occupiedSeats = new Set();
    bookings.forEach(booking => {
      try {
        let seats;
        if (typeof booking.seat_numbers === 'string') {
          try { seats = JSON.parse(booking.seat_numbers); }
          catch (e) { seats = booking.seat_numbers.split(',').map(s => s.trim()); }
        } else seats = booking.seat_numbers;
        if (Array.isArray(seats)) seats.forEach(s => s && occupiedSeats.add(s.trim()));
      } catch (err) { console.error('Error processing seat numbers:', err); }
    });

    res.json({ success: true, data: Array.from(occupiedSeats) });
  } catch (error) {
    console.error('❌ Error in occupied-seats:', error);
    res.status(500).json({ success: false, message: 'Server error: ' + error.message, data: [] });
  }
});

// ==================== CREATE BOOKING ====================
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

    // === VALIDASI FIELD WAJIB ===
    if (!showtime_id || !customer_name || !customer_email || !seat_numbers || !total_amount) {
      console.log('❌ Missing fields:', req.body);
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // === PASTIKAN TIPE DATA BENAR ===
    const showtimeIdNum = Number(showtime_id);
    const totalAmountNum = Number(total_amount);
    if (isNaN(showtimeIdNum) || isNaN(totalAmountNum)) {
      console.log('❌ Invalid numeric fields:', { showtime_id, total_amount });
      return res.status(400).json({ success: false, message: 'showtime_id and total_amount must be numbers' });
    }

    // === PASTIKAN SEAT NUMBERS ARRAY ===
    const seatsArray = Array.isArray(seat_numbers)
      ? seat_numbers
      : seat_numbers.split(',').map(s => s.trim());

    // === CONNECT DB ===
    connection = await pool.promise().getConnection();

    // === GENERATE REFERENCE & VERIFICATION CODE ===
    const booking_reference = 'BK' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
    const verification_code = Math.floor(100000 + Math.random() * 900000).toString();

    // === LOG DATA SEBELUM INSERT ===
    console.log('📝 Inserting booking:', {
      showtimeIdNum,
      customer_name,
      customer_email,
      customer_phone,
      seatsArray,
      totalAmountNum,
      movie_title,
      booking_reference
    });

    // === QUERY INSERT ===
    const query = `
      INSERT INTO bookings 
      (showtime_id, customer_name, customer_email, customer_phone, seat_numbers, total_amount, movie_title, booking_reference, verification_code, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `;
    const [result] = await connection.execute(query, [
      showtimeIdNum,
      customer_name,
      customer_email,
      customer_phone || null,
      JSON.stringify(seatsArray),
      totalAmountNum,
      movie_title || null,
      booking_reference,
      verification_code
    ]);

    // === LOG RESULT INSERT ===
    console.log('✅ Insert result:', result);

    const bookingId = result.insertId;
    const [newBookings] = await connection.execute('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    connection.release();

    const newBooking = newBookings[0];
    let parsedSeatNumbers;
    try { parsedSeatNumbers = JSON.parse(newBooking.seat_numbers); } 
    catch (e) { parsedSeatNumbers = [newBooking.seat_numbers]; }

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
    if (connection) connection.release();
    res.status(500).json({ success: false, message: 'Failed to create booking: ' + error.message });
  }
});
// ==================== PAYMENT & VERIFICATION ENDPOINTS ====================
app.post('/api/bookings/confirm-payment', async (req, res) => {
  let connection;
  try {
    const { booking_reference } = req.body;
    if (!booking_reference) return res.status(400).json({ success: false, message: 'Booking reference is required' });
    connection = await pool.promise().getConnection();
    const [result] = await connection.execute('UPDATE bookings SET status = "pending_verification", payment_date = NOW() WHERE booking_reference = ?', [booking_reference]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Booking not found' });
    const [bookings] = await connection.execute('SELECT * FROM bookings WHERE booking_reference = ?', [booking_reference]);
    const updatedBooking = bookings[0];
    let seatNumbers;
    try { seatNumbers = JSON.parse(updatedBooking.seat_numbers); } catch (err) { seatNumbers = typeof updatedBooking.seat_numbers === 'string' ? updatedBooking.seat_numbers.split(',').map(s => s.trim()) : [updatedBooking.seat_numbers]; }
    res.json({ success: true, message: 'Payment proof uploaded! Waiting for admin verification.', data: { ...updatedBooking, seat_numbers: seatNumbers } });
  } catch (error) {
    console.error('❌ Payment confirmation error:', error);
    res.status(500).json({ success: false, message: 'Payment confirmation failed: ' + error.message });
  }
});

// UPDATE PAYMENT BASE64 (kept)
app.post('/api/update-payment-base64', async (req, res) => {
  try {
    const { booking_reference, payment_filename, payment_base64, payment_mimetype } = req.body;
    if (!booking_reference || !payment_base64) return res.status(400).json({ success: false, message: 'Booking reference and payment data required' });
    const connection = await pool.promise().getConnection();
    const [result] = await connection.execute(`UPDATE bookings SET payment_proof = ?, payment_filename = ?, payment_base64 = ?, payment_mimetype = ?, status = 'pending_verification', payment_date = NOW() WHERE booking_reference = ?`, [payment_filename, payment_filename, payment_base64, payment_mimetype, booking_reference]);
    connection.release();
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Booking not found' });
    res.json({ success: true, message: 'Payment proof uploaded! Waiting for admin verification.', fileName: payment_filename });
  } catch (error) {
    console.error('❌ Update payment error:', error);
    res.status(500).json({ success: false, message: 'Upload failed: ' + error.message });
  }
});



// ==================== SUPABASE UPLOAD ROUTE (replaces local disk storage) ====================
app.options('/api/upload-payment', cors());
app.post('/api/upload-payment', upload.single('payment_proof'), async (req, res) => {
  console.log('=== 🚀 UPLOAD PAYMENT VIA SUPABASE ===');
  if (!req.file || !req.body.booking_reference) {
    return res.status(400).json({ success: false, message: 'File dan booking reference diperlukan' });
  }

  const bookingRef = req.body.booking_reference;
  const fileExt = path.extname(req.file.originalname) || '.jpg';
  const fileName = `${Date.now()}_${Math.random().toString(36).substr(2,8)}${fileExt}`;
  const filePath = `${bookingRef}/${fileName}`;

  try {
    const { data, error } = await supabase.storage
      .from(process.env.SUPABASE_BUCKET)
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        cacheControl: '3600',
        upsert: true,
      });

    if (error) throw error;

    const { data: publicURLData } = supabase.storage.from(process.env.SUPABASE_BUCKET).getPublicUrl(filePath);
    const publicURL = publicURLData.publicUrl;

    const [result] = await pool.promise().execute(
      `UPDATE bookings SET payment_proof = ?, payment_filename = ?, payment_path = ?, status = 'pending_verification', payment_date = NOW() WHERE booking_reference = ?`,
      [publicURL, req.file.originalname, filePath, bookingRef]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Booking tidak ditemukan' });
    }

    res.status(200).json({ success: true, message: 'Bukti pembayaran berhasil diupload ke Supabase!', data: { fileURL: publicURL, fileName: req.file.originalname } });
  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({ success: false, message: 'Upload gagal: ' + error.message });
  }
});

// 2️⃣ GET PENDING VERIFICATIONS
app.get('/api/admin/pending-verifications', authenticateToken, requireAdmin, async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    const [bookings] = await connection.execute(`
      SELECT 
        id, showtime_id, booking_reference, verification_code,
        customer_name, customer_email, customer_phone,
        movie_title, total_amount, seat_numbers, status,
        payment_proof, payment_filename, payment_base64 IS NOT NULL as has_payment_image,
        created_at, verified_at, verified_by, admin_notes
      FROM bookings
      WHERE status = 'pending_verification'
      ORDER BY created_at ASC
    `);
    connection.release();

    const formattedBookings = bookings.map(b => {
      let seats;
      try { seats = JSON.parse(b.seat_numbers); if (!Array.isArray(seats)) seats = [seats]; }
      catch { seats = typeof b.seat_numbers === 'string' ? b.seat_numbers.split(',').map(s => s.trim()) : [b.seat_numbers]; }
      return { ...b, seat_numbers: seats, total_amount: Number(b.total_amount) || 0 };
    });

    res.json({ success: true, data: formattedBookings });
  } catch (error) {
    console.error('❌ Pending verifications error:', error);
    if (connection) connection.release();
    res.status(500).json({ success: false, message: 'Failed to fetch pending verifications: ' + error.message });
  }
});


// 3️⃣ VERIFY PAYMENT
app.post('/api/admin/verify-payment', authenticateToken, requireAdmin, async (req, res) => {
  const { booking_reference, action, admin_notes } = req.body;
  if (!booking_reference || !action) return res.status(400).json({ success: false, message: 'Booking reference and action required' });
  if (!['approve','reject'].includes(action)) return res.status(400).json({ success: false, message: "Invalid action. Use 'approve' or 'reject'" });

  let connection;
  try {
    connection = await pool.promise().getConnection();
    const newStatus = action === 'approve' ? 'confirmed' : 'payment_rejected';
    const verifiedBy = req.user.username || 'admin';

    const [result] = await connection.execute(`
      UPDATE bookings 
      SET status = ?, verified_at = NOW(), verified_by = ?, admin_notes = ?
      WHERE booking_reference = ?
    `, [newStatus, verifiedBy, admin_notes || '', booking_reference]);

    if (result.affectedRows === 0) { connection.release(); return res.status(404).json({ success: false, message: 'Booking not found' }); }

    const [updatedBookings] = await connection.execute('SELECT * FROM bookings WHERE booking_reference = ?', [booking_reference]);
    connection.release();

    res.json({ success: true, message: `Payment ${action === 'approve' ? 'approved' : 'rejected'} successfully`, data: updatedBookings[0] });
  } catch (error) {
    console.error('❌ Verify payment error:', error);
    if (connection) connection.release();
    res.status(500).json({ success: false, message: 'Verification failed: ' + error.message });
  }
});

app.get('/api/admin/all-orders', authenticateToken, requireAdmin, async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();

    // Ambil semua bookings reguler
    const [bookings] = await connection.execute(`
      SELECT 
        'regular' AS order_type,
        id,
        booking_reference AS reference,
        customer_name,
        customer_email,
        customer_phone,
        movie_title AS item_name,
        total_amount,
        seat_numbers,
        status,
        payment_proof,
        payment_filename,
        payment_base64 IS NOT NULL AS has_payment_image,
        booking_date AS date
      FROM bookings
      ORDER BY booking_date DESC
    `);

    // Ambil semua bundle orders
    const [bundles] = await connection.execute(`
      SELECT
        'bundle' AS order_type,
        id,
        order_reference AS reference,
        customer_name,
        NULL AS customer_email,
        NULL AS customer_phone,
        bundle_name AS item_name,
        quantity AS total_amount,
        NULL AS seat_numbers,
        status,
        payment_proof,
        NULL AS payment_filename,
        NULL AS has_payment_image,
        created_at AS date
      FROM bundle_orders
      ORDER BY created_at DESC
    `);

    connection.release();

    // Gabungkan dan urutkan berdasarkan tanggal terbaru
    const allOrders = [...bookings, ...bundles].sort(
      (a, b) => new Date(b.date) - new Date(a.date)
    );

    res.json({ success: true, data: allOrders });
  } catch (err) {
    if (connection) connection.release();
    console.error('❌ Fetch all orders error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// di backend Node.js
app.post("/api/bundle/upload-payment", async (req, res) => {
  const { order_reference, paymentProofUrl } = req.body;

  try {
    const connection = await pool.promise().getConnection();
    await connection.execute(
      "UPDATE bundle_orders SET payment_proof = ? WHERE order_reference = ?",
      [paymentProofUrl, order_reference]
    );
    connection.release();

    res.json({ success: true, message: "Bukti pembayaran berhasil diupload" });
  } catch (err) {
    console.error("❌ Upload payment error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/admin/all-bookings', authenticateToken, requireAdmin, async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();

    // Ambil semua bookings reguler
    const [bookings] = await connection.execute(`
      SELECT 
        id, booking_reference, customer_name, customer_email,customer_phone,
        movie_title, total_amount, seat_numbers, status, payment_filename, payment_base64,
        DATE_FORMAT(booking_date, '%Y-%m-%d %H:%i') AS booking_date
      FROM bookings
      ORDER BY booking_date DESC
    `);

    // Ambil semua bundle orders
    const [bundles] = await connection.execute(`
      SELECT * FROM bundle_orders ORDER BY id DESC
    `);

    connection.release();

    // Format bookings reguler
    const formattedBookings = bookings.map(b => {
      let seats;
      try { 
        seats = JSON.parse(b.seat_numbers); 
        if (!Array.isArray(seats)) seats = [seats]; 
      } catch { 
        seats = typeof b.seat_numbers === 'string' ? b.seat_numbers.split(',').map(s => s.trim()) : [b.seat_numbers]; 
      }

      // Buat payment_url berdasarkan payment_base64 atau payment_filename
      let paymentUrl = null;
      if (b.payment_base64) {
        paymentUrl = `data:image/jpeg;base64,${b.payment_base64}`;
      } else if (b.payment_filename) {
        paymentUrl = `https://server.com/uploads/${b.payment_filename}`;
      }

      return { 
        ...b, 
        seat_numbers: seats, 
        total_amount: Number(b.total_amount) || 0,
        has_payment_image: !!paymentUrl,
        payment_url: paymentUrl
      };
    });

    // Format bundles
    const formattedBundles = bundles.map(b => {
      let paymentUrl = b.payment_proof || null; // bundle tetap pakai payment_proof
      return {
        ...b,
        total_amount: Number(b.total_amount || b.quantity) || 0,
        seat_numbers: [], // bundle tidak punya seat
        has_payment_image: !!paymentUrl,
        payment_url: paymentUrl,
        booking_date: b.created_at
      };
    });

    res.json({ 
      success: true, 
      data: { bookings: formattedBookings, bundleOrders: formattedBundles } 
    });

  } catch (err) {
    if (connection) connection.release();
    console.error('❌ /admin/all-bookings error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});








// 4️⃣ UPDATE STATUS MANUAL
app.put('/api/admin/bookings/:bookingReference/status', authenticateToken, requireAdmin, async (req, res) => {
  const { bookingReference } = req.params;
  const { status } = req.body;
  if (!status) return res.status(400).json({ success: false, message: 'Status required' });

  let connection;
  try {
    connection = await pool.promise().getConnection();
    const verifiedAt = status === 'confirmed' ? new Date() : null;
    const verifiedBy = status === 'confirmed' ? req.user.username : null;

    const [result] = await connection.execute(`
      UPDATE bookings 
      SET status = ?, verified_at = ?, verified_by = ?
      WHERE booking_reference = ?
    `, [status, verifiedAt, verifiedBy, bookingReference]);

    connection.release();
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Booking not found' });

    res.json({ success: true, message: `Booking status updated to ${status}`, data: { booking_reference: bookingReference, status } });
  } catch (error) {
    console.error('❌ Update status error:', error);
    if (connection) connection.release();
    res.status(500).json({ success: false, message: 'Failed to update status: ' + error.message });
  }
});

app.get('/api/bookings', async (req, res) => {
  try {
    const connection = await pool.promise().getConnection();
    const [bookings] = await connection.execute(`SELECT id, booking_reference, customer_name, customer_email, movie_title, total_amount, seat_numbers, status, payment_proof, payment_filename, payment_base64 IS NOT NULL as has_payment_image, DATE_FORMAT(booking_date, '%Y-%m-%d %H:%i') as booking_date FROM bookings WHERE status != 'cancelled' ORDER BY booking_date DESC`);
    connection.release();
    res.json({ success: true, data: bookings });
  } catch (error) {
    console.error('❌ All bookings error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch bookings: ' + error.message });
  }
});

app.get('/api/bookings/bundle-orders', async (req, res) => {
  try { res.json({ success: true, data: [], message: 'Bundle orders feature coming soon' }); } catch (error) { console.error('❌ Bundle orders error:', error); res.status(500).json({ success: false, message: 'Failed to fetch bundle orders: ' + error.message }); }
});

app.get('/api/bookings/my-bookings', async (req, res) => {
  try {
    const { username, email } = req.query;
    if (!username && !email) return res.status(400).json({ success: false, message: 'Username or email required' });
    const connection = await pool.promise().getConnection();
    let query = `SELECT id, booking_reference, customer_name, customer_email, movie_title, total_amount, seat_numbers, status, payment_proof, payment_filename, payment_base64 IS NOT NULL as has_payment_image, booking_date FROM bookings WHERE status != 'cancelled'`;
    const params = [];
    if (username) { query += ' AND customer_name = ?'; params.push(username); }
    if (email) { query += ' AND customer_email = ?'; params.push(email); }
    query += ' ORDER BY booking_date DESC';
    const [bookings] = await connection.execute(query, params);
    connection.release();
    res.json({ success: true, data: bookings });
  } catch (error) { console.error('❌ My bookings error:', error); res.status(500).json({ success: false, message: 'Failed to fetch bookings: ' + error.message }); }
});

// Ambil semua tiket user (bookings + bundle orders)
app.get('/api/bookings/my-tickets', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ success: false, message: 'Username required' });

    const connection = await pool.promise().getConnection();

    // Ambil bookings reguler
    const [bookings] = await connection.execute(
      `SELECT id, booking_reference, customer_name, customer_email, movie_title, total_amount, seat_numbers, status, payment_proof, payment_filename, payment_base64 IS NOT NULL as has_payment_image, DATE_FORMAT(booking_date, '%Y-%m-%d %H:%i') as booking_date
       FROM bookings
       WHERE customer_name = ? AND status != 'cancelled'
       ORDER BY booking_date DESC`,
      [username]
    );

    const [bundles] = await connection.execute(
  `SELECT 
     id, order_reference, bundle_name, quantity, total_price AS total_amount,
     customer_name, status, payment_proof,
     created_at AS booking_date
   FROM bundle_orders
   WHERE customer_name = ?
   ORDER BY created_at DESC`,
  [username]
);

    connection.release();

    res.json({ success: true, data: { bookings, bundleOrders: bundles } });
  } catch (err) {
    console.error('❌ My tickets error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});


// ==================== AUTH (kept) ====================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required' });
    const connection = await pool.promise().getConnection();
    const [users] = await connection.execute('SELECT * FROM users WHERE username = ?', [username]);
    connection.release();
    if (users.length === 0) return res.status(401).json({ success: false, message: 'User not found' });
    const user = users[0]; const validPassword = await bcrypt.compare(password, user.password); if (!validPassword) return res.status(401).json({ success: false, message: 'Invalid password' });
    const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET || 'fallback-secret', { expiresIn: '24h' });
    res.json({ success: true, message: 'Login successful', data: { user: { id: user.id, username: user.username, email: user.email, role: user.role }, token } });
  } catch (error) { console.error('Login error:', error); res.status(500).json({ success: false, message: error.message }); }
});

app.post('/api/auth/create-admin', async (req, res) => {
  try {
    const { username, password, email } = req.body; if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required' });
    const connection = await pool.promise().getConnection();
    const [existing] = await connection.execute('SELECT * FROM users WHERE username = ? OR role = "admin"', [username]);
    if (existing.length > 0) { connection.release(); return res.status(400).json({ success: false, message: 'Admin user already exists' }); }
    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await connection.execute('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, "admin")', [username, email || `${username}@admin.com`, hashedPassword]);
    connection.release();
    res.json({ success: true, message: 'Admin user created successfully', data: { id: result.insertId, username, role: 'admin' } });
  } catch (error) { console.error('Create admin error:', error); res.status(500).json({ success: false, message: error.message }); }
});

app.post("/api/bundle/create-order", async (req, res) => {
  const {
    bundle_id,
    bundle_name,
    bundle_description,
    bundle_price,
    original_price,
    savings,
    quantity,
    total_price,
    customer_name,
    customer_phone,
    customer_address,
    status = "pending",
  } = req.body;

  console.log("📦 Incoming bundle order:", req.body);

  if (!bundle_id || !bundle_name || !customer_name) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  try {
    const connection = await pool.promise().getConnection();
    console.log("✅ DB connected for bundle order");

    const order_reference = `BUNDLE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const [result] = await connection.execute(
      `INSERT INTO bundle_orders 
      (order_reference, bundle_id, bundle_name, bundle_description, bundle_price, original_price, savings, quantity, total_price, customer_name, customer_phone, customer_address, status, order_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())`,
      [
        order_reference,
        bundle_id,
        bundle_name,
        bundle_description,
        bundle_price,
        original_price,
        savings,
        quantity,
        total_price,
        customer_name,
        customer_phone,
        customer_address,
        status,
      ]
    );

    connection.release();

    console.log("🎉 Bundle order created:", { order_reference });

    res.status(201).json({
      success: true,
      message: "Bundle order created successfully",
      data: { id: result.insertId, order_reference, status },
    });
  } catch (error) {
    console.error("❌ Error creating bundle order:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ✅ Update Payment Proof untuk bundle order
app.post("/api/bundle/update-payment-proof", async (req, res) => {
  try {
    const { order_reference, payment_proof_url } = req.body;

    if (!order_reference || !payment_proof_url) {
      return res.status(400).json({
        success: false,
        message: "Order reference dan payment proof URL diperlukan.",
      });
    }

    const connection = await pool.promise().getConnection();

    const [result] = await connection.execute(
      `UPDATE bundle_orders 
       SET payment_proof = ?, status = 'waiting_verification', updated_at = NOW() 
       WHERE order_reference = ?`,
      [payment_proof_url, order_reference]
    );

    connection.release();

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Order tidak ditemukan.",
      });
    }

    res.json({
      success: true,
      message: "Bukti pembayaran berhasil diunggah dan menunggu verifikasi admin.",
    });
  } catch (err) {
    console.error("❌ Error update payment proof:", err);
    res.status(500).json({
      success: false,
      message: "Gagal update payment proof: " + err.message,
    });
  }
});

app.get('/api/admin/bundle-orders', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const connection = await pool.promise().getConnection();
    const [orders] = await connection.execute('SELECT * FROM bundle_orders ORDER BY id DESC');
    connection.release();
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== UPDATE STATUS BUNDLE ====================
app.put('/api/admin/bundle-orders/:orderReference/status', authenticateToken, requireAdmin, async (req, res) => {
  const { orderReference } = req.params;
  const { status } = req.body;

  if (!status) return res.status(400).json({ success: false, message: 'Status required' });

  let connection;
  try {
    connection = await pool.promise().getConnection();

    const allowedStatus = ['pending', 'confirmed', 'payment_rejected'];
    if (!allowedStatus.includes(status)) {
      connection.release();
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const [result] = await connection.execute(
      'UPDATE bundle_orders SET status = ? WHERE order_reference = ?',
      [status, orderReference]
    );

    connection.release();

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Bundle order not found' });
    }

    res.json({ success: true, message: `Bundle order status updated to ${status}` });
  } catch (err) {
    if (connection) connection.release();
    console.error('❌ Update bundle order status error:', err);
    res.status(500).json({ success: false, message: 'Failed to update status: ' + err.message });
  }
});


// ==================== BASIC ROUTES ====================
app.get('/api/test', (req, res) => res.json({ success: true, message: 'Server is working!', timestamp: new Date().toISOString() }));
app.get('/', (req, res) => res.json({ message: 'Admin Verification Server Running!', status: 'OK', features: ['Payment Verification System', 'Admin Dashboard', 'Supabase Storage'] }));
app.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString(), verification_system: 'ACTIVE' }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚨 Admin Verification Server running on port ${PORT}`);
  console.log(`✅ Payment Verification System: ACTIVE`);
  console.log(`✅ Admin Endpoints: ENABLED`);
  console.log(`✅ Supabase Storage: ACTIVE`);
});

export default app;
