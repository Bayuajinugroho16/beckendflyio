const express = require('express');
const router = express.Router();

// ✅ SIMPLE VERSION - tanpa database dulu
router.get('/', async (req, res) => {
  console.log('🎬 Fetching movies...');
  
  try {
    // Data movies sementara (tanpa database)
    const movies = [
      {
        id: 1,
        title: "Layar Kompetisi 1",
        genre: "",
        duration: "",
        showtimes: ["10:00", "14:00", "18:00", "21:00"],
        price: 50000,
        poster: "/film/layar1.png"
      },
      {
        id: 2,
        title: "Layar Kompetisi 2", 
        genre: "",
        duration: "",
        showtimes: ["11:00", "15:00", "19:00", "22:00"],
        price: 45000,
        poster: "/film/layar2.png"
      },
      {
        id: 3,
        title: "Layar Kompetisi 3",
        genre: "",
        duration: "",
        showtimes: ["12:00", "16:00", "20:00"],
        price: 48000,
        poster: "/film/layar3.png"
      },
      {
        id: 4,
        title: "Layar Kompetisi 4",
        genre: "", 
        duration: "",
        showtimes: ["13:00", "17:00", "20:30"],
        price: 52000,
        poster: "/film/layar4.png"
      }
    ];

    console.log('✅ Sending', movies.length, 'movies');

    res.json({
      success: true,
      data: movies,
      total: movies.length,
      message: "Movies retrieved successfully"
    });

  } catch (error) {
    console.error('❌ Movies error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch movies',
      error: error.message
    });
  }
});

// GET movie by ID
router.get('/:id', (req, res) => {
  const movies = [
    {
      id: 1,
      title: "Avengers: Endgame",
      genre: "Action",
      duration: "3h 1m",
      showtimes: ["10:00", "14:00", "18:00"],
      price: 50000,
      poster: "/images/movie1.jpg"
    }
  ];

  const movie = movies.find(m => m.id === parseInt(req.params.id));
  
  if (!movie) {
    return res.status(404).json({
      success: false,
      message: 'Movie not found'
    });
  }

  res.json({
    success: true,
    data: movie
  });
});

module.exports = router;