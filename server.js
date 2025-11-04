import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import cron from 'node-cron';
import { supabase } from './config/supabase.js';

const app = express();

// ==================== MIDDLEWARE ====================
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'http://127.0.0.1:5173'
  ],
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));
app.options('*', cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if(file.mimetype.startsWith('image/')) cb(null, true);
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
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

const requireAdmin = (req,res,next) => {
  if(req.user?.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin access required' });
  next();
};

// ==================== CRON JOB ====================
cron.schedule('*/5 * * * *', async () => {
  console.log('⏳ Checking expired pending_verification bookings...');
  try {
    const { error } = await supabase
      .from('bookings')
      .update({ status: 'payment_rejected' })
      .lt('payment_date', new Date(Date.now() - 30*60*1000))
      .eq('status', 'pending_verification');

    if(error) console.error('❌ Cron job error:', error);
    else console.log('✅ Expired bookings cleaned up');
  } catch(err) {
    console.error('❌ Cron job exception:', err);
  }
});

// ==================== AUTH ROUTES ====================

// REGISTER
app.post('/api/auth/register', async (req,res) => {
  const { username,email,password,role } = req.body;
  if(!username || !email || !password) return res.status(400).json({ success:false, message:'Required fields missing' });

  try {
    const { data: existing, error: existError } = await supabase.from('users').select('*').eq('username',username);
    if(existError) throw existError;
    if(existing.length) return res.status(400).json({ success:false, message:'Username already exists' });

    const hashed = await bcrypt.hash(password,10);
    const { data, error } = await supabase.from('users').insert([{
      username,email,password:hashed,role:role||'user',created_at:new Date()
    }]);
    if(error) throw error;

    res.json({ success:true, message:'User registered', data:data[0] });
  } catch(err) {
    console.error(err);
    res.status(500).json({ success:false, message:err.message });
  }
});

// LOGIN
app.post('/api/auth/login', async (req,res) => {
  const { username, password } = req.body;
  if(!username || !password) return res.status(400).json({ success:false, message:'Username & password required' });

  try {
    const { data: users, error } = await supabase.from('users').select('*').eq('username', username);
    if(error) throw error;
    if(!users.length) return res.status(401).json({ success:false, message:'User not found' });

    const user = users[0];
    const valid = await bcrypt.compare(password, user.password);
    if(!valid) return res.status(401).json({ success:false, message:'Invalid password' });

    const token = jwt.sign({ userId: user.id, username:user.username, role:user.role }, process.env.JWT_SECRET||'fallback-secret',{expiresIn:'24h'});
    res.json({ success:true, message:'Login success', data:{ user:{id:user.id, username:user.username, role:user.role}, token } });
  } catch(err) {
    console.error(err);
    res.status(500).json({ success:false, message:err.message });
  }
});

// ==================== BOOKINGS ====================

// GET OCCUPIED SEATS
app.get('/api/bookings/occupied-seats', async (req,res) => {
  const { showtime_id, movie_title } = req.query;
  if(!showtime_id) return res.status(400).json({ success:false, message:'Showtime ID required' });

  try {
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('seat_numbers')
      .eq('showtime_id', showtime_id)
      .eq('movie_title', movie_title)
      .in('status',['confirmed','pending_verification']);
    if(error) throw error;

    const occupiedSeats = new Set();
    bookings.forEach(b => {
      let seats;
      try { seats = JSON.parse(b.seat_numbers); } catch { seats = b.seat_numbers.split(','); }
      if(Array.isArray(seats)) seats.forEach(s => s && occupiedSeats.add(s.trim()));
    });

    res.json({ success:true, data:Array.from(occupiedSeats) });
  } catch(err) {
    console.error(err);
    res.status(500).json({ success:false, message: err.message });
  }
});

// CREATE BOOKING
app.post('/api/bookings', async (req,res) => {
  const { showtime_id, customer_name, customer_email, customer_phone, seat_numbers, total_amount, movie_title } = req.body;
  if(!customer_name || !customer_email || !movie_title || !total_amount || !seat_numbers)
    return res.status(400).json({ success:false, message:'Missing required fields' });

  const booking_reference = `BK${Date.now()}${Math.random().toString(36).substring(2,7).toUpperCase()}`;
  const seatNumbersJson = JSON.stringify(Array.isArray(seat_numbers)?seat_numbers:[seat_numbers]);

  try {
    const { data, error } = await supabase.from('bookings').insert([{
      showtime_id: showtime_id || 1,
      customer_name,
      customer_email,
      customer_phone: customer_phone || '',
      seat_numbers: seatNumbersJson,
      total_amount,
      movie_title,
      booking_reference,
      status: 'pending',
      booking_date: new Date()
    }]);
    if(error) throw error;

    res.json({ success:true, message:'Booking created', data:data[0] });
  } catch(err) {
    console.error(err);
    res.status(500).json({ success:false, message:err.message });
  }
});

// UPLOAD PAYMENT PROOF
app.post('/api/bookings/upload-payment', upload.single('payment_proof'), async (req,res) => {
  const { booking_reference } = req.body;
  if(!req.file || !booking_reference) return res.status(400).json({ success:false, message:'File dan booking_reference diperlukan' });

  const bucketName = 'bukti_pembayaran';
  const fileExt = path.extname(req.file.originalname) || '.jpg';
  const fileName = `${Date.now()}_${Math.random().toString(36).substring(2,8)}${fileExt}`;
  const filePath = `${booking_reference}/${fileName}`;

  try {
    const { error: uploadError } = await supabase.storage.from(bucketName).upload(filePath, req.file.buffer, { contentType:req.file.mimetype, upsert:true });
    if(uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from(bucketName).getPublicUrl(filePath);

    const { error: updateError } = await supabase.from('bookings')
      .update({ payment_proof: publicUrl, payment_filename: req.file.originalname, status:'pending_verification', payment_date: new Date() })
      .eq('booking_reference', booking_reference);
    if(updateError) throw updateError;

    res.json({ success:true, message:'Payment uploaded', data:{ fileURL: publicUrl, fileName:req.file.originalname } });
  } catch(err) {
    console.error(err);
    res.status(500).json({ success:false, message:err.message });
  }
});

// VERIFY BOOKING (ADMIN ONLY)
app.post('/api/bookings/verify', authenticateToken, requireAdmin, async (req,res) => {
  const { booking_reference, is_verified, admin_notes } = req.body;
  if(!booking_reference) return res.status(400).json({ success:false, message:'Booking reference required' });

  try {
    const { error } = await supabase.from('bookings')
      .update({
        is_verified: !!is_verified,
        verified_at: new Date(),
        verified_by: req.user.username,
        status: is_verified?'confirmed':'rejected',
        admin_notes: admin_notes || ''
      })
      .eq('booking_reference', booking_reference);
    if(error) throw error;

    res.json({ success:true, message:'Booking verification updated' });
  } catch(err) {
    console.error(err);
    res.status(500).json({ success:false, message:err.message });
  }
});

// GET BOOKINGS (USER ONLY)
app.get('/api/bookings/my', authenticateToken, async (req,res) => {
  try {
    const { data, error } = await supabase.from('bookings').select('*').eq('customer_email', req.user.username);
    if(error) throw error;

    res.json({ success:true, data });
  } catch(err) {
    console.error(err);
    res.status(500).json({ success:false, message:err.message });
  }
});

// ==================== BUNDLE ORDERS ====================

// CREATE BUNDLE ORDER
app.post('/api/bundles', authenticateToken, async (req,res) => {
  const { bundle_id,bundle_name,bundle_description,bundle_price,original_price,savings,quantity,total_price,customer_name,customer_phone,customer_email } = req.body;
  if(!bundle_name || !bundle_price || !customer_name) return res.status(400).json({ success:false, message:'Missing fields' });

  const order_reference = `BO${Date.now()}${Math.random().toString(36).substring(2,7).toUpperCase()}`;
  try {
    const { data, error } = await supabase.from('bundle_orders').insert([{
      order_reference,bundle_id,bundle_name,bundle_description,bundle_price,original_price,savings,quantity,total_price,
      customer_name,customer_phone,customer_email,status:'pending',order_date:new Date()
    }]);
    if(error) throw error;

    res.json({ success:true, message:'Bundle order created', data:data[0] });
  } catch(err) {
    console.error(err);
    res.status(500).json({ success:false, message:err.message });
  }
});

// GET ALL BUNDLE ORDERS (ADMIN ONLY)
app.get('/api/bundles', authenticateToken, requireAdmin, async (req,res) => {
  try {
    const { data, error } = await supabase.from('bundle_orders').select('*');
    if(error) throw error;
    res.json({ success:true, data });
  } catch(err) {
    console.error(err);
    res.status(500).json({ success:false, message:err.message });
  }
});

// ==================== SERVER START ====================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

export default app;
