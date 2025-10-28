import express from 'express';
import multer from 'multer';
import { pool } from '../config/database.js';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

// ================== SUPABASE CONFIG ==================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ================== MULTER (MEMORY STORAGE) ==================
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Hanya file gambar yang diperbolehkan'), false);
  }
});

// ================== 1️⃣ CREATE BUNDLE ORDER ==================
router.post('/create', async (req, res) => {
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
      customer_email
    } = req.body;

    if (!bundle_id || !bundle_name || !customer_name)
      return res.status(400).json({ success: false, message: 'Data tidak lengkap.' });

    const order_reference = `BUNDLE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    await pool
      .promise()
      .execute(
        `INSERT INTO bundle_orders 
         (order_reference, bundle_id, bundle_name, bundle_description, bundle_price, original_price, savings, quantity, total_price, customer_name, customer_phone, customer_email, status, order_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW(), NOW())`,
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
          customer_email
        ]
      );

    res.json({
      success: true,
      message: 'Pesanan bundle berhasil dibuat. Silakan upload bukti pembayaran.',
      order_reference
    });
  } catch (error) {
    console.error('❌ Error create bundle order:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ================== 2️⃣ UPLOAD BUKTI PEMBAYARAN ==================
router.post('/upload-payment', upload.single('paymentProof'), async (req, res) => {
  try {
    const { order_reference } = req.body;
    const file = req.file;

    if (!file)
      return res.status(400).json({ success: false, message: 'File bukti pembayaran tidak ditemukan' });

    const ext = file.originalname.split('.').pop();
    const fileName = `bundle-${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`;
    const filePath = `bundle-payments/${fileName}`;

    // Upload ke Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('payment_proofs')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true
      });

    if (uploadError) throw uploadError;

    // Ambil URL publik
    const { data: publicData } = supabase.storage
      .from('payment_proofs')
      .getPublicUrl(filePath);

    const paymentUrl = publicData.publicUrl;

    // Update ke database
    await pool
      .promise()
      .execute(
        `UPDATE bundle_orders
         SET payment_proof = ?, status = 'waiting_verification', updated_at = NOW()
         WHERE order_reference = ?`,
        [paymentUrl, order_reference]
      );

    res.json({
      success: true,
      message: 'Bukti pembayaran berhasil diupload. Silakan hubungi admin untuk verifikasi dalam 10 menit.',
      payment_url: paymentUrl
    });
  } catch (error) {
    console.error('❌ Upload payment proof error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Gagal upload bukti pembayaran'
    });
  }
});

// ================== 3️⃣ GET ORDER DETAIL ==================
router.get('/:order_reference', async (req, res) => {
  try {
    const { order_reference } = req.params;

    const [rows] = await pool
      .promise()
      .execute('SELECT * FROM bundle_orders WHERE order_reference = ?', [order_reference]);

    if (rows.length === 0)
      return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('❌ Error get bundle order:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ================== 4️⃣ ADMIN VERIFICATION (opsional endpoint admin) ==================
router.put('/verify/:order_reference', async (req, res) => {
  try {
    const { order_reference } = req.params;

    await pool
      .promise()
      .execute(
        `UPDATE bundle_orders 
         SET status = 'confirmed', updated_at = NOW() 
         WHERE order_reference = ?`,
        [order_reference]
      );

    res.json({
      success: true,
      message: `Order ${order_reference} berhasil dikonfirmasi.`
    });
  } catch (error) {
    console.error('❌ Verify order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
