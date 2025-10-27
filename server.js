import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from './config/database.js';

const app = express();
app.use(cors());
app.use(express.json());

// ✅ BASIC ROUTES
app.get('/', (req, res) => {
  res.json({ 
    message: 'Cinema Booking API is RUNNING!',
    timestamp: new Date().toISOString(),
    status: 'OK'
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ✅ SIMPLE DATABASE TEST
app.get('/test-db', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    connection.release();
    res.json({ 
      success: true, 
      message: 'Database connection successful!' 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Database connection failed',
      error: error.message 
    });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;