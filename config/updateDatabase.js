const mysql = require('mysql2');
require('dotenv').config();

async function updateDatabase() {
  const connection = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'railway',
    multipleStatements: true
  });

  try {
    console.log('Updating database structure...');

    // Add new columns to bookings table
    await new Promise((resolve, reject) => {
      connection.query(`
        ALTER TABLE bookings 
        ADD COLUMN IF NOT EXISTS qr_code_data TEXT,
        ADD COLUMN IF NOT EXISTS booking_reference VARCHAR(50) UNIQUE,
        ADD COLUMN IF NOT EXISTS verification_code VARCHAR(10),
        ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP NULL;
        
        CREATE INDEX IF NOT EXISTS idx_verification_code ON bookings(verification_code);
        CREATE INDEX IF NOT EXISTS idx_booking_reference ON bookings(booking_reference);
      `, (err) => {
        if (err) reject(err);
        else {
          console.log('✅ Database updated successfully with QR code fields');
          resolve();
        }
      });
    });

  } catch (error) {
    console.error('❌ Database update failed:', error);
  } finally {
    connection.end();
  }
}

updateDatabase();