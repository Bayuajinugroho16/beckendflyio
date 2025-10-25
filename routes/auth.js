import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../config/database.js'; // ✅ .js extension

const router = express.Router();

const mysql = require('mysql2');



// Input validation helper
const validateInput = (input) => {
  return typeof input === 'string' && input.trim().length > 0;
};

// User Login - OPTIMIZED VERSION
router.post('/login', async (req, res) => {
  let connection;
  
  try {
    console.log('🔍 DEBUG: Request body received:', req.body);
    console.log('🔍 DEBUG: Headers:', req.headers);
    
    const { username, password } = req.body;
    
    // ✅ Validasi input
    if (!validateInput(username) || !validateInput(password)) {
      console.log('❌ DEBUG: Validation failed');
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }
    
    console.log('🔐 DEBUG: Login attempt for:', username);
    
    // ✅ Test database connection
    connection = await pool.promise().getConnection();
    console.log('✅ DEBUG: Database connected successfully');
    
    // ✅ Find user
    const [users] = await connection.execute(
      'SELECT id, username, email, password, role, phone FROM users WHERE username = ? OR email = ?',
      [username.trim(), username.trim()]
    );
    
    console.log(`🔍 DEBUG: Users found: ${users.length}`);
    
    if (users.length === 0) {
      console.log('❌ DEBUG: User not found');
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }
    
    const user = users[0];
    console.log('✅ DEBUG: User found - ID:', user.id, 'Username:', user.username);
    console.log('🔍 DEBUG: Password in DB:', user.password ? 'Exists' : 'Missing');
    console.log('🔍 DEBUG: Password length:', user.password?.length);
    
    // ✅ Password validation
    let validPassword = false;
    const isLikelyHashed = user.password.length === 60 && user.password.startsWith('$2');
    
    console.log('🔍 DEBUG: Password type:', isLikelyHashed ? 'Hashed' : 'Plain text');
    
    if (isLikelyHashed) {
      validPassword = await bcrypt.compare(password, user.password);
      console.log('🔐 DEBUG: Bcrypt comparison result:', validPassword);
    } else {
      validPassword = (password === user.password);
      console.log('🔓 DEBUG: Plain text comparison result:', validPassword);
      
      // Auto-upgrade jika plain text
      if (validPassword) {
        console.log('🔄 DEBUG: Auto-upgrading plain text password...');
        const hashedPassword = await bcrypt.hash(password, 10);
        await connection.execute(
          'UPDATE users SET password = ? WHERE id = ?',
          [hashedPassword, user.id]
        );
        console.log('✅ DEBUG: Password upgraded to hash');
      }
    }
    
    if (!validPassword) {
      console.log('❌ DEBUG: Password invalid');
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }
    
    // ✅ Generate token
    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username,
        role: user.role 
      },
      process.env.JWT_SECRET || 'bioskop-tiket-secret-key',
      { expiresIn: '7d' }
    );
    
    console.log('🎉 DEBUG: Login successful, token generated');
    
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
    console.error('💥 DEBUG: Login error details:', error);
    console.error('💥 DEBUG: Error stack:', error.stack);
    
    // ✅ Berikan info error yang lebih spesifik
    res.status(500).json({
      success: false,
      message: `Login error: ${error.message}`,
      // Hapus detail ini di production
      debug: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    if (connection) {
      connection.release();
      console.log('🔗 DEBUG: Database connection released');
    }
  }
});


