
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

// Track active training sessions to limit concurrent processing
const activeTrainingSessions = new Map();
// Track multi-model sessions
const multiModelSessions = new Set();

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

// Broadcast to all connected clients with model ID context
const broadcast = (message, modelId = null) => {
  // Add model ID to the message payload if provided
  const dataToSend = modelId ? { ...message, modelId } : message;
  const data = JSON.stringify(dataToSend);
  
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
            ...params,
            // Include more comprehensive model information
            dataPoints: params.dataPoints || 0,
            minPrice: params.minPrice || 0,
            range: params.range || 0,
            totalEpochs: params.totalEpochs || params.epochs || 0
          });
        } catch (e) {
          console.error(`Error reading model params for ${folder}:`, e);
        }
      }
    }
    
    // Sort models by creation date, newest first
    models.sort((a, b) => {
      const dateA = new Date(a.created || a.trainingTime || 0);
      const dateB = new Date(b.created || b.trainingTime || 0);
      return dateB - dateA;
    });
    
    res.json({ models });
    
  } catch (error) {
    console.error('Error retrieving models:', error);
    res.status(500).json({ error: 'Failed to retrieve models' });
  }
});

// Delete a model
app.delete('/api/models/:modelId', async (req, res) => {
  try {
    const { modelId } = req.params;
    if (!modelId) {
      return res.status(400).json({ error: 'Model ID is required' });
    }
    
    const modelsDir = path.join(process.cwd(), 'models');
    const modelPath = path.join(modelsDir, modelId);
    
    if (!fs.existsSync(modelPath)) {
      return res.status(404).json({ error: 'Model not found' });
    }
    
    // Remove active training sessions if this model is being trained
    if (activeTrainingSessions.has(modelId)) {
      activeTrainingSessions.delete(modelId);
    }
    
    // Delete the model directory and all its contents
    fs.rmSync(modelPath, { recursive: true, force: true });
    
    res.json({ success: true, message: 'Model deleted successfully' });
  } catch (error) {
    console.error('Error deleting model:', error);
    res.status(500).json({ error: 'Failed to delete model' });
  }
});

// Combined train and predict endpoint
app.post('/api/analyze', async (req, res) => {
  try {
    const { stockData, sequenceLength, epochs, batchSize, daysToPredict, modelId, isMultiModel } = req.body;
    
    if (!stockData || !stockData.timeSeries || stockData.timeSeries.length === 0) {
      return res.status(400).json({ error: 'Invalid stock data provided' });
    }
    
    console.log(`Analyzing stock data for ${stockData.symbol} with ${stockData.timeSeries.length} data points`);
    console.log(`Parameters: sequenceLength=${sequenceLength}, epochs=${epochs}, batchSize=${batchSize}, daysToPredict=${daysToPredict}, modelId=${modelId || 'none'}`);
    console.log(`Is part of multi-model training: ${isMultiModel ? 'Yes' : 'No'}`);
    
    // Generate a more descriptive model ID if none is provided
    const descriptiveModelId = modelId || 
      `${stockData.symbol}_seq${sequenceLength}_pred${daysToPredict}_ep${epochs}_bs${batchSize}_dp${stockData.timeSeries.length}`;
    
    // If this is part of a multi-model training, add to the tracking set
    if (isMultiModel && descriptiveModelId) {
      multiModelSessions.add(descriptiveModelId);
      console.log(`Added ${descriptiveModelId} to multi-model tracking. Current multi-models: ${multiModelSessions.size}`);
    }
    
    // Limit concurrent training sessions
    const maxConcurrentTraining = 5; // Allow 5 concurrent trainings
    if (activeTrainingSessions.size >= maxConcurrentTraining) {
      return res.status(429).json({ 
        error: 'Too many concurrent training sessions. Please try again later.',
        maxConcurrent: maxConcurrentTraining,
        active: activeTrainingSessions.size
      });
    }
    
    // Add to active training sessions
    activeTrainingSessions.set(descriptiveModelId, Date.now());
    
    // Setup progress callback with model ID context
    const onProgress = (progress) => {
      broadcast({
        type: 'progress',
        data: progress
      }, descriptiveModelId); // Pass the descriptiveModelId to ensure messages are tagged with the correct model
    };
    
    // Initial status
    broadcast({
      type: 'status',
      data: { 
        message: 'Starting analysis',
        stage: 'init',
        params: { sequenceLength, epochs, batchSize, daysToPredict }
      }
    }, descriptiveModelId); // Tag with the specific model ID
    
    // Train the model and get predictions
    const result = await trainAndPredict(
      stockData, 
      sequenceLength, 
      epochs, 
      batchSize, 
      daysToPredict,
      onProgress,
      descriptiveModelId
    );
    
    // Remove from active training sessions
    activeTrainingSessions.delete(descriptiveModelId);
    
    // Remove from multi-model tracking if applicable
    if (multiModelSessions.has(descriptiveModelId)) {
      multiModelSessions.delete(descriptiveModelId);
      console.log(`Removed ${descriptiveModelId} from multi-model tracking. Remaining multi-models: ${multiModelSessions.size}`);
    }
    
    // Final status
    broadcast({
      type: 'status',
      data: { 
        message: 'Analysis complete',
        stage: 'complete',
        modelInfo: result.modelData
      }
    }, descriptiveModelId);
    
    res.json({
      modelData: result.modelData,
      predictions: result.predictions
    });
  } catch (error) {
    console.error('Analysis error:', error);
    
    // Get the model ID from the request body or use the descriptive one we generated
    const descriptiveModelId = req.body?.modelId || 
      (req.body?.stockData ? 
        `${req.body.stockData.symbol}_seq${req.body.sequenceLength}_pred${req.body.daysToPredict}_ep${req.body.epochs}_bs${req.body.batchSize}` : 
        null);
    
    // Remove from active training sessions on error
    if (descriptiveModelId) {
      activeTrainingSessions.delete(descriptiveModelId);
      
      // Also remove from multi-model tracking if applicable
      if (multiModelSessions.has(descriptiveModelId)) {
        multiModelSessions.delete(descriptiveModelId);
        console.log(`Removed ${descriptiveModelId} from multi-model tracking due to error. Remaining multi-models: ${multiModelSessions.size}`);
      }
    }
    
    // Error status
    broadcast({
      type: 'status',
      data: { 
        message: error.message || 'Failed to analyze stock data',
        stage: 'error',
        error: error.toString()
      }
    }, descriptiveModelId);
    
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
      }, modelId);
    };
    
    // Initial status
    broadcast({
      type: 'status',
      data: { 
        message: `Loading model ${modelId}`,
        stage: 'init',
        modelId
      }
    }, modelId);
    
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
      onProgress,
      modelId
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
    }, modelId);
    
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
    }, req.params?.modelId);
    
    res.status(500).json({ error: error.message || 'Failed to make prediction' });
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server running on ws://localhost:${PORT}`);
});
