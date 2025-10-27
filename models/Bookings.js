import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema({
  showtime: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Showtime',
    required: [true, 'Showtime is required']
  },
  customer_name: {
    type: String,
    required: [true, 'Customer name is required'],
    trim: true,
    maxlength: 100
  },
  customer_email: {
    type: String,
    required: [true, 'Customer email is required'],
    trim: true,
    lowercase: true,
    maxlength: 255
  },
  customer_phone: {
    type: String,
    trim: true,
    maxlength: 20
  },
  total_amount: {
    type: Number,
    required: [true, 'Total amount is required'],
    min: 0
  },
  seat_numbers: {
    type: [String], // Array of seat numbers
    required: [true, 'At least one seat is required'],
    validate: {
      validator: function(seats) {
        return seats && seats.length > 0;
      },
      message: 'At least one seat must be selected'
    }
  },
  booking_date: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled', 'completed'],
    default: 'pending'
  },
  qr_code_data: {
    type: String,
    trim: true
  },
  booking_reference: {
    type: String,
    unique: true,
    trim: true,
    maxlength: 50,
    sparse: true
  },
  verification_code: {
    type: String,
    trim: true,
    maxlength: 10,
    uppercase: true
  },
  is_verified: {
    type: Boolean,
    default: false
  },
  verified_at: {
    type: Date
  },
  movie_title: {
    type: String,
    trim: true,
    maxlength: 255
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  payment_proof: {
    type: String,
    trim: true,
    maxlength: 255
  },
  payment_status: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending'
  },
  payment_date: {
    type: Date
  },
  payment_method: {
    type: String,
    trim: true,
    maxlength: 50
  },
  order_type: {
    type: String,
    enum: ['movie', 'bundle'],
    default: 'movie'
  },
  bundle_id: {
    type: Number
  },
  bundle_name: {
    type: String,
    trim: true,
    maxlength: 255
  },
  bundle_description: {
    type: String,
    trim: true
  },
  original_price: {
    type: Number,
    min: 0
  },
  savings: {
    type: Number,
    min: 0
  },
  quantity: {
    type: Number,
    default: 1,
    min: 1
  }
}, {
  timestamps: true // This will create createdAt and updatedAt automatically
});

// Indexes for better query performance
bookingSchema.index({ showtime: 1 });
bookingSchema.index({ customer_email: 1 });
bookingSchema.index({ booking_reference: 1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ payment_status: 1 });
bookingSchema.index({ booking_date: -1 });
bookingSchema.index({ user: 1 });

// Virtual for calculating net price (for bundle orders)
bookingSchema.virtual('net_price').get(function() {
  if (this.order_type === 'bundle' && this.original_price && this.savings) {
    return this.original_price - this.savings;
  }
  return this.total_amount;
});

// Pre-save middleware to generate booking reference
bookingSchema.pre('save', async function(next) {
  if (!this.booking_reference) {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    this.booking_reference = `BK-${timestamp}-${random}`.toUpperCase();
  }
  
  if (this.isModified('is_verified') && this.is_verified && !this.verified_at) {
    this.verified_at = new Date();
  }
  
  if (this.isModified('payment_status') && this.payment_status === 'paid' && !this.payment_date) {
    this.payment_date = new Date();
  }
  
  next();
});

// Static method to find pending bookings
bookingSchema.statics.findPending = function() {
  return this.find({ status: 'pending' });
};

// Static method to find by customer email
bookingSchema.statics.findByCustomerEmail = function(email) {
  return this.find({ customer_email: email.toLowerCase() }).sort({ booking_date: -1 });
};

// Instance method to confirm booking
bookingSchema.methods.confirm = function() {
  this.status = 'confirmed';
  if (this.payment_status === 'pending') {
    this.payment_status = 'paid';
    this.payment_date = new Date();
  }
  return this.save();
};

// Instance method to cancel booking
bookingSchema.methods.cancel = function() {
  this.status = 'cancelled';
  return this.save();
};

// Instance method to verify booking
bookingSchema.methods.verify = function(code) {
  if (this.verification_code === code) {
    this.is_verified = true;
    this.verified_at = new Date();
    return this.save();
  }
  throw new Error('Invalid verification code');
};

const Booking = mongoose.model('Booking', bookingSchema);

export default Booking;