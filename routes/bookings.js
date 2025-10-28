import express from 'express';
import multer from 'multer';
import path from 'path';
import { pool } from '../config/database.js';

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

// ✅ OCCUPIED SEATS ENDPOINT - UPDATE DENGAN pending_verification
router.get('/occupied-seats', async (req, res) => {
  let connection;
  try {
    const { showtime_id, movie_title } = req.query;

    console.log('🎯 Fetching occupied seats for showtime:', showtime_id, 'and movie:', movie_title);

    if (!showtime_id || !movie_title) {
      return res.status(400).json({
        success: false,
        message: 'Showtime ID and Movie Title are required'
      });
    }

    connection = await pool.promise().getConnection();

    // ✅ UPDATE: INCLUDE pending_verification SEATS
    const [bookings] = await connection.execute(
      `SELECT seat_numbers FROM bookings 
       WHERE showtime_id = ? AND movie_title = ? 
       AND status IN ('confirmed', 'pending_verification')`,
      [showtime_id, movie_title]
    );

    console.log(`✅ Found ${bookings.length} bookings for showtime ${showtime_id}`);

    // Kumpulkan semua kursi yang sudah dipesan
    const occupiedSeats = new Set();
    bookings.forEach(booking => {
      try {
        let seats;
        if (typeof booking.seat_numbers === 'string') {
          try {
            seats = JSON.parse(booking.seat_numbers);
          } catch (e) {
            // Jika parsing gagal, anggap sebagai string biasa
            seats = booking.seat_numbers.split(',').map(seat => seat.trim().replace(/[\[\]"]/g, ''));
          }
        } else {
          seats = booking.seat_numbers;
        }

        // Pastikan seats adalah array
        if (Array.isArray(seats)) {
          seats.forEach(seat => {
            if (seat) {
              occupiedSeats.add(seat);
            }
          });
        } else {
          console.error('❌ seat_numbers is not an array:', seats);
        }
      } catch (error) {
        console.error('❌ Error processing seat_numbers:', error, booking);
      }
    });

    const occupiedSeatsArray = Array.from(occupiedSeats);
    console.log(`✅ Occupied seats for showtime ${showtime_id}:`, occupiedSeatsArray);

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

// ✅ CREATE NEW BOOKING - DENGAN VALIDASI SEAT_NUMBERS
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

    console.log('📥 Received booking creation request:', req.body);

    // ✅ VALIDASI LEBIH KETAT - CEK SEAT_NUMBERS TIDAK BOLEH EMPTY
    if (!showtime_id || !customer_name || !customer_email || !seat_numbers || !total_amount) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: showtime_id, customer_name, customer_email, seat_numbers, total_amount'
      });
    }

    // ✅ VALIDASI KHUSUS UNTUK SEAT_NUMBERS
    console.log('🔍 Validating seat_numbers:', {
      seat_numbers: seat_numbers,
      type: typeof seat_numbers,
      isArray: Array.isArray(seat_numbers),
      length: Array.isArray(seat_numbers) ? seat_numbers.length : 'N/A'
    });

    if (Array.isArray(seat_numbers) && seat_numbers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Pilih minimal 1 kursi sebelum melakukan booking'
      });
    }

    if (typeof seat_numbers === 'string' && (seat_numbers === '[]' || seat_numbers === '')) {
      return res.status(400).json({
        success: false,
        message: 'Data kursi tidak valid'
      });
    }

    if (!seat_numbers || seat_numbers === null || seat_numbers === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Data kursi harus diisi'
      });
    }

    connection = await pool.promise().getConnection();

    // Generate unique booking reference dan verification code
    const booking_reference = 'BK' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
    const verification_code = Math.floor(100000 + Math.random() * 900000).toString();

    console.log('🆕 Generated booking reference:', booking_reference);

    // ✅ PASTIKAN SEAT_NUMBERS VALID SEBELUM DISIMPAN
    let seatNumbersToSave;
    
    if (Array.isArray(seat_numbers)) {
      // Filter out empty values
      const validSeats = seat_numbers.filter(seat => 
        seat !== null && 
        seat !== undefined && 
        seat !== '' &&
        String(seat).trim() !== ''
      );
      
      if (validSeats.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Tidak ada kursi valid yang dipilih'
        });
      }
      
      seatNumbersToSave = JSON.stringify(validSeats);
      console.log('✅ Valid seats to save:', validSeats);
    } else {
      // Handle single seat
      const seatStr = String(seat_numbers).trim();
      if (seatStr === '' || seatStr === '[]') {
        return res.status(400).json({
          success: false,
          message: 'Kursi tidak valid'
        });
      }
      seatNumbersToSave = JSON.stringify([seatStr]);
    }

    // Insert booking ke database
    const query = `
      INSERT INTO bookings 
      (showtime_id, customer_name, customer_email, customer_phone, seat_numbers, total_amount, movie_title, booking_reference, verification_code, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `;

    const [result] = await connection.execute(query, [
      showtime_id,
      customer_name,
      customer_email,
      customer_phone || null,
      seatNumbersToSave, // ✅ GUNAKAN YANG SUDAH DIVALIDASI
      total_amount,
      movie_title || null,
      booking_reference,
      verification_code
    ]);

    const bookingId = result.insertId;

    console.log('✅ Booking created with ID:', bookingId);
    console.log('💾 Seat numbers saved:', seatNumbersToSave);

    // Dapatkan data booking yang baru dibuat
    const [newBookings] = await connection.execute(
      'SELECT * FROM bookings WHERE id = ?',
      [bookingId]
    );

    const newBooking = newBookings[0];

    // Parse seat_numbers untuk response
    let parsedSeatNumbers;
    try {
      parsedSeatNumbers = JSON.parse(newBooking.seat_numbers);
      console.log('📤 Response seat_numbers:', parsedSeatNumbers);
    } catch (error) {
      parsedSeatNumbers = [newBooking.seat_numbers];
    }

    // Response sukses
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

