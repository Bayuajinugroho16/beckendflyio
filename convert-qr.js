const fs = require('fs');
const path = require('path');

// Function untuk convert image ke base64
function imageToBase64(imagePath) {
  try {
    // Baca file image
    const imageBuffer = fs.readFileSync(imagePath);
    
    // Convert ke base64
    const base64String = imageBuffer.toString('base64');
    
    // Tentukan MIME type
    const ext = path.extname(imagePath).toLowerCase();
    let mimeType = 'image/png'; // default
    
    if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.gif') mimeType = 'image/gif';
    
    // Format base64 data URL
    const base64DataURL = `data:${mimeType};base64,${base64String}`;
    
    console.log('✅ QR Code converted to base64');
    console.log('📏 Length:', base64DataURL.length, 'characters');
    
    // Simpan ke file untuk copy-paste
    fs.writeFileSync('qrcode-base64.txt', base64DataURL);
    console.log('📁 Base64 saved to qrcode-base64.txt');
    
    return base64DataURL;
  } catch (error) {
    console.error('❌ Conversion error:', error.message);
    return null;
  }
}

// Usage: node convert-qr.js path/to/your/gopay-qr.png
const imagePath = process.argv[2];
if (imagePath) {
  imageToBase64(imagePath);
} else {
  console.log('❌ Please provide image path: node convert-qr.js path/to/image.png');
}