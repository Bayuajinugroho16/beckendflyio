import mysql from 'mysql2';
import dotenv from 'dotenv';

dotenv.config();

// ✅ PASTIKAN database yang benar: cinema_booking

const dbConfig = {
  host: process.env.MYSQLHOST || 'localhost',
  port: process.env.MYSQLPORT || 3306,
  user: process.env.MYSQLUSER || 'root',
  password: process.env.MYSQLPASSWORD || '',
  database: process.env.MYSQLDATABASE || 'cinema_booking'
};
// const dbConfig = {
//   host: process.env.DB_HOST || 'localhost',
//   port: process.env.DB_PORT || 3306,
//   user: process.env.DB_USER || 'root',
//   password: process.env.DB_PASSWORD || '',
//   database: process.env.DB_NAME || 'cinema_booking', // ✅ INI YANG PENTING!
//   waitForConnections: true,
//   connectionLimit: 10,
//   queueLimit: 0,
//   charset: 'utf8mb4',
//   timezone: '+07:00' // Sesuaikan dengan timezone Anda
// };
const pool = mysql.createPool(dbConfig);

// 🔍 Log koneksi awal
pool.getConnection((err, connection) => { 
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    console.table({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      database: dbConfig.database,
    });
  } else {
    console.log('✅ Connected to MySQL database');
    console.log(`📊 Database: ${dbConfig.database}`);
    console.log(`🌐 Host: ${dbConfig.host}:${dbConfig.port}`);
    connection.release();
  }
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
