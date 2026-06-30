# backend_new
# VS Arogya Backend API

Backend API for VS Arogya, a healthcare and pharmacy B2B platform built using Node.js, Express.js, MongoDB, and Cloudinary.

## Features

### Authentication

* Vendor Registration
* Vendor Login
* JWT Authentication

### Vendor Management

* Vendor Registration
* Vendor Approval/Rejection
* Vendor Login
* Vendor Product Management

### Product Management

* Add Product
* Update Product
* Delete Product
* Product Listing
* Product Details

### Cart Management

* Add to Cart
* Update Cart Quantity
* Remove from Cart
* Get User Cart

### Address Management

* Add Address
* Update Address
* Delete Address
* Select Default Address

### Order Management

* Place Order
* Order History
* Order Details
* Order Status Tracking
* Cancel Order

### Payment Integration

* Razorpay Order Creation
* Payment Verification
* COD Support
* Online Payment Support

### File Uploads

* Store Images Upload
* GST PDF Upload
* Drug License Upload
* Cloudinary Integration

## Tech Stack

* Node.js
* Express.js
* MongoDB
* Mongoose
* JWT Authentication
* Bcrypt
* Cloudinary
* Multer
* Razorpay

## Project Structure

```bash
src/
│
├── config/
├── controller/
├── middlewares/
├── model/
├── routes/
├── utils/
└── index.js
```

## Installation

Clone Repository

```bash
git clone <repository-url>
```

Install Dependencies

```bash
npm install
```

Run Development Server

```bash
npm run dev
```

Run Production Server

```bash
npm start
```

## Environment Variables

Create a .env file in the root directory.
```env
PORT=3000

MONGO_URI=

JWT_SECRET=

CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
```

## Main API Endpoints

### Authentication

```http
POST //register
POST /api/auth/login
```

### Vendor

```http
api list comming
```

### Products

```http
api list comming 
```

### Cart

api list comming

### Orders

api list comming

### Payments

```http
api list comming
```

## Security Features

* JWT Authentication
* Input Validation
* Secure File Uploads
* Razorpay Signature Verification

## Deployment

details comming soon...

## Author

Developed for VS Arogya Platform.
