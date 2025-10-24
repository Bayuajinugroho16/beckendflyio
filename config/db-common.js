// config/db-common.js
const mysql = require('mysql2');

console.log('🔌 Loading db-common.js - CommonJS version');

const pool = mysql.createPool({
  host: 'centerbeam.proxy.rlwy.net',
  port: 41114,  
  user: 'root',
  password: 'uYyExIkZclwyHjudxMMgJeeDLPieicqy',
  database: 'railway',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

console.log('✅ Database pool created with Railway credentials');

module.exports = { pool };