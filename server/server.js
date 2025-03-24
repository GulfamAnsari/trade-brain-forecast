
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { trainModel, predictPrices } from './ml.js';

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

// Combined train and predict endpoint
app.post('/api/analyze', async (req, res) => {
  try {
    const { stockData, sequenceLength, epochs, batchSize, daysToPredict } = req.body;
    
    if (!stockData || !stockData.timeSeries || stockData.timeSeries.length === 0) {
      return res.status(400).json({ error: 'Invalid stock data provided' });
    }
    
    // Train the model
    const modelData = await trainModel(stockData, sequenceLength, epochs, batchSize, 
      (progress) => {
        console.log(`Training progress: Epoch ${progress.epoch}/${progress.totalEpochs}, Loss: ${progress.loss.toFixed(4)}`);
      });
    
    // Make predictions
    const predictions = await predictPrices(
      modelData.modelData, 
      stockData, 
      sequenceLength, 
      modelData.min, 
      modelData.range, 
      daysToPredict
    );
    
    res.json({
      modelData,
      predictions
    });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: error.message || 'Failed to analyze stock data' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
