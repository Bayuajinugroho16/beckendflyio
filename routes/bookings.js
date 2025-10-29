import express from 'express';
import multer from 'multer';
import serverless from 'serverless-http';
import path from 'path';
import { pool } from '../config/database.js';

app.use('/api/bookings', bookingsRoutes);

const router = express.Router();

// ✅ MULTER CONFIGURATION FOR MEMORY STORAGE (VERCEL COMPATIBLE)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// ✅ GET ALL BOOKINGS (UNTUK ADMIN)
router.get('/', async (req, res) => {
  let connection;
  try {
    console.log('📖 Fetching all bookings for admin');
    
    connection = await pool.promise().getConnection();
    
    const [bookings] = await connection.execute(`
      SELECT 
        id, booking_reference, customer_name, customer_email,
        customer_phone, movie_title, showtime_id, seat_numbers,
        total_amount, status, booking_date, is_verified,
        payment_proof, payment_filename, payment_base64,
        verified_at, verified_by, admin_notes
      FROM bookings 
      ORDER BY booking_date DESC
    `);
    
    console.log(`✅ Found ${bookings.length} bookings`);
    
    // Process seat_numbers dari JSON string ke array
    const processedBookings = bookings.map(booking => {
      let seatNumbers = [];
      try {
        if (booking.seat_numbers) {
          if (typeof booking.seat_numbers === 'string') {
            seatNumbers = JSON.parse(booking.seat_numbers);
          } else if (Array.isArray(booking.seat_numbers)) {
            seatNumbers = booking.seat_numbers;
          }
        }
      } catch (error) {
        console.log('Error parsing seat numbers:', error);
        seatNumbers = [];
      }
      
      return {
        ...booking,
        seat_numbers: seatNumbers,
        has_payment: !!(booking.payment_proof || booking.payment_base64)
      };
    });
    
    res.json({
      success: true,
      count: processedBookings.length,
      data: processedBookings
    });
    
  } catch (error) {
    console.error('❌ Error fetching bookings:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching bookings: ' + error.message
    });
  } finally {
    if (connection) connection.release();
  }
});


