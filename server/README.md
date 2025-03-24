
# Stock Prediction ML Server

This Node.js server handles the machine learning operations for the stock prediction application.

## Requirements

- Node.js v14+
- npm or yarn

## Setup

1. Install dependencies:
```
npm install
```

2. Start the server:
```
npm start
```

The server will run on http://localhost:5000 by default.

## API Endpoints

- `GET /api/status` - Check if server is running
- `POST /api/train` - Train a model with stock data
- `POST /api/predict` - Generate stock price predictions

## Development

For development with automatic restarts:
```
npm run dev
```

## Notes

- This server uses TensorFlow.js for Node.js to handle ML operations
- Make sure the server is running before using the stock prediction features in the frontend app
