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
    const { showtime_id, customer_email, seat_numbers, total_amount, movie_title } = req.body;

    if (!customer_email || !movie_title || !total_amount) {
      return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
    }

    connection = await pool.promise().getConnection();

    // Ambil info user dari email login
    const [users] = await connection.execute(
  'SELECT username, phone FROM users WHERE username = ?',
  [username]
    );
    if (users.length === 0) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    
    const user = users[0];

    const seatNumbersJson = JSON.stringify(seat_numbers || []);

    const [result] = await connection.execute(
      `INSERT INTO bookings 
      (showtime_id, customer_name, customer_email, customer_phone, seat_numbers, total_amount, movie_title, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [showtime_id, user.username, customer_email, user.phone, seatNumbersJson, total_amount, movie_title]
    );

    res.json({
      success: true,
      message: 'Booking berhasil dibuat',
      data: {
        id: result.insertId,
        customer_name: user.username,
        customer_email,
        customer_phone: user.phone,
        movie_title,
        seat_numbers,
        total_amount,
        status: 'pending'
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    if (connection) connection.release();
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
    const bucketName = 'bukti_pembayaran';
    const { data, error } = await supabase.storage
  .from(bucketName)
  .upload(filePath, req.file.buffer, {
    cacheControl: '3600',
    contentType: req.file.mimetype,
    upsert: true
  });

if (error) throw error;

    const { data: publicURLData } = supabase.storage
  .from(bucketName)
  .getPublicUrl(filePath);
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


app.get("/api/admin/all-bookings", authenticateToken, requireAdmin, async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();

    // ------------------------------
    // 1️⃣ Ambil semua bookings reguler + nomor HP dari users
    // ------------------------------
    const [bookings] = await connection.execute(`
      SELECT 
        b.id, b.booking_reference, b.customer_name, b.customer_email,
        u.phone AS user_phone,
        b.movie_title, b.total_amount, b.seat_numbers, 
        b.status, b.payment_filename, b.payment_base64,
        DATE_FORMAT(b.booking_date, '%Y-%m-%d %H:%i') AS booking_date
      FROM bookings b
      LEFT JOIN users u 
        ON LOWER(TRIM(b.customer_name)) = LOWER(TRIM(u.username))
      ORDER BY b.booking_date DESC
    `);

    // ------------------------------
    // 2️⃣ Ambil semua bundle orders + nomor HP dari users
    // ------------------------------
    const [bundles] = await connection.execute(`
      SELECT 
        bo.id,
        bo.order_reference,
        bo.bundle_name,
        bo.quantity,
        bo.total_price,
        bo.customer_name,
        bo.customer_email,
        bo.status,
        bo.created_at,
        u.phone AS user_phone,
        bo.payment_proof
      FROM bundle_orders bo
      LEFT JOIN users u 
        ON LOWER(TRIM(bo.customer_name)) = LOWER(TRIM(u.username))
      ORDER BY bo.id DESC
    `);

    connection.release();

    // ------------------------------
    // 3️⃣ Format bookings reguler
    // ------------------------------
    const formattedBookings = bookings.map((b) => {
      let seats;
      try {
        seats = JSON.parse(b.seat_numbers);
        if (!Array.isArray(seats)) seats = [seats];
      } catch {
        seats =
          typeof b.seat_numbers === "string"
            ? b.seat_numbers.split(",").map((s) => s.trim())
            : [b.seat_numbers];
      }

      let paymentUrl =
        b.payment_proof ||
        (b.payment_base64 ? `data:image/jpeg;base64,${b.payment_base64}` : null);

      return {
        ...b,
        seat_numbers: seats,
        total_amount: Number(b.total_amount) || 0,
        has_payment_image: !!paymentUrl,
        payment_url: paymentUrl,
        phone: b.user_phone || "-"
      };
    });

    // ------------------------------
    // 4️⃣ Format bundle orders
    // ------------------------------
    const formattedBundles = bundles.map((b) => {
      return {
        ...b,
        total_amount: Number(b.total_price) || 0,
        seat_numbers: [],
        has_payment_image: !!b.payment_proof,
        payment_url: b.payment_proof || null,
        phone: b.user_phone || "-",
        booking_date: b.created_at,
      };
    });

    // ------------------------------
    // 5️⃣ Kirim response
    // ------------------------------
    res.json({
      success: true,
      data: { bookings: formattedBookings, bundleOrders: formattedBundles },
    });
  } catch (err) {
    if (connection) connection.release();
    console.error("❌ /admin/all-bookings error:", err);
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
  let connection;
  try {
    const username = req.query.username;
    if (!username) return res.status(400).json({ success: false, message: 'Username wajib diisi' });

    connection = await pool.promise().getConnection();

    const [bookings] = await connection.execute(`
      SELECT b.*, u.phone AS customer_phone
      FROM bookings b
      LEFT JOIN users u ON b.customer_name = u.username
      WHERE LOWER(u.username) = LOWER(?)
      ORDER BY b.booking_date DESC
    `, [username]);

    res.json({ success: true, data: bookings });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    if (connection) connection.release();
  }
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

// ==================== DATABASE MANAGEMENT ENDPOINTS ====================
// GET ALL USERS (Admin only) - SESUAI STRUCTURE
app.get('/api/users', authenticateToken, requireAdmin, async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    const [users] = await connection.execute(`
      SELECT 
        id, 
        username, 
        email, 
        password,  
        role, 
        phone, 
        created_at, 
        updated_at
      FROM users 
      ORDER BY created_at DESC
    `);
    connection.release();
    
    // Hapus password dari response untuk security
    const safeUsers = users.map(user => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });
    
    res.json({ 
      success: true, 
      data: safeUsers,
      message: `Found ${safeUsers.length} users`
    });
  } catch (error) {
    console.error('❌ Users endpoint error:', error);
    if (connection) connection.release();
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch users: ' + error.message 
    });
  }
});

// GET ALL THEATERS
app.get('/api/theaters', async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    const [theaters] = await connection.execute(`
      SELECT 
        id,
        theater_name,
        location,
        capacity,
        screen_type,
        created_at
      FROM theaters 
      ORDER BY theater_name
    `);
    connection.release();
    
    res.json({ 
      success: true, 
      data: theaters 
    });
  } catch (error) {
    console.error('❌ Theaters endpoint error:', error);
    if (connection) connection.release();
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch theaters: ' + error.message 
    });
  }
});

// GET ALL MOVIES
app.get('/api/movies', async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    const [movies] = await connection.execute(`
      SELECT 
        id,
        title,
        genre,
        duration,
        rating,
        description,
        poster_url,
        trailer_url,
        release_date,
        created_at
      FROM movies 
      ORDER BY title
    `);
    connection.release();
    
    res.json({ 
      success: true, 
      data: movies 
    });
  } catch (error) {
    console.error('❌ Movies endpoint error:', error);
    if (connection) connection.release();
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch movies: ' + error.message 
    });
  }
});


// GET ALL SHOWTIMES WITH DETAILS
app.get('/api/showtimes', async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    const [showtimes] = await connection.execute(`
      SELECT 
        s.id,
        s.movie_id,
        s.theater_id,
        s.showtime,
        s.price,
        s.available_seats,
        s.created_at,
        m.title as movie_title,
        t.theater_name,
        t.location as theater_location
      FROM showtimes s 
      LEFT JOIN movies m ON s.movie_id = m.id 
      LEFT JOIN theaters t ON s.theater_id = t.id 
      ORDER BY s.showtime DESC
    `);
    connection.release();
    
    res.json({ 
      success: true, 
      data: showtimes 
    });
  } catch (error) {
    console.error('❌ Showtimes endpoint error:', error);
    if (connection) connection.release();
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch showtimes: ' + error.message 
    });
  }
});

// GET ALL BUNDLE ORDERS (Admin only) - SESUAI STRUCTURE BARU
app.get('/api/admin/bundle-orders', authenticateToken, requireAdmin, async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    const [orders] = await connection.execute(`
      SELECT 
        id,
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
        customer_email,  
        payment_proof,
        status,
        order_date,
        created_at,
        updated_at
      FROM bundle_orders 
      ORDER BY created_at DESC
    `);
    connection.release();
    
    res.json({ 
      success: true, 
      data: orders,
      message: `Found ${orders.length} bundle orders`
    });
  } catch (error) {
    console.error('❌ Bundle orders endpoint error:', error);
    if (connection) connection.release();
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch bundle orders: ' + error.message 
    });
  }
});
// GET DASHBOARD STATISTICS
app.get('/api/admin/dashboard-stats', authenticateToken, requireAdmin, async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    
    // Hitung total bookings
    const [bookingCount] = await connection.execute('SELECT COUNT(*) as count FROM bookings');
    
    // Hitung total users
    const [userCount] = await connection.execute('SELECT COUNT(*) as count FROM users');
    
    // Hitung total theaters
    const [theaterCount] = await connection.execute('SELECT COUNT(*) as count FROM theaters');
    
    // Hitung total movies
    const [movieCount] = await connection.execute('SELECT COUNT(*) as count FROM movies');
    
    // Hitung total bundle orders
    const [bundleCount] = await connection.execute('SELECT COUNT(*) as count FROM bundle_orders');
    
    // Hitung pendapatan hari ini
    const [todayRevenue] = await connection.execute(`
      SELECT SUM(total_amount) as revenue 
      FROM bookings 
      WHERE DATE(booking_date) = CURDATE() AND status = 'confirmed'
      UNION ALL
      SELECT SUM(total_price) as revenue 
      FROM bundle_orders 
      WHERE DATE(created_at) = CURDATE() AND status = 'confirmed'
    `);
    
    connection.release();
    
    const stats = {
      totalBookings: bookingCount[0].count,
      totalUsers: userCount[0].count,
      totalTheaters: theaterCount[0].count,
      totalMovies: movieCount[0].count,
      totalBundleOrders: bundleCount[0].count,
      todayRevenue: todayRevenue[0]?.revenue || 0
    };
    
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('❌ Dashboard stats error:', error);
    if (connection) connection.release();
    res.status(500).json({ success: false, message: error.message });
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