// ===== UPDATE STATUS BUNDLE ORDER (CONFIRM / REJECT) =====
router.put('/bundle-orders/:order_reference/status', async (req, res) => {
  const { order_reference } = req.params;
  const { action, verified_by } = req.body; // action: 'confirm' | 'reject'

  if (!['confirm', 'reject'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Invalid action' });
  }

  const newStatus = action === 'confirm' ? 'confirmed' : 'rejected';

  let connection;
  try {
    connection = await pool.promise().getConnection();

    const [orders] = await connection.execute(
      'SELECT * FROM bundle_orders WHERE order_reference = ?',
      [order_reference]
    );

    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    await connection.execute(
      'UPDATE bundle_orders SET status = ?, verified_by = ?, updated_at = NOW() WHERE order_reference = ?',
      [newStatus, verified_by || 'admin', order_reference]
    );

    res.json({
      success: true,
      message: `Bundle order ${order_reference} berhasil di-${newStatus}.`,
      status: newStatus
    });

  } catch (err) {
    console.error('❌ Error updating bundle status:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) connection.release();
  }
});
// ✅ OCCUPIED SEATS ENDPOINT (HANYA CONFIRMED)
router.get('/occupied-seats', async (req, res) => {
  let connection;
  try {
    const { showtime_id, movie_title } = req.query;

    console.log('🎯 Fetching occupied seats for showtime:', showtime_id, 'and movie:', movie_title);

    if (!showtime_id || !movie_title) {
      return res.status(400).json({
        success: false,
        message: 'Showtime ID dan Movie Title wajib diisi'
      });
    }

    connection = await pool.promise().getConnection();

    // 🎯 Hanya ambil kursi yang sudah dikonfirmasi admin
    const [bookings] = await connection.execute(
      `
      SELECT seat_numbers 
      FROM bookings 
      WHERE showtime_id = ? 
        AND movie_title = ? 
        AND status = 'confirmed'
      `,
      [showtime_id, movie_title]
    );

    const occupiedSeats = new Set();

    bookings.forEach(booking => {
      try {
        let seats = booking.seat_numbers;
        if (typeof seats === 'string') {
          try {
            seats = JSON.parse(seats);
          } catch {
            seats = seats.split(',').map(s => s.trim().replace(/[\[\]"]/g, ''));
          }
        }

        if (Array.isArray(seats)) {
          seats.forEach(seat => seat && occupiedSeats.add(seat));
        }
      } catch (err) {
        console.error('❌ Error parsing seats:', err);
      }
    });

    res.json({
      success: true,
      data: Array.from(occupiedSeats)
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


router.post('/', async (req, res) => {
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

    // Validasi minimal
    if (!customer_name || !customer_email || !movie_title || !total_amount) {
      return res.status(400).json({
        success: false,
        message: 'customer_name, customer_email, movie_title, dan total_amount wajib diisi'
      });
    }

    // Seat numbers: pastikan array JSON
    let seatsToSave = [];
    if (seat_numbers && Array.isArray(seat_numbers)) {
      seatsToSave = seat_numbers.filter(s => s && s.trim() !== '');
    }
    const seatNumbersJson = JSON.stringify(seatsToSave);

    connection = await pool.promise().getConnection();

    // Insert booking
    const [result] = await connection.execute(
      `INSERT INTO bookings 
      (showtime_id, customer_name, customer_email, customer_phone, seat_numbers, total_amount, movie_title, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        showtime_id || null,
        customer_name,
        customer_email,
        customer_phone || null,
        seatNumbersJson,
        total_amount,
        movie_title
      ]
    );

    const bookingId = result.insertId;

    // Ambil booking baru
    const [rows] = await connection.execute(
      'SELECT * FROM bookings WHERE id = ?',
      [bookingId]
    );

    const booking = rows[0];

    // Parse seat_numbers untuk response
    let parsedSeats = [];
    try {
      parsedSeats = JSON.parse(booking.seat_numbers);
    } catch (e) {
      parsedSeats = [];
    }

    res.status(201).json({
      success: true,
      message: 'Booking berhasil dibuat',
      data: {
        id: booking.id,
        customer_name: booking.customer_name,
        customer_email: booking.customer_email,
        customer_phone: booking.customer_phone,
        movie_title: booking.movie_title,
        total_amount: booking.total_amount,
        seat_numbers: parsedSeats,
        status: booking.status,
        booking_date: booking.booking_date
      }
    });

  } catch (error) {
    console.error('❌ Error creating booking:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  } finally {
    if (connection) connection.release();
  }
});

// ✅ PERBAIKI CONFIRM PAYMENT - UPDATE KE pending_verification
router.post('/confirm-payment', async (req, res) => {
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
    
    // ✅ CEK APAKAH PAYMENT_PROOF ADA DI DATABASE (BUKAN FILESYSTEM)
    const [existing] = await connection.execute(
      'SELECT status, payment_base64 FROM bookings WHERE booking_reference = ?',
      [booking_reference]
    );
    
    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking tidak ditemukan'
      });
    }
    
    const booking = existing[0];
    
    // ✅ CEK APAKAH SUDAH ADA PAYMENT PROOF
    if (!booking.payment_base64) {
      return res.status(400).json({
        success: false,
        message: 'Payment proof belum diupload'
      });
    }
    
    if (booking.status === 'confirmed') {
      return res.status(400).json({
        success: false,
        message: 'Booking sudah dikonfirmasi sebelumnya'
      });
    }

    if (booking.status === 'pending_verification') {
      return res.status(400).json({
        success: false,
        message: 'Payment proof sudah diupload, menunggu verifikasi admin'
      });
    }
    
    // ✅ UPDATE STATUS KE pending_verification BUKAN confirmed
    const [result] = await connection.execute(
      'UPDATE bookings SET status = "pending_verification", payment_date = NOW() WHERE booking_reference = ?',
      [booking_reference]
    );
    
    // Get updated booking
    const [bookings] = await connection.execute(
      'SELECT * FROM bookings WHERE booking_reference = ?',
      [booking_reference]
    );
    
    const updatedBooking = bookings[0];
    
    // Parse seat_numbers
    let seatNumbers;
    try {
      seatNumbers = JSON.parse(updatedBooking.seat_numbers);
    } catch (error) {
      seatNumbers = typeof updatedBooking.seat_numbers === 'string' 
        ? updatedBooking.seat_numbers.split(',').map(s => s.trim())
        : [updatedBooking.seat_numbers];
    }
    
    console.log('✅ Payment confirmed, waiting verification:', booking_reference);
    
    // Response data
    const responseData = {
      ...updatedBooking,
      seat_numbers: seatNumbers,
      qr_code_data: JSON.stringify({
        type: 'CINEMA_TICKET',
        booking_reference: updatedBooking.booking_reference,
        verification_code: updatedBooking.verification_code,
        movie: updatedBooking.movie_title,
        seats: seatNumbers,
        showtime_id: updatedBooking.showtime_id,
        total_paid: updatedBooking.total_amount,
        timestamp: new Date().toISOString()
      })
    };
    
    res.json({
      success: true,
      message: 'Bukti pembayaran berhasil diupload! Menunggu verifikasi admin.',
      data: responseData
    });
    
  } catch (error) {
    console.error('❌ Payment confirmation error:', error);
    res.status(500).json({
      success: false,
      message: 'Konfirmasi pembayaran gagal: ' + error.message
    });
  } finally {
    if (connection) connection.release();
  }
});

// ✅ ADMIN VERIFY - UBAH STATUS JADI confirmed
router.post('/admin-verify-ticket', async (req, res) => {
  let connection;
  try {
    const { booking_reference, verification_code } = req.body;
    
    console.log('🔍 Admin verifying ticket:', { booking_reference, verification_code });
    
    connection = await pool.promise().getConnection();
    
    // ✅ CEK APAKAH SUDAH pending_verification
    const [bookings] = await connection.execute(
      'SELECT * FROM bookings WHERE booking_reference = ? AND status = "pending_verification"',
      [booking_reference]
    );
    
    if (bookings.length === 0) {
      return res.json({
        valid: false,
        message: 'Tiket tidak ditemukan atau sudah diverifikasi'
      });
    }
    
    const booking = bookings[0];
    
    // ✅ VERIFIKASI KODE
    if (booking.verification_code !== verification_code) {
      return res.json({
        valid: false,
        message: 'Kode verifikasi tidak sesuai'
      });
    }
    
    // ✅ VALIDASI: CEK APAKAH KURSI MASIH AVAILABLE
    const [occupiedSeats] = await connection.execute(
      `SELECT seat_numbers FROM bookings 
       WHERE showtime_id = ? AND movie_title = ? 
       AND status = 'confirmed' AND booking_reference != ?`,
      [booking.showtime_id, booking.movie_title, booking_reference]
    );
    
    // Kumpulkan kursi yang sudah terbooking
    const allOccupiedSeats = new Set();
    occupiedSeats.forEach(occBooking => {
      try {
        let seats = JSON.parse(occBooking.seat_numbers);
        if (Array.isArray(seats)) {
          seats.forEach(seat => allOccupiedSeats.add(seat));
        }
      } catch (error) {
        console.log('Error parsing occupied seats:', error);
      }
    });
    
    // Parse kursi dari booking yang diverifikasi
    let currentSeats;
    try {
      currentSeats = JSON.parse(booking.seat_numbers);
    } catch (error) {
      currentSeats = [booking.seat_numbers];
    }
    
    // ✅ CEK KONFLIK KURSI
    const conflictingSeats = currentSeats.filter(seat => allOccupiedSeats.has(seat));
    if (conflictingSeats.length > 0) {
      return res.json({
        valid: false,
        message: `Kursi ${conflictingSeats.join(', ')} sudah dipesan oleh orang lain`
      });
    }
    
    // ✅ UPDATE STATUS JADI confirmed
    const [updateResult] = await connection.execute(
      'UPDATE bookings SET status = "confirmed", verified_at = NOW(), verified_by = "admin" WHERE booking_reference = ?',
      [booking_reference]
    );
    
    console.log('✅ Ticket verified! Status: confirmed');
    
    // Parse seat numbers untuk response
    let seatNumbers;
    try {
      seatNumbers = JSON.parse(booking.seat_numbers);
    } catch (error) {
      seatNumbers = typeof booking.seat_numbers === 'string' 
        ? booking.seat_numbers.split(',').map(s => s.trim())
        : [booking.seat_numbers];
    }
    
    res.json({
      valid: true,
      message: 'Tiket valid - Silakan masuk',
      ticket_info: {
        movie: booking.movie_title,
        booking_reference: booking.booking_reference,
        verification_code: booking.verification_code,
        seats: seatNumbers,
        customer: booking.customer_name,
        customer_email: booking.customer_email,
        total_paid: booking.total_amount,
        status: 'confirmed',
        verified_at: new Date().toISOString(),
        showtime_id: booking.showtime_id
      }
    });
    
  } catch (error) {
    console.error('❌ Admin verify error:', error);
    res.status(500).json({
      valid: false,
      message: 'Verifikasi error: ' + error.message
    });
  } finally {
    if (connection) connection.release();
  }
});

// ✅ PERBAIKI GET PAYMENT IMAGE - DARI DATABASE BUKAN FILESYSTEM
router.get('/payment-image/:bookingReference', async (req, res) => {
  let connection;
  try {
    const { bookingReference } = req.params;
    
    connection = await pool.promise().getConnection();
    
    const [bookings] = await connection.execute(
      'SELECT payment_base64, payment_filename, payment_mimetype FROM bookings WHERE booking_reference = ?',
      [bookingReference]
    );
    
    if (bookings.length === 0 || !bookings[0].payment_base64) {
      return res.status(404).json({
        success: false,
        message: 'Payment proof not found'
      });
    }
    
    const booking = bookings[0];
    
    // ✅ AMBIL DARI DATABASE (BASE64), BUKAN FILESYSTEM
    const imgBuffer = Buffer.from(booking.payment_base64, 'base64');
    
    res.set({
      'Content-Type': booking.payment_mimetype || 'image/jpeg',
      'Content-Length': imgBuffer.length,
      'Content-Disposition': `inline; filename="${booking.payment_filename}"`
    });
    
    res.send(imgBuffer);
    
  } catch (error) {
    console.error('❌ Get payment image error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  } finally {
    if (connection) connection.release();
  }
});

// ✅ GET Booking by Reference
router.get('/:booking_reference', async (req, res) => {
  const { booking_reference } = req.params;
  let connection;

  try {
    connection = await pool.promise().getConnection();

    const [rows] = await connection.execute(
      'SELECT * FROM bookings WHERE booking_reference = ?',
      [booking_reference]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        valid: false,
        message: '❌ Data booking tidak ditemukan di database',
      });
    }

    res.json({
      valid: true,
      message: '✅ Data booking ditemukan',
      booking: rows[0],
    });
  } catch (error) {
    console.error('❌ Error get booking by reference:', error);
    res.status(500).json({ valid: false, message: error.message });
  } finally {
    if (connection) connection.release();
  }
});


// ✅ GET USER BOOKINGS (MY-BOOKINGS) - UPDATE STATUS MAPPING
router.get('/my-bookings', async (req, res) => {
  let connection;
  try {
    const username = req.query.username;
    console.log('👤 Fetching bookings for user:', username);
    
    if (!username) {
      return res.status(400).json({
        success: false,
        message: 'Username is required',
        data: []
      });
    }
    
    connection = await pool.promise().getConnection();
    
    // ✅ QUERY REGULAR BOOKINGS
    const regularBookingsQuery = `
      SELECT 
        id, booking_reference, verification_code, customer_name,
        customer_email, customer_phone, total_amount, seat_numbers,
        status, booking_date, movie_title, showtime_id, is_verified,
        verified_at, qr_code_data, 'regular' as order_type
      FROM bookings 
      WHERE (LOWER(customer_name) = LOWER(?) OR LOWER(customer_email) = LOWER(?))
        AND booking_reference NOT LIKE 'BUNDLE-%'
      ORDER BY booking_date DESC
    `;
    
    const bundleOrdersQuery = `
      SELECT 
        id, order_reference as booking_reference, '' as verification_code,
        customer_name, customer_email, customer_phone, total_price as total_amount,
        '[]' as seat_numbers, status, order_date as booking_date,
        bundle_name as movie_title, 0 as showtime_id, 0 as is_verified,
        NULL as verified_at, NULL as qr_code_data, 'bundle' as order_type
      FROM bundle_orders 
      WHERE LOWER(customer_name) = LOWER(?) OR LOWER(customer_email) = LOWER(?)
      ORDER BY order_date DESC
    `;
    
    console.log('🔍 Executing queries for username:', username);
    
    const [regularBookings] = await connection.execute(regularBookingsQuery, [username, username]);
    const [bundleOrders] = await connection.execute(bundleOrdersQuery, [username, username]);
    
    console.log(`✅ Found ${regularBookings.length} regular bookings`);
    console.log(`✅ Found ${bundleOrders.length} bundle orders`);
    
    const allOrders = [...regularBookings, ...bundleOrders];
    
    // ✅ PROCESS SEAT NUMBERS & UPDATE STATUS MAPPING
    const parsedBookings = allOrders.map(booking => {
      let seatNumbers = [];
      
      if (booking.order_type === 'regular') {
        try {
          if (Array.isArray(booking.seat_numbers)) {
            seatNumbers = booking.seat_numbers;
          } else if (typeof booking.seat_numbers === 'string') {
            const parsed = JSON.parse(booking.seat_numbers);
            seatNumbers = Array.isArray(parsed) ? parsed : [parsed];
          } else if (booking.seat_numbers) {
            seatNumbers = [String(booking.seat_numbers)];
          }
        } catch (error) {
          console.log(`Error processing seats:`, error);
          seatNumbers = [];
        }
      }
      
      // Map showtime
      const showtimeMap = {
        1: '18:00 - Studio 1',
        2: '20:30 - Studio 1', 
        3: '21:00 - Studio 2',
        4: '10:00 - Studio 1',
        5: '13:00 - Studio 2',
        6: '16:00 - Studio 1',
        7: '19:00 - Studio 2'
      };

      // ✅ UPDATE STATUS MAPPING DENGAN pending_verification
      const statusMap = {
        'pending': { text: 'Pending Payment', class: 'pending' },
        'pending_verification': { text: 'Menunggu Verifikasi', class: 'pending-verification' },
        'confirmed': { text: 'Terkonfirmasi', class: 'confirmed' },
        'payment_rejected': { text: 'Pembayaran Ditolak', class: 'rejected' },
        'cancelled': { text: 'Dibatalkan', class: 'cancelled' }
      };
      
      const statusInfo = statusMap[booking.status] || { text: booking.status, class: 'unknown' };
      
      let showtimeText;
      if (booking.order_type === 'bundle') {
        showtimeText = 'Bundle Ticket';
      } else {
        showtimeText = showtimeMap[booking.showtime_id] || `Showtime ${booking.showtime_id}`;
      }
      
      return {
        id: booking.id,
        booking_reference: booking.booking_reference,
        verification_code: booking.verification_code,
        movie_title: booking.movie_title,
        seat_numbers: seatNumbers,
        showtime_id: booking.showtime_id,
        showtime: showtimeText,
        total_amount: booking.total_amount,
        customer_name: booking.customer_name,
        customer_email: booking.customer_email,
        customer_phone: booking.customer_phone,
        status: booking.status,
        status_text: statusInfo.text,
        status_class: statusInfo.class,
        booking_date: booking.booking_date,
        is_verified: booking.is_verified,
        verified_at: booking.verified_at,
        qr_code_data: booking.qr_code_data,
        order_type: booking.order_type,
        is_bundle: booking.order_type === 'bundle',
        formatted_booking_date: new Date(booking.booking_date).toLocaleDateString('id-ID', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      };
    });
    
    res.json({
      success: true,
      data: parsedBookings,
      summary: {
        total: parsedBookings.length,
        regular: regularBookings.length,
        bundle: bundleOrders.length,
        confirmed: parsedBookings.filter(b => b.status === 'confirmed').length,
        pending_verification: parsedBookings.filter(b => b.status === 'pending_verification').length,
        pending: parsedBookings.filter(b => b.status === 'pending').length,
        rejected: parsedBookings.filter(b => b.status === 'payment_rejected').length,
        cancelled: parsedBookings.filter(b => b.status === 'cancelled').length
      }
    });
    
  } catch (error) {
    console.error('❌ ERROR in /my-bookings:', error);
    res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message,
      data: []
    });
  } finally {
    if (connection) connection.release();
  }
});

// ✅ GET UPLOADED PAYMENT PROOFS FOR ADMIN - UPDATE STATUS
router.get('/uploaded-payments', async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    
    const [payments] = await connection.execute(`
      SELECT 
        booking_reference,
        customer_name,
        movie_title,
        total_amount,
        payment_filename,
        status,
        booking_date,
        verified_at,
        verified_by
      FROM bookings 
      WHERE payment_base64 IS NOT NULL 
      ORDER BY booking_date DESC
    `);
    
    console.log('💰 Uploaded payments found:', payments.length);
    
    res.json({
      success: true,
      count: payments.length,
      data: payments
    });
    
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payments: ' + error.message
    });
  } finally {
    if (connection) connection.release();
  }
});

// ✅ CREATE BUNDLE ORDER
router.post('/create-bundle-order', async (req, res) => {
  let connection;
  try {
    const {
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
      customer_email,
      payment_proof,
      status = 'confirmed'
    } = req.body;

    console.log('📦 Creating bundle order:', {
      order_reference,
      bundle_name,
      customer_name,
      payment_proof: payment_proof ? 'Provided' : 'Missing',
      status
    });

    connection = await pool.promise().getConnection();

    const [result] = await connection.execute(
      `INSERT INTO bundle_orders (
        order_reference, bundle_id, bundle_name, bundle_description,
        bundle_price, original_price, savings, quantity, total_price,
        customer_name, customer_phone, customer_email, 
        payment_proof, status, order_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        order_reference, bundle_id, bundle_name, bundle_description,
        bundle_price, original_price, savings, quantity, total_price,
        customer_name, customer_phone, customer_email,
        payment_proof, status
      ]
    );

    console.log('✅ Bundle order created with ID:', result.insertId);

    const [orders] = await connection.execute(
      'SELECT * FROM bundle_orders WHERE id = ?',
      [result.insertId]
    );

    res.json({
      success: true,
      message: 'Bundle order created successfully',
      data: orders[0],
      orderId: result.insertId
    });

  } catch (error) {
    console.error('❌ Error creating bundle order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create bundle order: ' + error.message
    });
  } finally {
    if (connection) connection.release();
  }
});

// ✅ BUNDLE ORDER - CREATE NEW BUNDLE ORDER
router.post('/bundle-order', async (req, res) => {
  let connection;
  try {
    const {
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
      customer_email
    } = req.body;

    console.log('🛒 Creating bundle order:', { order_reference, bundle_name, customer_name });

    if (!order_reference || !bundle_name || !customer_name || !customer_phone || !customer_email) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: order_reference, bundle_name, customer_name, customer_phone, customer_email'
      });
    }

    connection = await pool.promise().getConnection();

    const query = `
      INSERT INTO bookings (
        booking_reference,
        customer_name,
        customer_email,
        customer_phone,
        total_amount,
        status,
        payment_status,
        movie_title,
        order_type,
        bundle_id,
        bundle_name,
        bundle_description,
        original_price,
        savings,
        quantity,
        showtime_id,
        seat_numbers
      ) VALUES (?, ?, ?, ?, ?, 'pending', 'pending', ?, 'bundle', ?, ?, ?, ?, ?, ?, 0, '[]')
    `;

    const values = [
      order_reference,
      customer_name,
      customer_email,
      customer_phone,
      total_price,
      bundle_name,
      bundle_id || null,
      bundle_name,
      bundle_description || null,
      original_price || bundle_price,
      savings || 0,
      quantity || 1
    ];

    console.log('📝 Executing query:', query);
    console.log('📦 With values:', values);

    const [result] = await connection.execute(query, values);

    console.log('✅ Bundle order created with ID:', result.insertId);

    const [orders] = await connection.execute(
      'SELECT * FROM bookings WHERE id = ?',
      [result.insertId]
    );

    res.json({
      success: true,
      message: 'Bundle order created successfully',
      orderId: result.insertId,
      orderReference: order_reference,
      data: orders[0]
    });

  } catch (error) {
    console.error('❌ Bundle order creation error:', error);
    
    let errorMessage = 'Failed to create bundle order';
    if (error.sqlMessage) {
      errorMessage += `: ${error.sqlMessage}`;
      console.log('🔍 SQL Error Details:', {
        code: error.code,
        errno: error.errno,
        sqlMessage: error.sqlMessage,
        sqlState: error.sqlState
      });
    } else {
      errorMessage += `: ${error.message}`;
    }

    res.status(500).json({
      success: false,
      message: errorMessage,
      sqlError: error.sqlMessage,
      errorCode: error.code
    });
  } finally {
    if (connection) connection.release();
  }
});

// === Upload Bukti Pembayaran ===
router.post('/upload-payment/:booking_reference', upload.single('file'), async (req, res) => {
  const { booking_reference } = req.params;
  const file = req.file;

  try {
    if (!file) {
      return res.status(400).json({ success: false, message: 'File tidak ditemukan' });
    }

    // Upload ke Supabase Storage
    const fileName = `bukti-${booking_reference}-${Date.now()}.jpg`;
    const { data, error } = await supabase.storage
      .from('bukti-pembayaran')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: true
      });

    if (error) throw error;

    const fileUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/bukti-pembayaran/${fileName}`;

    // Update database
    await pool.promise().execute(`
      UPDATE bookings 
      SET payment_url = ?, payment_filename = ?, payment_mimetype = ?, 
          uploaded_at = NOW(), status = 'waiting_verification'
      WHERE booking_reference = ?
    `, [fileUrl, file.originalname, file.mimetype, booking_reference]);

    res.json({
      success: true,
      message: '✅ Bukti pembayaran berhasil diupload. Silakan hubungi admin untuk verifikasi dalam 10 menit.',
      payment_url: fileUrl,
      status: 'waiting_verification'
    });

  } catch (error) {
    console.error('❌ Error upload:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/verify/:booking_reference', async (req, res) => {
  const { booking_reference } = req.params;
  const { verified_by, action } = req.body; // action: confirm | reject

  try {
    const status = action === 'confirm' ? 'confirmed' : 'rejected';

    await pool.promise().execute(`
      UPDATE bookings 
      SET status = ?, verified_at = NOW(), verified_by = ?
      WHERE booking_reference = ?
    `, [status, verified_by, booking_reference]);

    res.json({
      success: true,
      message: `Booking ${booking_reference} berhasil di-${status}.`,
      status
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});




// Di routes/bookings.js - endpoint /upload-payment
router.post('/upload-payment', upload.single('payment_proof'), async (req, res) => {
  let connection;
  try {
    console.log('=== 🚀 UPLOAD PAYMENT - GENERATE REFERENCE & CODE ===');
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'File required'
      });
    }

    // ✅ TANGANI BOTH booking_id DAN booking_reference
    const bookingId = req.body.booking_id;
    const bookingReference = req.body.booking_reference;
    
    if (!bookingId && !bookingReference) {
      return res.status(400).json({
        success: false,
        message: 'Booking ID or Booking Reference required'
      });
    }

    // ✅ GENERATE REFERENCE & CODE SAAT UPLOAD BUKTI BAYAR
    const new_booking_reference = bookingReference || 'TIX' + Date.now().toString().slice(-6) + Math.random().toString(36).substr(2, 3).toUpperCase();
    const verification_code = Math.floor(100000 + Math.random() * 900000).toString();
    
    const base64Image = req.file.buffer.toString('base64');
    const fileName = `payment-${Date.now()}-${req.file.originalname}`;
    
    console.log('📤 Uploading for:', { bookingId, bookingReference });
    console.log('🎫 Generated:', { new_booking_reference, verification_code });
    
    connection = await pool.promise().getConnection();

    // ✅ BUILD QUERY DYNAMIC (UNTUK booking_id ATAU booking_reference)
    let query;
    let params;
    
    if (bookingId) {
      query = `UPDATE bookings SET 
        booking_reference = ?,
        verification_code = ?,
        payment_proof = ?, 
        payment_filename = ?, 
        payment_base64 = ?, 
        payment_mimetype = ?,
        status = 'pending_verification',
        payment_date = NOW()
      WHERE id = ? AND status = 'pending'`;
      params = [new_booking_reference, verification_code, fileName, req.file.originalname, base64Image, req.file.mimetype, bookingId];
    } else {
      query = `UPDATE bookings SET 
        verification_code = ?,
        payment_proof = ?, 
        payment_filename = ?, 
        payment_base64 = ?, 
        payment_mimetype = ?,
        status = 'pending_verification',
        payment_date = NOW()
      WHERE booking_reference = ? AND status = 'pending'`;
      params = [verification_code, fileName, req.file.originalname, base64Image, req.file.mimetype, bookingReference];
    }

    const [result] = await connection.execute(query, params);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or already processed'
      });
    }
    const finalBookingRef = bookingReference || new_booking_reference;
    const [bookings] = await connection.execute(
  'SELECT * FROM bookings WHERE booking_reference = ?',
  [finalBookingRef]
);
    
    const booking = bookings[0];
    
    // Parse seat numbers
    let seatNumbers;
    try {
      seatNumbers = JSON.parse(booking.seat_numbers);
    } catch (error) {
      seatNumbers = typeof booking.seat_numbers === 'string' 
        ? booking.seat_numbers.split(',').map(s => s.trim())
        : [booking.seat_numbers];
    }
    
    console.log('✅ Payment uploaded! Status: pending_verification');
    
    // ✅ KIRIM VERIFICATION_CODE KE FRONTEND
    res.json({
      success: true,
      message: 'Bukti pembayaran berhasil diupload! Menunggu verifikasi admin.',
      data: {
        booking_reference: new_booking_reference,
        verification_code: verification_code, // ✅ INI YANG PENTING!
        status: 'pending_verification',
        customer_name: booking.customer_name,
        movie_title: booking.movie_title,
        seat_numbers: seatNumbers,
        total_amount: booking.total_amount,
        instructions: 'Tunggu verifikasi admin untuk mendapatkan e-ticket'
      }
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

// ===== 1. Create bundle order =====
app.post('/create', async (req, res) => {
  try {
    const {
      bundle_id, bundle_name, bundle_description,
      bundle_price, original_price, savings,
      quantity, total_price, customer_name,
      customer_phone, customer_email
    } = req.body;

    if (!bundle_id || !bundle_name || !customer_name)
      return res.status(400).json({ success: false, message: 'Data tidak lengkap.' });

    const order_reference = `BUNDLE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    await pool.promise().execute(
      `INSERT INTO bundle_orders
      (order_reference, bundle_id, bundle_name, bundle_description, bundle_price, original_price, savings, quantity, total_price, customer_name, customer_phone, customer_email, status, order_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW(), NOW())`,
      [order_reference, bundle_id, bundle_name, bundle_description, bundle_price, original_price, savings, quantity, total_price, customer_name, customer_phone, customer_email]
    );

    res.json({ success: true, message: 'Pesanan bundle berhasil dibuat.', order_reference });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/create-order", async (req, res) => {
  try {
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
      customer_email,
    } = req.body;

    if (!bundle_id || !bundle_name || !customer_name) {
      return res.status(400).json({ success: false, message: "Data tidak lengkap." });
    }

    const order_reference = `BUNDLE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    await pool.promise().execute(
      `INSERT INTO bundle_orders
      (order_reference, bundle_id, bundle_name, bundle_description, bundle_price, original_price, savings, quantity, total_price, customer_name, customer_phone, customer_email, status, order_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW(), NOW())`,
      [
        order_reference,
        bundle_id,
        bundle_name,
        bundle_description || '',
        bundle_price,
        original_price,
        savings,
        quantity,
        total_price,
        customer_name,
        customer_phone,
        customer_email,
      ]
    );

    res.json({ success: true, message: "Pesanan bundle berhasil dibuat.", order_reference });
  } catch (err) {
    console.error("❌ Error create bundle:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});


router.get("/:order_reference", async (req, res) => {
  try {
    const { order_reference } = req.params;
    const [rows] = await pool
      .promise()
      .execute("SELECT * FROM bundle_orders WHERE order_reference = ?", [
        order_reference,
      ]);

    if (rows.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Order tidak ditemukan." });

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error("❌ Error get order:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/verify/:order_reference", async (req, res) => {
  try {
    const { order_reference } = req.params;

    await pool.promise().execute(
      `UPDATE bundle_orders SET status = 'confirmed', updated_at = NOW() WHERE order_reference = ?`,
      [order_reference]
    );

    res.json({
      success: true,
      message: `Order ${order_reference} berhasil dikonfirmasi.`,
    });
  } catch (err) {
    console.error("❌ Error verify order:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});
// ===== Export serverless =====
export default serverless(app);

export const config = {
  api: {
    bodyParser: false,
  },
};


module.exports = router;