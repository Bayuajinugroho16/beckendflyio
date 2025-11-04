import express from 'express';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Multer config for memory storage
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'), false);
  }
});

// ================= Helper =================
function parseSeatNumbers(seatNumbers) {
  if (!seatNumbers) return [];
  if (Array.isArray(seatNumbers)) return seatNumbers;
  try { return JSON.parse(seatNumbers); }
  catch { return seatNumbers.split(',').map(s => s.trim()); }
}

// ================= GET ALL BOOKINGS (Admin) =================
router.get('/', async (req, res) => {
  try {
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('*')
      .order('booking_date', { ascending: false });

    if (error) throw error;

    const processed = bookings.map(b => ({
      ...b,
      seat_numbers: parseSeatNumbers(b.seat_numbers),
      has_payment: !!(b.payment_proof || b.payment_base64)
    }));

    res.json({ success: true, count: processed.length, data: processed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= GET MY BOOKINGS =================
router.get('/my-bookings', async (req, res) => {
  try {
    const usernameOrEmail = req.query.username;
    if (!usernameOrEmail) return res.status(400).json({ success: false, message: 'Username/email required', data: [] });

    // Regular bookings
    const { data: regularBookings, error: error1 } = await supabase
      .from('bookings')
      .select('*')
      .or(`customer_name.eq.${usernameOrEmail},customer_email.eq.${usernameOrEmail}`)
      .order('booking_date', { ascending: false });

    if (error1) throw error1;

    // Bundle orders
    const { data: bundleOrders, error: error2 } = await supabase
      .from('bundle_orders')
      .select('*')
      .or(`customer_name.eq.${usernameOrEmail},customer_email.eq.${usernameOrEmail}`)
      .order('order_date', { ascending: false });

    if (error2) throw error2;

    const all = [...regularBookings, ...bundleOrders].map(b => ({
      ...b,
      seat_numbers: b.seat_numbers ? parseSeatNumbers(b.seat_numbers) : [],
      payment_proof: b.payment_base64 ? `data:${b.payment_mimetype || 'image/jpeg'};base64,${b.payment_base64}` : b.payment_proof || null
    }));

    res.json({ success: true, data: all });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message, data: [] });
  }
});

// ================= GET OCCUPIED SEATS =================
router.get('/occupied-seats', async (req, res) => {
  try {
    const { showtime_id, movie_title } = req.query;
    if (!showtime_id || !movie_title) return res.status(400).json({ success: false, message: 'showtime_id & movie_title required' });

    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('seat_numbers')
      .eq('showtime_id', showtime_id)
      .eq('movie_title', movie_title)
      .eq('status', 'confirmed');

    if (error) throw error;

    const occupied = new Set();
    bookings.forEach(b => parseSeatNumbers(b.seat_numbers).forEach(s => s && occupied.add(s)));

    res.json({ success: true, data: Array.from(occupied) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message, data: [] });
  }
});

// ================= CREATE BOOKING =================
router.post('/', async (req, res) => {
  try {
    const { showtime_id, customer_name, customer_email, customer_phone, seat_numbers, total_amount, movie_title } = req.body;
    if (!customer_name || !customer_email || !movie_title || !total_amount)
      return res.status(400).json({ success: false, message: 'Required fields missing' });

    const seatJson = JSON.stringify(Array.isArray(seat_numbers) ? seat_numbers.filter(s => s) : []);

    const { data: inserted, error } = await supabase
      .from('bookings')
      .insert([{
        showtime_id: showtime_id || null,
        customer_name,
        customer_email,
        customer_phone: customer_phone || null,
        seat_numbers: seatJson,
        total_amount,
        movie_title,
        status: 'pending'
      }])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, message: 'Booking created', data: { ...inserted, seat_numbers: parseSeatNumbers(inserted.seat_numbers) } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= UPLOAD PAYMENT PROOF =================
router.post('/upload-payment/:booking_reference', upload.single('file'), async (req, res) => {
  try {
    const { booking_reference } = req.params;
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, message: 'File required' });

    const { data: booking, error: fetchErr } = await supabase
      .from('bookings')
      .select('*')
      .eq('booking_reference', booking_reference)
      .single();

    if (fetchErr) return res.status(404).json({ success: false, message: 'Booking not found' });

    const base64Image = file.buffer.toString('base64');

    const { error: updateErr } = await supabase
      .from('bookings')
      .update({
        payment_base64: base64Image,
        payment_filename: file.originalname,
        payment_mimetype: file.mimetype,
        status: 'pending_verification',
        payment_date: new Date().toISOString()
      })
      .eq('booking_reference', booking_reference);

    if (updateErr) throw updateErr;

    res.json({ success: true, message: 'Payment uploaded, waiting verification', booking_reference });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= ADMIN VERIFY BOOKING =================
router.post('/admin-verify/:booking_reference', async (req, res) => {
  try {
    const { booking_reference } = req.params;
    const { verification_code } = req.body;

    const { data: booking, error: fetchErr } = await supabase
      .from('bookings')
      .select('*')
      .eq('booking_reference', booking_reference)
      .eq('status', 'pending_verification')
      .single();

    if (fetchErr) return res.status(404).json({ success: false, message: 'Booking not found or already verified' });

    if (booking.verification_code !== verification_code) return res.status(400).json({ success: false, message: 'Invalid verification code' });

    const { error: updateErr } = await supabase
      .from('bookings')
      .update({ status: 'confirmed', verified_at: new Date().toISOString(), verified_by: 'admin' })
      .eq('booking_reference', booking_reference);

    if (updateErr) throw updateErr;

    res.json({ success: true, message: 'Booking confirmed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= GET BOOKING BY REFERENCE =================
router.get('/:booking_reference', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('booking_reference', req.params.booking_reference)
      .single();

    if (error) return res.status(404).json({ success: false, message: 'Booking not found' });

    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= CREATE BUNDLE ORDER =================
router.post('/create-bundle-order', async (req, res) => {
  try {
    const { bundle_id, bundle_name, bundle_description, bundle_price, original_price, savings, quantity, total_price, customer_name, customer_phone, customer_email } = req.body;
    if (!bundle_id || !bundle_name || !customer_name) return res.status(400).json({ success: false, message: 'Required fields missing' });

    const order_reference = `BUNDLE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const { error } = await supabase
      .from('bundle_orders')
      .insert([{
        order_reference,
        bundle_id,
        bundle_name,
        bundle_description: bundle_description || '',
        bundle_price,
        original_price,
        savings,
        quantity,
        total_price,
        customer_name,
        customer_phone,
        customer_email,
        status: 'pending'
      }]);

    if (error) throw error;

    res.status(201).json({ success: true, message: 'Bundle order created', order_reference });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
