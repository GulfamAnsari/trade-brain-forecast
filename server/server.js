
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { trainModel, predictPrices } = require('./ml');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));

// Status endpoint
app.get('/api/status', (req, res) => {
  res.json({ status: 'Server is running' });
});

// Train model endpoint
app.post('/api/train', async (req, res) => {
  try {
    const { stockData, sequenceLength, epochs, batchSize } = req.body;
    
    if (!stockData || !stockData.timeSeries || stockData.timeSeries.length === 0) {
      return res.status(400).json({ error: 'Invalid stock data provided' });
    }
    
    // Start training in the background
    const trainingPromise = trainModel(stockData, sequenceLength, epochs, batchSize, 
      (progress) => {
        // This is where we could implement WebSockets to send real-time progress
        console.log(`Training progress: Epoch ${progress.epoch}/${progress.totalEpochs}, Loss: ${progress.loss.toFixed(4)}`);
      });
    
    // Wait for training to complete
    const modelData = await trainingPromise;
    
    res.json(modelData);
  } catch (error) {
    console.error('Training error:', error);
    res.status(500).json({ error: error.message || 'Failed to train model' });
  }
});

// Predict endpoint
app.post('/api/predict', async (req, res) => {
  try {
    const { modelData, stockData, sequenceLength, min, range, daysToPredict } = req.body;
    
    if (!modelData || !stockData || !stockData.timeSeries || stockData.timeSeries.length === 0) {
      return res.status(400).json({ error: 'Invalid data provided' });
    }
    
    const predictions = await predictPrices(modelData, stockData, sequenceLength, min, range, daysToPredict);
    
    res.json({ predictions });
  } catch (error) {
    console.error('Prediction error:', error);
    res.status(500).json({ error: error.message || 'Failed to make prediction' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
