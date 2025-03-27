
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { WebSocketServer } from 'ws';
import http from 'http';
import { trainAndPredict } from './ml.js';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 5000;

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server });

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '100mb' })); // Increase limit for large data transfers

// Status endpoint
app.get('/api/status', (req, res) => {
  res.json({ status: 'Server is running' });
});

// Track active WebSocket connections
const clients = new Set();

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  clients.add(ws);
  
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    clients.delete(ws);
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Broadcast to all connected clients
const broadcast = (message) => {
  const data = JSON.stringify(message);
  clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(data);
    }
  });
};

// Get all saved models
app.get('/api/models', (req, res) => {
  try {
    const modelsDir = path.join(process.cwd(), 'models');
    
    if (!fs.existsSync(modelsDir)) {
      return res.json({ models: [] });
    }
    
    const modelFolders = fs.readdirSync(modelsDir);
    const models = [];
    
    for (const folder of modelFolders) {
      const paramPath = path.join(modelsDir, folder, 'params.json');
      
      if (fs.existsSync(paramPath)) {
        try {
          const params = JSON.parse(fs.readFileSync(paramPath, 'utf8'));
          models.push({
            modelId: folder,
            ...params
          });
        } catch (e) {
          console.error(`Error reading model params for ${folder}:`, e);
        }
      }
    }
    
    res.json({ models });
    
  } catch (error) {
    console.error('Error retrieving models:', error);
    res.status(500).json({ error: 'Failed to retrieve models' });
  }
});

// Combined train and predict endpoint
app.post('/api/analyze', async (req, res) => {
  try {
    const { stockData, sequenceLength, epochs, batchSize, daysToPredict } = req.body;
    
    if (!stockData || !stockData.timeSeries || stockData.timeSeries.length === 0) {
      return res.status(400).json({ error: 'Invalid stock data provided' });
    }
    
    console.log(`Analyzing stock data for ${stockData.symbol} with ${stockData.timeSeries.length} data points`);
    console.log(`Parameters: sequenceLength=${sequenceLength}, epochs=${epochs}, batchSize=${batchSize}, daysToPredict=${daysToPredict}`);
    
    // Setup progress callback
    const onProgress = (progress) => {
      broadcast({
        type: 'progress',
        data: progress
      });
    };
    
    // Initial status
    broadcast({
      type: 'status',
      data: { 
        message: 'Starting analysis',
        stage: 'init',
        params: { sequenceLength, epochs, batchSize, daysToPredict }
      }
    });
    
    // Train the model and get predictions
    const result = await trainAndPredict(
      stockData, 
      sequenceLength, 
      epochs, 
      batchSize, 
      daysToPredict,
      onProgress
    );
    
    // Final status
    broadcast({
      type: 'status',
      data: { 
        message: 'Analysis complete',
        stage: 'complete',
        modelInfo: result.modelData
      }
    });
    
    res.json({
      modelData: result.modelData,
      predictions: result.predictions
    });
  } catch (error) {
    console.error('Analysis error:', error);
    
    // Error status
    broadcast({
      type: 'status',
      data: { 
        message: error.message || 'Failed to analyze stock data',
        stage: 'error',
        error: error.toString()
      }
    });
    
    res.status(500).json({ error: error.message || 'Failed to analyze stock data' });
  }
});

// Predict using a specific model ID
app.post('/api/models/:modelId/predict', async (req, res) => {
  try {
    const { modelId } = req.params;
    const { stockData } = req.body;
    
    if (!stockData || !stockData.timeSeries || stockData.timeSeries.length === 0) {
      return res.status(400).json({ error: 'Invalid stock data provided' });
    }
    
    const modelsDir = path.join(process.cwd(), 'models');
    const modelPath = path.join(modelsDir, modelId);
    
    if (!fs.existsSync(path.join(modelPath, 'model.json'))) {
      return res.status(404).json({ error: 'Model not found' });
    }
    
    const paramsPath = path.join(modelPath, 'params.json');
    if (!fs.existsSync(paramsPath)) {
      return res.status(500).json({ error: 'Model parameters not found' });
    }
    
    const params = JSON.parse(fs.readFileSync(paramsPath, 'utf8'));
    
    // Setup progress callback
    const onProgress = (progress) => {
      broadcast({
        type: 'progress',
        data: { ...progress, modelId }
      });
    };
    
    // Initial status
    broadcast({
      type: 'status',
      data: { 
        message: `Loading model ${modelId}`,
        stage: 'init',
        modelId
      }
    });
    
    // Remove any extra properties before loading the model
    const cleanStockData = {
      ...stockData,
      timeSeries: stockData.timeSeries.map(item => ({
        date: item.date,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume
      }))
    };
    
    // Call trainAndPredict which will load the existing model
    const result = await trainAndPredict(
      cleanStockData,
      params.inputSize || 0,  // This will be ignored since we're loading a model
      params.epochs || 100,
      params.batchSize || 32,
      params.outputSize || 30,
      onProgress
    );
    
    // Final status
    broadcast({
      type: 'status',
      data: { 
        message: 'Prediction complete',
        stage: 'complete',
        modelId,
        modelInfo: result.modelData
      }
    });
    
    res.json({
      modelData: result.modelData,
      predictions: result.predictions
    });
    
  } catch (error) {
    console.error('Prediction error:', error);
    
    // Error status
    broadcast({
      type: 'status',
      data: { 
        message: error.message || 'Failed to make prediction',
        stage: 'error',
        error: error.toString()
      }
    });
    
    res.status(500).json({ error: error.message || 'Failed to make prediction' });
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server running on ws://localhost:${PORT}`);
});
