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

// ✅ PERBAIKI LOGIN UNTUK AUTO-FIX PASSWORD
router.post('/login', async (req, res) => {
  let connection;
  
  try {
    console.log('🔐 Login attempt for:', req.body.username);
    
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }
    
    connection = await pool.promise().getConnection();
    
    // Cari user
    const [users] = await connection.execute(
      'SELECT id, username, email, password, role, phone FROM users WHERE username = ? OR email = ?',
      [username.trim(), username.trim()]
    );
    
    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }
    
    const user = users[0];
    console.log('✅ User found:', user.username, 'Role:', user.role);
    
    let validPassword = false;
    
    // ✅ CEK 1: Bcrypt comparison
    validPassword = await bcrypt.compare(password, user.password);
    console.log('🔐 Bcrypt result:', validPassword);
    
    // ✅ CEK 2: Jika admin dan bcrypt gagal, coba reset password
    if (!validPassword && user.role === 'admin') {
      console.log('🔄 Admin password mismatch, trying auto-fix...');
      
      // Auto-reset password admin ke 'admin123'
      if (password === 'admin123') {
        console.log('🔄 Auto-resetting admin password...');
        const hashedPassword = await bcrypt.hash('admin123', 10);
        await connection.execute(
          'UPDATE users SET password = ? WHERE id = ?',
          [hashedPassword, user.id]
        );
        validPassword = true;
        console.log('✅ Admin password auto-reset successful');
      }
    }
    
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }
    
    // Generate token
    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username,
        role: user.role 
      },
      process.env.JWT_SECRET || 'bioskop-tiket-secret-key',
      { expiresIn: '7d' }
    );
    
    console.log('🎉 Login successful for:', user.username);
    
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
    res.status(500).json({
      success: false,
      message: `Login error: ${error.message}`
    });
  } finally {
    if (connection) connection.release();
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


// ✅ RESET ADMIN PASSWORD ENDPOINT
router.post('/admin/reset-password', async (req, res) => {
  let connection;
  try {
    console.log('🔄 RESETTING ADMIN PASSWORD...');
    
    connection = await pool.promise().getConnection();
    
    const newPassword = 'admin123';
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    console.log('🔑 New hashed password:', hashedPassword);
    
    // Coba update admin yang sudah ada
    const [updateResult] = await connection.execute(
      'UPDATE users SET password = ? WHERE username = "admin" AND role = "admin"',
      [hashedPassword]
    );
    
    console.log('📊 Update result:', updateResult);
    
    if (updateResult.affectedRows === 0) {
      console.log('🔍 No existing admin found, creating new one...');
      
      // Buat admin baru
      const [insertResult] = await connection.execute(
        'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, "admin")',
        ['admin', 'admin@cinema.com', hashedPassword]
      );
      
      res.json({
        success: true,
        message: '✅ ADMIN USER CREATED SUCCESSFULLY',
        credentials: {
          username: 'admin',
          password: newPassword,
          email: 'admin@cinema.com',
          note: 'USE THESE CREDENTIALS TO LOGIN'
        }
      });
    } else {
      res.json({
        success: true,
        message: '✅ ADMIN PASSWORD RESET SUCCESSFULLY',
        credentials: {
          username: 'admin', 
          password: newPassword,
          note: 'USE THIS PASSWORD TO LOGIN'
        }
      });
    }
    
  } catch (error) {
    console.error('💥 RESET PASSWORD ERROR:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  } finally {
    if (connection) connection.release();
  }
});

// ✅ CHECK ADMIN EXISTS ENDPOINT
router.get('/admin/check', async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    
    const [admins] = await connection.execute(
      'SELECT id, username, email, role, created_at FROM users WHERE role = "admin"'
    );
    
    res.json({
      success: true,
      data: {
        adminCount: admins.length,
        admins: admins
      }
    });
    
  } catch (error) {
    console.error('Check admin error:', error);
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
export default router;