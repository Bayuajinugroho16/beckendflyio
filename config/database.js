import mysql from 'mysql2';
import dotenv from 'dotenv';

dotenv.config();

const dbConfig = {
    // 👇 Menggunakan Environment Variables dari proses.env
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// ... kode lainnya tetap sama
const pool = mysql.createPool(dbConfig);

console.log('🔌 Database config loaded:', {
  host: dbConfig.host,
  port: dbConfig.port,
  database: dbConfig.database,
  // Tambahkan ini untuk memverifikasi apakah kita sedang menggunakan ENVs
  source: process.env.DB_HOST ? 'ENV_VARS' : 'HARDCODED'
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