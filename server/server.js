
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { trainAndPredict } from './ml.js';

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
    
    console.log(`Analyzing stock data for ${stockData.symbol} with ${stockData.timeSeries.length} data points`);
    
    // Train the model and get predictions
    const result = await trainAndPredict(
      stockData, 
      sequenceLength, 
      epochs, 
      batchSize, 
      daysToPredict
    );
    
    res.json({
      modelData: result.modelData,
      predictions: result.predictions
    });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: error.message || 'Failed to analyze stock data' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
