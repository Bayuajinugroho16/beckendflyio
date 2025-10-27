# BackendCinema# 🎬 Backend Cinema - Bioskop Tiket System

Backend API untuk sistem pemesanan tiket bioskop yang powerful dan real-time.

## 🚀 Fitur Utama

- ✅ **Booking System** - Pemesanan kursi bioskop
- ✅ **Real-time Seats** - Update kursi terisi secara real-time  
- ✅ **User Authentication** - Login/register dengan JWT
- ✅ **Payment Integration** - Sistem konfirmasi pembayaran
- ✅ **QR Code Tickets** - Tiket digital dengan QR code
- ✅ **Admin Dashboard** - Management booking dan user
- ✅ **MySQL Database** - Data persisten dan reliable

## 🛠️ Teknologi

- **Backend**: Node.js, Express.js
- **Database**: MySQL dengan MySQL2 driver
- **Authentication**: JWT (JSON Web Tokens)
- **Security**: bcryptjs untuk password hashing
- **CORS**: Enable cross-origin requests

## 📦 Installation

```bash
# Clone repository
git clone https://github.com/Bayuajinugroho16/BackendCinema.git

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env

# Start development server
npm run dev