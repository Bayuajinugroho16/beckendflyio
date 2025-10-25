const mysql = require('mysql2');
require('dotenv').config();

async function initializeDatabase() {
  let connection;
  
  try {
    // Connect to MySQL without selecting database
    connection = mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || ''
    });

    console.log('Connected to MySQL server');

    // Create database if not exists
    await new Promise((resolve, reject) => {
      connection.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME || 'railway'}`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    console.log('Database created or already exists');

    // Close connection and reconnect to specific database
    connection.end();
    
    connection = mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'railway',
      multipleStatements: true
    });

    // Create movies table
    await new Promise((resolve, reject) => {
      connection.query(`
        CREATE TABLE IF NOT EXISTS movies (
          id INT AUTO_INCREMENT PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          duration INT NOT NULL,
          genre VARCHAR(100),
          rating VARCHAR(10),
          poster_url VARCHAR(500),
          trailer_url VARCHAR(500),
          release_date DATE,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) reject(err);
        else {
          console.log('Movies table created');
          resolve();
        }
      });
    });

    // Create theaters table
    await new Promise((resolve, reject) => {
      connection.query(`
        CREATE TABLE IF NOT EXISTS theaters (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          capacity INT NOT NULL,
          location VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) reject(err);
        else {
          console.log('Theaters table created');
          resolve();
        }
      });
    });

    // Create showtimes table
    await new Promise((resolve, reject) => {
      connection.query(`
        CREATE TABLE IF NOT EXISTS showtimes (
          id INT AUTO_INCREMENT PRIMARY KEY,
          movie_id INT NOT NULL,
          theater_id INT NOT NULL,
          start_time DATETIME NOT NULL,
          end_time DATETIME NOT NULL,
          price DECIMAL(10,2) NOT NULL,
          available_seats INT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE,
          FOREIGN KEY (theater_id) REFERENCES theaters(id) ON DELETE CASCADE
        )
      `, (err) => {
        if (err) reject(err);
        else {
          console.log('Showtimes table created');
          resolve();
        }
      });
    });

    // Create bookings table - VERSION BARU dengan QR Code
    await new Promise((resolve, reject) => {
      connection.query(`
        CREATE TABLE IF NOT EXISTS bookings (
          id INT AUTO_INCREMENT PRIMARY KEY,
          showtime_id INT NOT NULL,
          customer_name VARCHAR(100) NOT NULL,
          customer_email VARCHAR(255) NOT NULL,
          total_amount DECIMAL(10,2) NOT NULL,
          seat_numbers JSON NOT NULL,
          booking_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          status ENUM('pending', 'confirmed', 'cancelled') DEFAULT 'confirmed',
          qr_code_data TEXT,
          booking_reference VARCHAR(50) UNIQUE,
          verification_code VARCHAR(10),
          is_verified BOOLEAN DEFAULT FALSE,
          verified_at TIMESTAMP NULL,
          FOREIGN KEY (showtime_id) REFERENCES showtimes(id) ON DELETE CASCADE
        )
      `, (err) => {
        if (err) reject(err);
        else {
          console.log('Bookings table created with QR code fields');
          resolve();
        }
      });
    });

    // Insert sample data
    await insertSampleData(connection);
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash('admin123', 10);

    await connection.query(
        "INSERT IGNORE INTO users (username, email, password, phone, role) VALUES ('admin', 'admin@cinema.com', ?, '080012345678', 'admin')",
        [hashedPassword]
    );

    console.log('✅ Sample admin user inserted (Username: admin, Pass: admin123)');
    
    console.log('✅ Database initialization completed successfully!');

  } catch (error) {
    console.error('❌ Database initialization failed:', error);
  } finally {
    if (connection) {
      connection.end();
    }
  }
}

async function insertSampleData(connection) {
  // Insert sample movies
  const movies = [
    {
      title: 'Avengers: Endgame',
      description: 'The epic conclusion to the Infinity Saga',
      duration: 181,
      genre: 'Action, Adventure, Sci-Fi',
      rating: 'PG-13',
      poster_url: 'https://via.placeholder.com/300x450/1a2a6c/ffffff?text=Avengers',
      release_date: '2019-04-26'
    },
    {
      title: 'Spider-Man: No Way Home',
      description: 'Spider-Man teams up with other versions of himself',
      duration: 148,
      genre: 'Action, Adventure, Sci-Fi',
      rating: 'PG-13',
      poster_url: 'https://via.placeholder.com/300x450/b21f1f/ffffff?text=Spider-Man',
      release_date: '2021-12-17'
    },
    {
      title: 'Dune: Part Two',
      description: 'Paul Atreides continues his journey on Arrakis',
      duration: 166,
      genre: 'Sci-Fi, Adventure',
      rating: 'PG-13',
      poster_url: 'https://via.placeholder.com/300x450/fdbb2d/333333?text=Dune+2',
      release_date: '2024-03-01'
    }
  ];

  for (const movie of movies) {
    await new Promise((resolve, reject) => {
      connection.query(
        'INSERT IGNORE INTO movies (title, description, duration, genre, rating, poster_url, release_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [movie.title, movie.description, movie.duration, movie.genre, movie.rating, movie.poster_url, movie.release_date],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }
  console.log('Sample movies inserted');

  // Insert sample theaters
  const theaters = [
    { name: 'Theater 1', capacity: 50, location: 'Lantai 1' },
    { name: 'Theater 2', capacity: 60, location: 'Lantai 1' },
    { name: 'Theater 3', capacity: 40, location: 'Lantai 2' }
  ];

  for (const theater of theaters) {
    await new Promise((resolve, reject) => {
      connection.query(
        'INSERT IGNORE INTO theaters (name, capacity, location) VALUES (?, ?, ?)',
        [theater.name, theater.capacity, theater.location],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }
  console.log('Sample theaters inserted');

  // Insert sample showtimes
  const showtimes = [
    {
      movie_id: 1,
      theater_id: 1,
      start_time: '2024-01-20 10:00:00',
      end_time: '2024-01-20 13:01:00',
      price: 45000,
      available_seats: 50
    },
    {
      movie_id: 1,
      theater_id: 2,
      start_time: '2024-01-20 13:00:00',
      end_time: '2024-01-20 16:01:00',
      price: 45000,
      available_seats: 60
    },
    {
      movie_id: 2,
      theater_id: 1,
      start_time: '2024-01-20 16:00:00',
      end_time: '2024-01-20 18:28:00',
      price: 50000,
      available_seats: 50
    }
  ];

  for (const showtime of showtimes) {
    await new Promise((resolve, reject) => {
      connection.query(
        'INSERT IGNORE INTO showtimes (movie_id, theater_id, start_time, end_time, price, available_seats) VALUES (?, ?, ?, ?, ?, ?)',
        [showtime.movie_id, showtime.theater_id, showtime.start_time, showtime.end_time, showtime.price, showtime.available_seats],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }
  console.log('Sample showtimes inserted');
}

// Only run if called directly
if (require.main === module) {
  initializeDatabase();
}

module.exports = { initializeDatabase };