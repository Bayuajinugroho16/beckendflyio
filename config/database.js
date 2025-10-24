import mysql from 'mysql2';
import dotenv from 'dotenv';

dotenv.config();

// ✅ PASTIKAN database yang benar: cinema_booking

// ✅ HARCODE SEMUA CREDENTIALS RAILWAY
const dbConfig = {
  host: 'centerbeam.proxy.rlwy.net',
  port: 41114,  
  user: 'root',
  password: 'uYyExIkZclwyHjudxMMgJeeDLPieicqy',
  database: 'railway',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

console.log('🔌 Database config HARCODED:', {
  host: dbConfig.host,
  port: dbConfig.port,
  database: dbConfig.database
});


// 🔁 Uji koneksi ringan
export const testConnection = () => {
  pool.getConnection((err, connection) => {
    if (err) {
      console.error('❌ Database test connection failed:', err.message);
      return;
    }
    connection.query('SELECT NOW() AS now', (queryErr, results) => {
      if (queryErr) {
        console.error('❌ Test query failed:', queryErr.message);
      } else {
        console.log('✅ Test query successful:', results[0].now);
      }
      connection.release();
    });
  });
};

// 🔄 Tangani error pool agar auto-reconnect
pool.on('error', (err) => {
  console.error('💥 MySQL pool error:', err);
  setTimeout(() => {
    console.log('🔄 Reconnecting to database...');
    testConnection();
  }, 3000);
});

// ✅ Jalankan test otomatis saat startup
if (process.env.NODE_ENV !== 'test') {
  testConnection();
}

export { pool };