// ✅ SCAN TICKET - UPDATE DENGAN STATUS VERIFIKASI
router.post('/scan-ticket', async (req, res) => {
  let connection;
  try {
    const { qr_data } = req.body;
    
    console.log('🔍 Scanning QR ticket:', qr_data);
    
    if (!qr_data) {
      return res.status(400).json({
        valid: false,
        message: 'QR data is required'
      });
    }

    // Parse QR data
    let ticketInfo;
    try {
      ticketInfo = JSON.parse(qr_data);
    } catch (parseError) {
      return res.status(400).json({
        valid: false,
        message: 'Invalid QR code format'
      });
    }

    connection = await pool.promise().getConnection();
    
    // ✅ UPDATE: HANYA SCAN BOOKING YANG SUDAH CONFIRMED
    const [bookings] = await connection.execute(
      'SELECT * FROM bookings WHERE booking_reference = ? AND status = "confirmed"',
      [ticketInfo.booking_reference]
    );
    
    if (bookings.length === 0) {
      return res.json({
        valid: false,
        message: 'Tiket tidak valid atau belum dikonfirmasi'
      });
    }
    
    const booking = bookings[0];
    
    // Verifikasi kode
    if (booking.verification_code !== ticketInfo.verification_code) {
      return res.json({
        valid: false,
        message: 'Kode verifikasi tidak sesuai'
      });
    }
    
    // Check jika sudah digunakan
    if (booking.is_verified) {
      return res.json({
        valid: false,
        message: 'Tiket sudah digunakan sebelumnya',
        used_at: booking.verified_at
      });
    }
    
    // Mark as verified
    await connection.execute(
      'UPDATE bookings SET is_verified = 1, verified_at = NOW() WHERE booking_reference = ?',
      [ticketInfo.booking_reference]
    );
    
    console.log('✅ Ticket verified successfully:', ticketInfo.booking_reference);
    
    // Parse seat numbers
    let seatNumbers;
    try {
      seatNumbers = JSON.parse(booking.seat_numbers);
    } catch (error) {
      seatNumbers = typeof booking.seat_numbers === 'string' 
        ? booking.seat_numbers.split(',').map(s => s.trim())
        : [booking.seat_numbers];
    }
    
    // ✅ BROADCAST REAL-TIME UPDATE - KURSI SUDAH DIVALIDASI
    if (global.broadcastSeatUpdate) {
      console.log('📢 Broadcasting seat validation update');
      
      const seatUpdates = seatNumbers.map(seatNumber => ({
        seat_number: seatNumber,
        status: 'occupied',
        booking_reference: booking.booking_reference,
        action: 'ticket_validated',
        timestamp: new Date().toISOString()
      }));
      
      global.broadcastSeatUpdate(booking.showtime_id, seatUpdates);
    }
    
    res.json({
      valid: true,
      message: 'Tiket valid - Silakan masuk',
      ticket_info: {
        movie: booking.movie_title,
        booking_reference: booking.booking_reference,
        showtime_id: booking.showtime_id,
        seats: seatNumbers,
        customer: booking.customer_name,
        total_paid: booking.total_amount,
        status: 'VERIFIED',
        verification_code: booking.verification_code
      }
    });
    
  } catch (error) {
    console.error('❌ QR scan error:', error);
    res.status(500).json({
      valid: false,
      message: 'Scan error: ' + error.message
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

// ✅ PERBAIKI ENDPOINT UPLOAD-PAYMENT - UPDATE STATUS KE pending_verification
router.post('/upload-payment', upload.single('payment_proof'), async (req, res) => {
  let connection;
  try {
    console.log('=== 🚀 UPLOAD PAYMENT (FIXED - NO FILESYSTEM) ===');
    
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    if (!req.body.booking_reference) {
      return res.status(400).json({
        success: false, 
        message: 'Booking reference required'
      });
    }

    // ✅ HANYA SIMPAN BASE64 KE DATABASE
    const base64Image = req.file.buffer.toString('base64');
    const fileName = `payment-${Date.now()}-${req.file.originalname}`;
    
    console.log('📤 Uploading for booking:', req.body.booking_reference);
    
    connection = await pool.promise().getConnection();

    // ✅ UPDATE STATUS KE pending_verification BUKAN confirmed
    const [result] = await connection.execute(
      `UPDATE bookings SET 
        payment_proof = ?, 
        payment_filename = ?, 
        payment_base64 = ?, 
        payment_mimetype = ?,
        status = 'pending_verification',  // ✅ UPDATE STATUS
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
    
    console.log('✅ Upload successful! Status: pending_verification');
    
    res.json({
      success: true,
      message: 'Bukti pembayaran berhasil diupload! Menunggu verifikasi admin.',
      fileName: fileName
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

// ✅ ENDPOINT UNTUK BASE64 UPLOAD (COMPATIBILITY) - UPDATE STATUS
router.post('/update-payment-base64', async (req, res) => {
  let connection;
  try {
    console.log('=== 🚀 BASE64 PAYMENT UPLOAD ===');
    
    const { booking_reference, payment_base64, payment_filename, payment_mimetype } = req.body;

    if (!booking_reference || !payment_base64) {
      return res.status(400).json({
        success: false,
        message: 'Booking reference and payment base64 are required'
      });
    }

    console.log('📤 Processing base64 payment for:', booking_reference);
    
    connection = await pool.promise().getConnection();

    // ✅ SIMPAN BASE64 KE DATABASE DENGAN STATUS pending_verification
    const [result] = await connection.execute(
      `UPDATE bookings SET 
        payment_proof = ?, 
        payment_filename = ?, 
        payment_base64 = ?, 
        payment_mimetype = ?,
        status = 'pending_verification',  // ✅ UPDATE STATUS
        payment_date = NOW()
      WHERE booking_reference = ?`,
      [
        `base64-${Date.now()}-${payment_filename}`,
        payment_filename,
        payment_base64,
        payment_mimetype,
        booking_reference
      ]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }
    
    console.log('✅ Base64 payment uploaded successfully - Status: pending_verification');
    
    res.json({
      success: true,
      message: 'Bukti pembayaran berhasil diupload! Menunggu verifikasi admin.',
      fileName: `base64-${Date.now()}-${payment_filename}`,
      booking_reference: booking_reference
    });
    
  } catch (error) {
    console.error('❌ Base64 upload error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Upload failed: ' + error.message
    });
  } finally {
    if (connection) connection.release();
  }
});

// ✅ PERBAIKI BUNDLE ORDER UPLOAD - NO FILESYSTEM
router.post('/bundle-order/upload-payment', upload.single('payment_proof'), async (req, res) => {
  let connection;
  try {
    console.log('=== 🚀 BUNDLE ORDER UPLOAD (FIXED) ===');
    
    if (!req.file || !req.body.order_reference) {
      return res.status(400).json({ 
        success: false, 
        message: 'File and order reference required' 
      });
    }

    // ✅ VERIFIKASI MEMORY STORAGE
    if (!req.file.buffer) {
      return res.status(500).json({
        success: false,
        message: 'Server configuration error'
      });
    }

    // ✅ BASE64 STORAGE UNTUK BUNDLE
    const base64Image = req.file.buffer.toString('base64');
    const fileName = `bundle-payment-${Date.now()}-${req.file.originalname}`;
    
    console.log('📦 Bundle order reference:', req.body.order_reference);
    
    connection = await pool.promise().getConnection();

    // ✅ UPDATE bundle_orders table dengan base64
    const [result] = await connection.execute(
      `UPDATE bundle_orders SET 
        payment_proof = ?,
        payment_base64 = ?,
        payment_mimetype = ?,
        status = 'confirmed'
       WHERE order_reference = ?`,
      [fileName, base64Image, req.file.mimetype, req.body.order_reference]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Bundle order not found'
      });
    }
    
    console.log('✅ Bundle order payment uploaded (Base64)');
    
    res.json({
      success: true,
      message: 'Bundle payment proof uploaded successfully',
      fileName: fileName,
      orderReference: req.body.order_reference
    });
    
  } catch (error) {
    console.error('❌ Bundle upload error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Upload failed: ' + error.message
    });
  } finally {
    if (connection) connection.release();
  }
});

// ✅ GET BUNDLE ORDERS BY USERNAME
router.get('/bundle-orders', async (req, res) => {
  let connection;
  try {
    const username = req.query.username;
    
    console.log('👤 Fetching bundle orders for user:', username);
    
    if (!username) {
      return res.status(400).json({
        success: false,
        message: 'Username is required',
        data: []
      });
    }
    
    connection = await pool.promise().getConnection();
    
    const [orders] = await connection.execute(
      `SELECT 
        id,
        order_reference as booking_reference,
        '' as verification_code,
        customer_name,
        customer_email,
        customer_phone,
        total_price as total_amount,
        '[]' as seat_numbers,
        status,
        order_date as booking_date,
        bundle_name as movie_title,
        0 as showtime_id,
        0 as is_verified,
        NULL as verified_at,
        NULL as qr_code_data,
        'bundle' as order_type
       FROM bundle_orders 
       WHERE customer_name = ? OR customer_email = ?
       ORDER BY order_date DESC`,
      [username, username]
    );

    console.log(`✅ Found ${orders.length} bundle orders for user: ${username}`);
    
    res.json({
      success: true,
      data: orders
    });

  } catch (error) {
    console.error('❌ Error fetching bundle orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bundle orders: ' + error.message,
      data: []
    });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;