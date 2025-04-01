import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { WebSocketServer } from 'ws';
import http from 'http';
import { trainAndPredict } from './ml.js';
import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server });

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '100mb' })); // Increase limit for large data transfers
app.use(express.static(path.join(process.cwd(), '..', 'build'))); // Serve static files from build folder

// Track active WebSocket connections
const clients = new Set();

// Track active training sessions
const activeTrainingSessions = new Map();
// Track multi-model sessions
const multiModelSessions = new Set();
// Track workers
const workers = new Map();

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  clients.add(ws);
  
  // Send current active sessions when a client connects
  const activeModels = Array.from(activeTrainingSessions.keys()).map(modelId => ({
    modelId,
    startTime: activeTrainingSessions.get(modelId)
  }));
  
  if (activeModels.length > 0) {
    ws.send(JSON.stringify({
      type: 'activeModels',
      data: activeModels
    }));
  }
  
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    clients.delete(ws);
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      if (data.type === 'cancelTraining' && data.modelId) {
        console.log(`Received cancel request for model: ${data.modelId}`);
        
        // Terminate the worker if it exists
        if (workers.has(data.modelId)) {
          const worker = workers.get(data.modelId);
          worker.terminate();
          workers.delete(data.modelId);
          
          // Remove from active sessions
          activeTrainingSessions.delete(data.modelId);
          
          // Remove from multi-model tracking if applicable
          if (multiModelSessions.has(data.modelId)) {
            multiModelSessions.delete(data.modelId);
          }
          
          // Notify all clients about the cancellation
          broadcast({
            type: 'status',
            data: { 
              message: 'Training cancelled by user',
              stage: 'cancelled'
            }
          }, data.modelId);
          
          console.log(`Cancelled training for model: ${data.modelId}`);
        } else {
          console.log(`Worker not found for model: ${data.modelId}`);
        }
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
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
    const modelsDir = path.join(process.cwd(), '..', 'models');
    
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

// Add a new endpoint for model predictions
app.post('/api/models/:modelId/predict', async (req, res) => {
  try {
    const { modelId } = req.params;
    const { stockData } = req.body;
    
    if (!modelId) {
      return res.status(400).json({ error: 'Model ID is required' });
    }
    
    if (!stockData || !stockData.timeSeries || stockData.timeSeries.length === 0) {
      return res.status(400).json({ error: 'Invalid stock data provided' });
    }
    
    console.log(`Making prediction with model ${modelId} for ${stockData.symbol}`);
    
    const modelsDir = path.join(process.cwd(), '..', 'models');
    const modelPath = path.join(modelsDir, modelId);
    
    if (!fs.existsSync(path.join(modelPath, 'model.json'))) {
      return res.status(404).json({ error: 'Model not found' });
    }
    
    const paramsPath = path.join(modelPath, 'params.json');
    if (!fs.existsSync(paramsPath)) {
      return res.status(404).json({ error: 'Model parameters not found' });
    }
    
    // Clean stock data to avoid circular references
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
    
    const params = JSON.parse(fs.readFileSync(paramsPath, 'utf8'));
    
    // Create a worker for prediction
    const worker = new Worker('./worker.js', {
      workerData: {
        stockData: cleanStockData,
        sequenceLength: params.inputSize || params.sequenceLength,
        epochs: params.epochs || 100,
        batchSize: params.batchSize || 32,
        daysToPredict: params.outputSize || params.daysToPredict || 30,
        descriptiveModelId: modelId,
        isPredictionOnly: true
      }
    });
    
    let hasResponded = false;
    
    // Wait for prediction result
    worker.on('message', (message) => {
      if (hasResponded) return;
      
      if (message.type === 'complete') {
        hasResponded = true;
        res.json({
          predictions: message.predictions || [],
          modelId: modelId
        });
      } else if (message.type === 'error') {
        hasResponded = true;
        res.status(500).json({ error: message.error || 'Failed to make prediction' });
      }
    });
    
    worker.on('error', (error) => {
      if (hasResponded) return;
      
      console.error(`Error predicting with model ${modelId}:`, error);
      hasResponded = true;
      res.status(500).json({ error: error.message || 'Failed to make prediction' });
    });
    
    worker.on('exit', (code) => {
      if (code !== 0 && !hasResponded) {
        console.error(`Worker exited with code ${code} for prediction with model ${modelId}`);
        hasResponded = true;
        res.status(500).json({ error: `Worker exited with code ${code}` });
      }
    });
  } catch (error) {
    console.error('Prediction error:', error);
    res.status(500).json({ error: error.message || 'Failed to make prediction' });
  }
});

// Get all active training models
app.get('/api/active-models', (req, res) => {
  try {
    const activeModels = Array.from(activeTrainingSessions.keys()).map(modelId => ({
      modelId,
      startTime: activeTrainingSessions.get(modelId)
    }));
    
    res.json({ activeModels });
  } catch (error) {
    console.error('Error retrieving active models:', error);
    res.status(500).json({ error: 'Failed to retrieve active models' });
  }
});

// Delete a model
app.delete('/api/models/:modelId', async (req, res) => {
  try {
    const { modelId } = req.params;
    if (!modelId) {
      return res.status(400).json({ error: 'Model ID is required' });
    }
    
    const modelsDir = path.join(process.cwd(), '..', 'models');
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
    
    // Generate a more descriptive model ID if none is provided
    const descriptiveModelId = modelId || 
      `${stockData.symbol}_seq${sequenceLength}_pred${daysToPredict}_ep${epochs}_bs${batchSize}`;
    
    // Check if model already exists
    const modelsDir = path.join(process.cwd(), '..', 'models');
    const modelPath = path.join(modelsDir, descriptiveModelId);
    const modelExists = fs.existsSync(path.join(modelPath, 'model.json')) && 
                        fs.existsSync(path.join(modelPath, 'params.json'));
    
    // If this is part of a multi-model training, add to the tracking set
    if (isMultiModel && descriptiveModelId) {
      multiModelSessions.add(descriptiveModelId);
    }
    
    // Add to active training sessions
    activeTrainingSessions.set(descriptiveModelId, Date.now());
    
    // Notify clients about new training session
    broadcast({
      type: 'status',
      data: { 
        message: 'Starting analysis',
        stage: 'init',
        params: { sequenceLength, epochs, batchSize, daysToPredict },
        startTime: Date.now(),
        symbol: stockData.symbol
      }
    }, descriptiveModelId);
    
    // Create a worker for this model training
    const worker = new Worker('./worker.js', {
      workerData: {
        stockData,
        sequenceLength,
        epochs,
        batchSize, 
        daysToPredict,
        descriptiveModelId
      }
    });
    
    // Store worker reference for possible cancellation
    workers.set(descriptiveModelId, worker);
    
    // Flag to ensure we only send one response
    let responseSent = false;
    
    // Handle progress messages from worker
    worker.on('message', (message) => {
      if (message.type === 'progress' || message.type === 'status') {
        // Add symbol to the message data
        if (message.data && !message.data.symbol && stockData && stockData.symbol) {
          message.data.symbol = stockData.symbol;
        }
        
        broadcast({
          type: message.type,
          data: message.data
        }, descriptiveModelId);
      } else if (message.type === 'complete') {
        // Worker has completed the task
        console.log(`Worker completed for model ${descriptiveModelId}`);
        
        // Remove from tracking
        workers.delete(descriptiveModelId);
        activeTrainingSessions.delete(descriptiveModelId);
        
        // Remove from multi-model tracking if applicable
        if (multiModelSessions.has(descriptiveModelId)) {
          multiModelSessions.delete(descriptiveModelId);
        }
        
        // Send final status
        broadcast({
          type: 'status',
          data: { 
            message: 'Analysis complete',
            stage: 'complete',
            modelInfo: message.modelData,
            symbol: stockData.symbol
          }
        }, descriptiveModelId);
        
        // If this was the response for the original request, send it back
        if (message.originalRequest && !responseSent && !isMultiModel) {
          responseSent = true;
          res.json({
            modelData: message.modelData,
            predictions: message.predictions
          });
        }
      } else if (message.type === 'error') {
        console.error(`Worker error for model ${descriptiveModelId}:`, message.error);
        
        // Remove from tracking
        workers.delete(descriptiveModelId);
        activeTrainingSessions.delete(descriptiveModelId);
        
        // Remove from multi-model tracking if applicable
        if (multiModelSessions.has(descriptiveModelId)) {
          multiModelSessions.delete(descriptiveModelId);
        }
        
        // Send error status
        broadcast({
          type: 'status',
          data: { 
            message: message.error || 'Failed to analyze stock data',
            stage: 'error',
            error: message.error,
            symbol: stockData.symbol
          }
        }, descriptiveModelId);
        
        // If this was the response for the original request, send error
        if (message.originalRequest && !responseSent && !isMultiModel) {
          responseSent = true;
          res.status(500).json({ error: message.error || 'Failed to analyze stock data' });
        }
      }
    });
    
    worker.on('error', (error) => {
      console.error(`Worker error for model ${descriptiveModelId}:`, error);
      
      // Remove from tracking
      workers.delete(descriptiveModelId);
      activeTrainingSessions.delete(descriptiveModelId);
      
      // Remove from multi-model tracking if applicable
      if (multiModelSessions.has(descriptiveModelId)) {
        multiModelSessions.delete(descriptiveModelId);
      }
      
      // Send error status
      broadcast({
        type: 'status',
        data: { 
          message: error.message || 'Failed to analyze stock data',
          stage: 'error',
          error: error.toString(),
          symbol: stockData.symbol
        }
      }, descriptiveModelId);
      
      // If this was the response for the original request, send error
      if (!responseSent && !isMultiModel) {
        responseSent = true;
        res.status(500).json({ error: error.message || 'Failed to analyze stock data' });
      }
    });
    
    worker.on('exit', (code) => {
      console.log(`Worker exited with code ${code} for model ${descriptiveModelId}`);
      
      // If worker exited with non-zero code and we're still tracking it, it's an error
      if (code !== 0 && activeTrainingSessions.has(descriptiveModelId)) {
        activeTrainingSessions.delete(descriptiveModelId);
        workers.delete(descriptiveModelId);
        
        // Remove from multi-model tracking if applicable
        if (multiModelSessions.has(descriptiveModelId)) {
          multiModelSessions.delete(descriptiveModelId);
        }
        
        // Send error status
        broadcast({
          type: 'status',
          data: { 
            message: `Worker exited unexpectedly with code ${code}`,
            stage: 'error',
            error: `Worker exited with code ${code}`,
            symbol: stockData.symbol
          }
        }, descriptiveModelId);
        
        // If this was the response for the original request, send error
        if (!responseSent && !isMultiModel) {
          responseSent = true;
          res.status(500).json({ error: `Worker exited with code ${code}` });
        }
      }
    });
    
    // Don't wait for worker to complete if it's a multi-model request or we're using an existing model
    if (isMultiModel) {
      // For multi-model training, respond immediately
      responseSent = true;
      res.json({ 
        status: 'Training started in background',
        modelId: descriptiveModelId
      });
    } else if (modelExists) {
      // For existing models, use prediction endpoint directly
      try {
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
        
        // Read params
        const params = JSON.parse(fs.readFileSync(path.join(modelPath, 'params.json'), 'utf8'));
        
        // Create a worker for prediction
        const predictionWorker = new Worker('./worker.js', {
          workerData: {
            stockData: cleanStockData,
            sequenceLength: params.inputSize || params.sequenceLength,
            epochs: params.epochs || 100,
            batchSize: params.batchSize || 32,
            daysToPredict: params.outputSize || params.daysToPredict || 30,
            descriptiveModelId,
            isPredictionOnly: true
          }
        });
        
        predictionWorker.on('message', (message) => {
          if (message.type === 'complete' && !responseSent) {
            responseSent = true;
            
            // Clean up
            workers.delete(descriptiveModelId);
            activeTrainingSessions.delete(descriptiveModelId);
            
            console.log(`Used existing model ${descriptiveModelId} for prediction`);
            
            res.json({
              modelData: {
                ...params,
                isExistingModel: true,
                modelId: descriptiveModelId
              },
              predictions: message.predictions || []
            });
          }
        });
        
        predictionWorker.on('error', (error) => {
          if (!responseSent) {
            console.error(`Error using existing model ${descriptiveModelId}:`, error);
            // Fall back to training a new model
            console.log(`Falling back to training a new model for ${descriptiveModelId}`);
            // We don't set responseSent to true, so the original worker can send a response
          }
        });
        
      } catch (error) {
        console.error(`Error using existing model ${descriptiveModelId}:`, error);
        // Fall back to training a new model - original worker will handle the response
      }
    }
    // For non-multi-model requests and non-existing models, the worker will send the response
    
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
      workers.delete(descriptiveModelId);
      
      // Also remove from multi-model tracking if applicable
      if (multiModelSessions.has(descriptiveModelId)) {
        multiModelSessions.delete(descriptiveModelId);
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

// Combine models endpoint
app.post('/api/combine-models', async (req, res) => {
  try {
    const { stockData, modelIds, method = 'average' } = req.body;
    
    if (!stockData || !stockData.timeSeries || stockData.timeSeries.length === 0) {
      return res.status(400).json({ error: 'Invalid stock data provided' });
    }
    
    if (!modelIds || !Array.isArray(modelIds) || modelIds.length === 0) {
      return res.status(400).json({ error: 'No model IDs provided' });
    }
    
    console.log(`Combining models with method: ${method}, models: ${modelIds.join(', ')}`);
    
    const modelsDir = path.join(process.cwd(), '..', 'models');
    const modelErrors = [];
    const validModels = [];
    let hasResponded = false;
    
    // First, gather predictions from all models
    const predictionPromises = modelIds.map(async (modelId) => {
      const modelPath = path.join(modelsDir, modelId);
      
      if (!fs.existsSync(path.join(modelPath, 'model.json'))) {
        return { error: `Model not found: ${modelId}` };
      }
      
      const paramsPath = path.join(modelPath, 'params.json');
      if (!fs.existsSync(paramsPath)) {
        return { error: `Model parameters not found: ${modelId}` };
      }
      
      try {
        const params = JSON.parse(fs.readFileSync(paramsPath, 'utf8'));
        
        // Clean stock data
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
        
        return new Promise((resolve) => {
          // Create a worker for prediction
          const worker = new Worker('./worker.js', {
            workerData: {
              stockData: cleanStockData,
              sequenceLength: params.inputSize || params.sequenceLength,
              epochs: params.epochs || 100,
              batchSize: params.batchSize || 32,
              daysToPredict: params.outputSize || params.daysToPredict || 30,
              descriptiveModelId: modelId,
              isPredictionOnly: true
            }
          });
          
          worker.on('message', (message) => {
            if (message.type === 'complete') {
              resolve({
                modelId,
                params,
                predictions: message.predictions || []
              });
            } else if (message.type === 'error') {
              resolve({ error: `Error with model ${modelId}: ${message.error}` });
            }
          });
          
          worker.on('error', (error) => {
            resolve({ error: `Error with model ${modelId}: ${error.message}` });
          });
          
          worker.on('exit', (code) => {
            if (code !== 0) {
              resolve({ error: `Worker exited with code ${code} for model ${modelId}` });
            }
          });
        });
      } catch (error) {
        console.error(`Error predicting with model ${modelId}:`, error);
        return { error: `Error with model ${modelId}: ${error.message}` };
      }
    });
    
    // Wait for all predictions to complete
    const results = await Promise.all(predictionPromises);
    
    // Process results
    results.forEach(result => {
      if (result.error) {
        modelErrors.push(result.error);
      } else if (result.predictions && result.predictions.length > 0) {
        validModels.push(result);
      }
    });
    
    if (validModels.length === 0) {
      return res.status(400).json({ 
        error: 'No valid models found',
        modelErrors
      });
    }
    
    // Get the number of prediction days from the first valid model
    const daysToPredict = validModels[0].predictions.length;
    
    // Get all unique dates from all models
    const allDates = new Set();
    validModels.forEach(model => {
      model.predictions.forEach(pred => allDates.add(pred.date));
    });
    
    const sortedDates = Array.from(allDates).sort();
    
    // Combine predictions based on method
    const combinedPredictions = [];
    
    if (method === 'average' || method === 'weighted') {
      // For average and weighted methods
      for (const date of sortedDates) {
        const datePredictions = validModels.map(model => {
          const pred = model.predictions.find(p => p.date === date);
          return pred ? pred.prediction : null;
        }).filter(p => p !== null);
        
        if (datePredictions.length > 0) {
          let prediction;
          
          if (method === 'average') {
            // Simple average
            prediction = datePredictions.reduce((sum, val) => sum + val, 0) / datePredictions.length;
          } else if (method === 'weighted') {
            // Weighted average - weight by inverse of model epochs (lower epochs = lower weight)
            const weights = validModels.map((model, i) => {
              const epochs = model.params.totalEpochs || model.params.epochs || 100;
              return { prediction: datePredictions[i], weight: epochs };
            }).filter(item => item.prediction !== null);
            
            const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0);
            prediction = weights.reduce((sum, item) => sum + (item.prediction * item.weight), 0) / totalWeight;
          }
          
          combinedPredictions.push({
            date,
            prediction
          });
        }
      }
    } else if (method === 'bayesian') {
      // Bayesian method - weighted by model certainty (using model loss if available)
      for (const date of sortedDates) {
        const modelsForDate = validModels.map(model => {
          const pred = model.predictions.find(p => p.date === date);
          if (!pred) return null;
          
          // Use inverse of loss as certainty (higher loss = lower certainty)
          const loss = model.params.finalLoss || 0.01;
          const certainty = 1 / (loss + 0.0001); // Add small constant to avoid division by zero
          
          return {
            prediction: pred.prediction,
            certainty
          };
        }).filter(m => m !== null);
        
        if (modelsForDate.length > 0) {
          const totalCertainty = modelsForDate.reduce((sum, m) => sum + m.certainty, 0);
          const prediction = modelsForDate.reduce((sum, m) => sum + (m.prediction * m.certainty), 0) / totalCertainty;
          
          combinedPredictions.push({
            date,
            prediction
          });
        }
      }
    } else if (method === 'stacking') {
      // Stacking - use simple average for now (in a real implementation, this would use a meta-model)
      for (const date of sortedDates) {
        const datePredictions = validModels.map(model => {
          const pred = model.predictions.find(p => p.date === date);
          return pred ? pred.prediction : null;
        }).filter(p => p !== null);
        
        if (datePredictions.length > 0) {
          // Simple average as a basic stacking implementation
          const prediction = datePredictions.reduce((sum, val) => sum + val, 0) / datePredictions.length;
          
          combinedPredictions.push({
            date,
            prediction
          });
        }
      }
    }
    
    console.log(`Combined ${validModels.length} models using ${method} method. Generated ${combinedPredictions.length} predictions.`);
    
    // Ensure we have predictions to return
    if (combinedPredictions.length === 0) {
      return res.status(400).json({
        error: 'Failed to generate combined predictions',
        modelErrors
      });
    }
    
    // Sort predictions by date
    combinedPredictions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    if (!hasResponded) {
      hasResponded = true;
      res.json({
        predictions: combinedPredictions,
        method,
        usedModels: validModels.map(m => m.modelId),
        modelErrors: modelErrors.length > 0 ? modelErrors : undefined
      });
    }
    
  } catch (error) {
    console.error('Combined prediction error:', error);
    res.status(500).json({ error: error.message || 'Failed to make combined prediction' });
  }
});

// Cancel training endpoint
app.post('/api/cancel-training', async (req, res) => {
  try {
    const { modelId } = req.body;
    
    if (!modelId) {
      return res.status(400).json({ error: 'Model ID is required' });
    }
    
    if (!workers.has(modelId)) {
      return res.status(404).json({ error: 'No active training found for this model' });
    }
    
    // Terminate the worker
    const worker = workers.get(modelId);
    worker.terminate();
    
    // Remove from tracking
    workers.delete(modelId);
    activeTrainingSessions.delete(modelId);
    
    // Remove from multi-model tracking if applicable
    if (multiModelSessions.has(modelId)) {
      multiModelSessions.delete(modelId);
    }
    
    // Notify clients
    broadcast({
      type: 'status',
      data: { 
        message: 'Training cancelled by user',
        stage: 'cancelled'
      }
    }, modelId);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error cancelling training:', error);
    res.status(500).json({ error: error.message || 'Failed to cancel training' });
  }
});

// Combo training endpoint
app.post('/api/combo-training', async (req, res) => {
  try {
    const { stockData, configurations } = req.body;
    
    if (!stockData || !stockData.timeSeries || stockData.timeSeries.length === 0) {
      return res.status(400).json({ error: 'Invalid stock data provided' });
    }
    
    if (!configurations || !Array.isArray(configurations) || configurations.length === 0) {
      return res.status(400).json({ error: 'No training configurations provided' });
    }
    
    console.log(`Starting combo training for ${stockData.symbol} with ${configurations.length} configurations`);
    
    // Generate job IDs for each configuration
    const trainingJobs = configurations.map((config, index) => {
      const { sequenceLength, epochs, batchSize, daysToPredict } = config;
      
      // Generate a descriptive model ID
      const modelId = `${stockData.symbol}_seq${sequenceLength}_pred${daysToPredict}_ep${epochs}_bs${batchSize}`;
      
      return {
        ...config,
        modelId,
        index
      };
    });
    
    // Add all jobs to active training and multi-model tracking
    trainingJobs.forEach(job => {
      activeTrainingSessions.set(job.modelId, Date.now());
      multiModelSessions.add(job.modelId);
    });
    
    // Broadcast info about combo training
    broadcast({
      type: 'comboTrainingStarted',
      data: {
        totalJobs: trainingJobs.length,
        stock: stockData.symbol,
        jobs: trainingJobs.map(job => ({
          modelId: job.modelId,
          config: {
            sequenceLength: job.sequenceLength,
            epochs: job.epochs,
            batchSize: job.batchSize,
            daysToPredict: job.daysToPredict
          }
        }))
      }
    });
    
    // Start the first few jobs (to avoid overwhelming the system)
    const batchSize = 16; // Start with 4 jobs at once
    const initialBatch = trainingJobs.slice(0, batchSize);
    
    // Function to start a job
    const startJob = (job) => {
      console.log(`Starting job ${job.index + 1}/${trainingJobs.length}: ${job.modelId}`);
      
      // Notify about job starting
      broadcast({
        type: 'status',
        data: { 
          message: `Starting analysis (job ${job.index + 1}/${trainingJobs.length})`,
          stage: 'init',
          params: { 
            sequenceLength: job.sequenceLength, 
            epochs: job.epochs, 
            batchSize: job.batchSize, 
            daysToPredict: job.daysToPredict 
          },
          jobIndex: job.index,
          totalJobs: trainingJobs.length,
          startTime: Date.now(),
          symbol: stockData.symbol
        }
      }, job.modelId);
      
      // Create worker for this job
      const worker = new Worker('./worker.js', {
        workerData: {
          stockData,
          sequenceLength: job.sequenceLength,
          epochs: job.epochs,
          batchSize: job.batchSize, 
          daysToPredict: job.daysToPredict,
          descriptiveModelId: job.modelId,
          jobIndex: job.index,
          totalJobs: trainingJobs.length
        }
      });
      
      // Store worker reference
      workers.set(job.modelId, worker);
      
      // Handle worker messages
      worker.on('message', (message) => {
        if (message.type === 'progress' || message.type === 'status') {
          // Add job context to progress updates
          const progressData = {
            ...message.data,
            jobIndex: job.index,
            totalJobs: trainingJobs.length,
            symbol: stockData.symbol
          };
          
          broadcast({
            type: message.type,
            data: progressData
          }, job.modelId);
        } else if (message.type === 'complete') {
          console.log(`Job ${job.index + 1}/${trainingJobs.length} completed: ${job.modelId}`);
          
          // Clean up
          workers.delete(job.modelId);
          activeTrainingSessions.delete(job.modelId);
          multiModelSessions.delete(job.modelId);
          
          // Send final status with job context
          broadcast({
            type: 'status',
            data: { 
              message: `Analysis complete (job ${job.index + 1}/${trainingJobs.length})`,
              stage: 'complete',
              modelInfo: message.modelData,
              jobIndex: job.index,
              totalJobs: trainingJobs.length,
              symbol: stockData.symbol
            }
          }, job.modelId);
          
          // Start next job if available
          const nextJobIndex = job.index + batchSize;
          if (nextJobIndex < trainingJobs.length) {
            startJob(trainingJobs[nextJobIndex]);
          }
        } else if (message.type === 'error') {
          console.error(`Job ${job.index + 1}/${trainingJobs.length} error: ${message.error}`);
          
          // Clean up
          workers.delete(job.modelId);
          activeTrainingSessions.delete(job.modelId);
          multiModelSessions.delete(job.modelId);
          
          // Send error with job context
          broadcast({
            type: 'status',
            data: { 
              message: `Error in job ${job.index + 1}/${trainingJobs.length}: ${message.error}`,
              stage: 'error',
              error: message.error,
              jobIndex: job.index,
              totalJobs: trainingJobs.length,
              symbol: stockData.symbol
            }
          }, job.modelId);
          
          // Start next job if available
          const nextJobIndex = job.index + batchSize;
          if (nextJobIndex < trainingJobs.length) {
            startJob(trainingJobs[nextJobIndex]);
          }
        }
      });
      
      // Handle worker errors and exits
      worker.on('error', (error) => {
        console.error(`Worker error for job ${job.index + 1}/${trainingJobs.length}:`, error);
        
        // Clean up
        workers.delete(job.modelId);
        activeTrainingSessions.delete(job.modelId);
        multiModelSessions.delete(job.modelId);
        
        // Send error status
        broadcast({
          type: 'status',
          data: { 
            message: `Worker error in job ${job.index + 1}/${trainingJobs.length}: ${error.message}`,
            stage: 'error',
            error: error.toString(),
            jobIndex: job.index,
            totalJobs: trainingJobs.length,
            symbol: stockData.symbol
          }
        }, job.modelId);
        
        // Start next job if available
        const nextJobIndex = job.index + batchSize;
        if (nextJobIndex < trainingJobs.length) {
          startJob(trainingJobs[nextJobIndex]);
        }
      });
      
      worker.on('exit', (code) => {
        console.log(`Worker for job ${job.index + 1}/${trainingJobs.length} exited with code ${code}`);
        
        // If abnormal exit and still tracked
        if (code !== 0 && activeTrainingSessions.has(job.modelId)) {
          // Clean up
          workers.delete(job.modelId);
          activeTrainingSessions.delete(job.modelId);
          multiModelSessions.delete(job.modelId);
          
          // Send error status
          broadcast({
            type: 'status',
            data: { 
              message: `Worker for job ${job.index + 1}/${trainingJobs.length} exited unexpectedly with code ${code}`,
              stage: 'error',
              error: `Worker exited with code ${code}`,
              jobIndex: job.index,
              totalJobs: trainingJobs.length,
              symbol: stockData.symbol
            }
          }, job.modelId);
          
          // Start next job if available
          const nextJobIndex = job.index + batchSize;
          if (nextJobIndex < trainingJobs.length) {
            startJob(trainingJobs[nextJobIndex]);
          }
        }
      });
    };
    
    // Start initial batch of jobs
    initialBatch.forEach(startJob);
    
    // Respond immediately, jobs will run in background
    res.json({
      status: 'Combo training started',
      totalJobs: trainingJobs.length,
      jobs: trainingJobs.map(job => ({
        modelId: job.modelId,
        config: {
          sequenceLength: job.sequenceLength,
          epochs: job.epochs,
          batchSize: job.batchSize,
          daysToPredict: job.daysToPredict
        }
      }))
    });
    
  } catch (error) {
    console.error('Combo training error:', error);
    res.status(500).json({ error: error.message || 'Failed to start combo training' });
  }
});

// Add a new endpoint for past prediction analysis
app.post('/api/analyze-past', async (req, res) => {
  try {
    const { stockData, sequenceLength, epochs, batchSize, daysToPredict, modelId, predictPastDays } = req.body;
    
    if (!stockData || !stockData.timeSeries || stockData.timeSeries.length === 0) {
      return res.status(400).json({ error: 'Invalid stock data provided' });
    }
    
    if (!predictPastDays || predictPastDays <= 0) {
      return res.status(400).json({ error: 'Invalid past days parameter provided' });
    }
    
    console.log(`Analyzing past performance for ${stockData.symbol} with model ${modelId || 'to be created'}`);
    
    // Generate a descriptive model ID if not provided
    const descriptiveModelId = modelId || 
      `${stockData.symbol}_seq${sequenceLength}_pred${daysToPredict}_ep${epochs}_bs${batchSize}`;
    
    // Check if model exists
    const modelsDir = path.join(process.cwd(), '..', 'models');
    const modelPath = path.join(modelsDir, descriptiveModelId);
    const modelExists = fs.existsSync(path.join(modelPath, 'model.json')) && 
                        fs.existsSync(path.join(modelPath, 'params.json'));
    
    if (!modelExists) {
      return res.status(404).json({ error: `Model ${descriptiveModelId} not found. Please train the model first.` });
    }
    
    // Clean stock data to avoid circular references
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
    
    // Read model parameters
    const paramsPath = path.join(modelPath, 'params.json');
    const params = JSON.parse(fs.readFileSync(paramsPath, 'utf8'));
    
    // Create worker for past predictions
    const worker = new Worker('./worker.js', {
      workerData: {
        stockData: cleanStockData,
        sequenceLength: params.inputSize || params.sequenceLength,
        epochs: params.epochs || 100,
        batchSize: params.batchSize || 32,
        daysToPredict: params.outputSize || params.daysToPredict || 30,
        descriptiveModelId,
        isPredictionOnly: true,
        predictPastDays: predictPastDays
      }
    });
    
    let hasResponded = false;
    
    worker.on('message', (message) => {
      if (hasResponded) return;
      
      if (message.type === 'complete') {
        hasResponded = true;
        
        // Return predictions including past predictions
        res.json({
          predictions: message.predictions || [],
          modelId: descriptiveModelId,
          pastPredictions: message.pastPredictions || []
        });
      } else if (message.type === 'error') {
        hasResponded = true;
        res.status(500).json({ error: message.error || 'Failed to make past predictions' });
      }
    });
    
    worker.on('error', (error) => {
      if (hasResponded) return;
      
      console.error(`Error predicting past with model ${descriptiveModelId}:`, error);
      hasResponded = true;
      res.status(500).json({ error: error.message || 'Failed to make past predictions' });
    });
    
    worker.on('exit', (code) => {
      if (code !== 0 && !hasResponded) {
        console.error(`Worker exited with code ${code} for past prediction with model ${descriptiveModelId}`);
        hasResponded = true;
        res.status(500).json({ error: `Worker exited with code ${code}` });
      }
    });
  } catch (error) {
    console.error('Past prediction error:', error);
    res.status(500).json({ error: error.message || 'Failed to make past predictions' });
  }
});

app.get('/api/status', (req, res) => {
  res.status(200).json({ status: 'running' });
});

// Handle all other routes - serve the React app
app.get('*', (req, res) => {
  res.sendFile(path.join(process.cwd(), '..', 'build', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Server running on port http://${HOST}:${PORT}`);
  console.log(`WebSocket server running on ws://${HOST}:${PORT}`);
});
