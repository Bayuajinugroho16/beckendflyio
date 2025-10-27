// generate-password.js
const bcrypt = require('bcryptjs');

const password = 'admin123';
const hashedPassword = bcrypt.hashSync(password, 10);

console.log('Password:', password);
console.log('Hashed Password:', hashedPassword);