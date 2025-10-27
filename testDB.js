const { pool, testConnection } = require('./config/database');

console.log('🔄 Testing database connection...');
testConnection();

// Test dengan query sederhana
setTimeout(async () => {
  try {
    const connection = await pool.promise().getConnection();
    console.log('🔍 Testing database query...');
    
    const [rows] = await connection.execute('SELECT 1 + 1 AS result');
    console.log('✅ Database query test result:', rows[0].result);
    
    connection.release();
    console.log('🎉 Database test completed successfully!');
  } catch (error) {
    console.error('❌ Database query test failed:', error.message);
  }
}, 1000);