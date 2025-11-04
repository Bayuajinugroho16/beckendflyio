import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Input validation helper
const validateInput = (input) => typeof input === 'string' && input.trim().length > 0;

// ================= SIMPLE TEST =================
router.get('/test-simple', (req, res) => {
  console.log('✅ /api/auth/test-simple HIT!');
  res.json({
    success: true,
    message: 'AUTH ROUTES ARE WORKING!',
    timestamp: new Date().toISOString(),
    path: '/api/auth/test-simple'
  });
});

// ================= LOGIN =================
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }

    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .or(`username.eq.${username},email.eq.${username}`)
      .limit(1);

    if (error) throw error;
    if (!users || users.length === 0) return res.status(401).json({ success: false, message: 'Invalid username or password' });

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) return res.status(401).json({ success: false, message: 'Invalid username or password' });

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET || 'bioskop-tiket-secret-key',
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          phone: user.phone,
          role: user.role
        },
        token
      }
    });
  } catch (error) {
    console.error('💥 Login error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ================= ADMIN LOGIN =================
router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password are required' });

    const { data: admins, error } = await supabase
      .from('users')
      .select('*')
      .or(`username.eq.${username},email.eq.${username}`)
      .eq('role', 'admin')
      .limit(1);

    if (error) throw error;
    if (!admins || admins.length === 0) return res.status(401).json({ success: false, message: 'Invalid admin credentials' });

    const admin = admins[0];
    const validPassword = await bcrypt.compare(password, admin.password);

    if (!validPassword) return res.status(401).json({ success: false, message: 'Invalid admin credentials' });

    const token = jwt.sign(
      { userId: admin.id, username: admin.username, role: admin.role, isAdmin: true },
      process.env.JWT_SECRET || 'bioskop-tiket-secret-key',
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'Admin login successful',
      data: {
        user: {
          id: admin.id,
          username: admin.username,
          email: admin.email,
          role: admin.role
        },
        token
      }
    });
  } catch (error) {
    console.error('💥 Admin login error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ================= REGISTER =================
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, phone } = req.body;

    if (!validateInput(username) || !validateInput(password) || !validateInput(phone)) {
      return res.status(400).json({ success: false, message: 'Username, password, dan nomor telepon harus diisi' });
    }

    const userEmail = email && email.trim() !== '' ? email.trim() : `${username}@no-email.com`;
    if (password.length < 6) return res.status(400).json({ success: false, message: 'Password harus minimal 6 karakter' });

    const { data: existingUsers, error: checkError } = await supabase
      .from('users')
      .select('id')
      .or(`username.eq.${username},email.eq.${userEmail}`);

    if (checkError) throw checkError;
    if (existingUsers && existingUsers.length > 0) return res.status(409).json({ success: false, message: 'Username atau email sudah digunakan' });

    const hashedPassword = await bcrypt.hash(password, 10);

    const { data: insertedUser, error: insertError } = await supabase
      .from('users')
      .insert([{ username: username.trim(), email: userEmail, password: hashedPassword, phone: phone.trim(), role: 'user' }])
      .select()
      .single();

    if (insertError) throw insertError;

    res.status(201).json({
      success: true,
      message: 'Registrasi berhasil! Silakan login.',
      data: { user: insertedUser }
    });

  } catch (error) {
    console.error('💥 Registration error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ================= CREATE NEW ADMIN =================
router.post('/admin/create-new', async (req, res) => {
  try {
    const { username = 'superadmin', password = 'admin123' } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);

    // Delete old admin if exists
    await supabase.from('users').delete().eq('username', username).eq('role', 'admin');

    // Insert new admin
    const { data: insertedAdmin, error } = await supabase
      .from('users')
      .insert([{ username, email: `${username}@cinema.com`, password: hashedPassword, role: 'admin' }])
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'New admin created successfully',
      credentials: { username, password, id: insertedAdmin.id }
    });

  } catch (error) {
    console.error('💥 Create admin error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ================= LIST ADMINS =================
router.get('/admin/check', async (req, res) => {
  try {
    const { data: admins, error } = await supabase
      .from('users')
      .select('id, username, email, role, created_at')
      .eq('role', 'admin');

    if (error) throw error;

    res.json({ success: true, data: { adminCount: admins.length, admins } });
  } catch (error) {
    console.error('Check admin error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