// ✅ ADMIN LOGIN ENDPOINT - TERPISAH DARI USER LOGIN
router.post('/admin/login', async (req, res) => {
  let connection;
  
  try {
    console.log('🔐 ADMIN LOGIN ATTEMPT:', req.body);
    
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }
    
    connection = await pool.promise().getConnection();
    
    // ✅ KHUSUS CARI ADMIN SAJA
    const [admins] = await connection.execute(
      'SELECT id, username, email, password, role FROM users WHERE (username = ? OR email = ?) AND role = "admin"',
      [username.trim(), username.trim()]
    );
    
    console.log(`🔍 ADMIN USERS FOUND: ${admins.length}`);
    
    if (admins.length === 0) {
      console.log('❌ ADMIN NOT FOUND OR NOT ADMIN ROLE:', username);
      return res.status(401).json({
        success: false,
        message: 'Invalid admin credentials'
      });
    }
    
    const admin = admins[0];
    console.log('✅ ADMIN FOUND:', { 
      id: admin.id, 
      username: admin.username, 
      role: admin.role 
    });
    console.log('🔍 PASSWORD HASH:', admin.password.substring(0, 20) + '...');
    
    // ✅ VERIFY PASSWORD
    const validPassword = await bcrypt.compare(password, admin.password);
    console.log('🔐 PASSWORD VALID:', validPassword);
    
    if (!validPassword) {
      // ✅ FALLBACK: Coba password plain text (untuk development)
      if (password === 'admin123') {
        console.log('🔄 USING FALLBACK PASSWORD');
        
        // Hash ulang password ke bcrypt
        const hashedPassword = await bcrypt.hash('admin123', 10);
        await connection.execute(
          'UPDATE users SET password = ? WHERE id = ?',
          [hashedPassword, admin.id]
        );
        console.log('✅ PASSWORD UPDATED TO BCRYPT');
      } else {
        return res.status(401).json({
          success: false,
          message: 'Invalid admin credentials'
        });
      }
    }
    
    // ✅ GENERATE ADMIN TOKEN
    const token = jwt.sign(
      { 
        userId: admin.id, 
        username: admin.username,
        role: admin.role,
        isAdmin: true 
      },
      process.env.JWT_SECRET || 'bioskop-tiket-secret-key',
      { expiresIn: '24h' }
    );
    
    console.log('🎉 ADMIN LOGIN SUCCESSFUL');
    
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
    console.error('💥 ADMIN LOGIN ERROR:', error);
    res.status(500).json({
      success: false,
      message: `Admin login error: ${error.message}`
    });
  } finally {
    if (connection) connection.release();
  }
});

// ✅ DEBUG ADMIN USERS ENDPOINT
router.get('/admin/debug', async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    
    const [admins] = await connection.execute(
      'SELECT id, username, email, role, LENGTH(password) as pass_length, LEFT(password, 20) as password_preview FROM users WHERE role = "admin"'
    );
    
    const [allUsers] = await connection.execute(
      'SELECT COUNT(*) as total_users FROM users'
    );
    
    console.log('🔍 ADMIN DEBUG - Found:', admins.length, 'admins');
    
    res.json({
      success: true,
      data: {
        totalUsers: allUsers[0].total_users,
        adminCount: admins.length,
        admins: admins,
        jwtSecret: process.env.JWT_SECRET ? 'SET' : 'NOT SET'
      }
    });
    
  } catch (error) {
    console.error('💥 ADMIN DEBUG ERROR:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  } finally {
    if (connection) connection.release();
  }
});

router.post('/register', async (req, res) => {
  let connection;
  
  try {
    const { username, email, password, phone } = req.body;
    
    console.log('📝 Registration attempt for:', username);
    console.log('📧 Email received:', email); // Debug
    
    // ✅ VALIDASI - TANPA EMAIL VALIDATION
    if (!validateInput(username) || !validateInput(password) || !validateInput(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Username, password, dan nomor telepon harus diisi'
      });
    }
    
    // ✅ EMAIL BENAR-BENAR OPTIONAL - NO VALIDATION
    const userEmail = email && email.trim() !== '' ? email.trim() : `${username}@no-email.com`;
   
    
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password harus minimal 6 karakter'
      });
    }
    
    connection = await pool.promise().getConnection();
    
    await connection.beginTransaction();
    
    try {
      const [existingUsers] = await connection.execute(
        'SELECT id FROM users WHERE username = ? OR email = ?',
        [username.trim(), userEmail]
      );
      
      if (existingUsers.length > 0) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: 'Username atau email sudah digunakan'
        });
      }
      
      const hashedPassword = await bcrypt.hash(password, 10);
      
      const [result] = await connection.execute(
        'INSERT INTO users (username, email, password, phone, role) VALUES (?, ?, ?, ?, ?)',
        [username.trim(), userEmail, hashedPassword, phone.trim(), 'user']
      );
      
      await connection.commit();
      
      console.log('✅ User registered successfully:', username);
      
      res.status(201).json({
        success: true,
        message: 'Registrasi berhasil! Silakan login.',
        data: {
          user: {
            id: result.insertId,
            username: username.trim(),
            email: userEmail,
            phone: phone.trim(),
            role: 'user'
          }
        }
      });
      
    } catch (transactionError) {
      await connection.rollback();
      throw transactionError;
    }
    
  } catch (error) {
    console.error('💥 Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registrasi gagal: ' + error.message
    });
  } finally {
    if (connection) connection.release();
  }
});

router.get('/test-connection', async (req, res) => {
  try {
    const connection = await pool.promise().getConnection();
    const [result] = await connection.execute('SELECT 1 as test, NOW() as time');
    connection.release();
    
    res.json({
      success: true,
      message: 'Database connected DIRECTLY from auth.js!',
      data: result[0],
      config: {
        host: 'centerbeam.proxy.rlwy.net',
        port: 41114,
        database: 'railway'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
module.exports = router;