// server-emergency.js - SUPER SIMPLE VERSION
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import bookingRoutes from './routes/bookings.js';
import { pool } from './config/database.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/bookings', bookingRoutes);
console.log('✅ Bookings routes registered');

// ✅ SUPER SIMPLE AUTH ROUTES
app.post('/api/auth/login', async (req, res) => {
  try {
    console.log('🔐 Login attempt:', req.body);
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password required' });
    }

    const connection = await pool.promise().getConnection();
    const [users] = await connection.execute(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );
    connection.release();

    if (users.length === 0) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ success: false, message: 'Invalid password' });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role
        },
        token
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ✅ SIMPLE ADMIN RESET
app.post('/api/auth/admin/reset-password', async (req, res) => {
  try {
    const connection = await pool.promise().getConnection();
    const hashedPassword = await bcrypt.hash('admin123', 10);
    
    const [result] = await connection.execute(
      'UPDATE users SET password = ? WHERE username = "admin"',
      [hashedPassword]
    );
    
    connection.release();

    res.json({
      success: true,
      message: 'Admin password reset to: admin123',
      affectedRows: result.affectedRows
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ✅ SIMPLE ADMIN CHECK
app.get('/api/auth/admin/check', async (req, res) => {
  try {
    const connection = await pool.promise().getConnection();
    const [admins] = await connection.execute('SELECT * FROM users WHERE role = "admin"');
    connection.release();

    res.json({
      success: true,
      data: {
        adminCount: admins.length,
        admins: admins.map(a => ({ id: a.id, username: a.username, role: a.role }))
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ✅ BASIC ROUTES
app.get('/', (req, res) => {
  res.json({ message: 'Emergency Server Running!', status: 'OK' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚨 Emergency server running on port ${PORT}`);
});

export default app;