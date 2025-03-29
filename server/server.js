import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { WebSocketServer } from 'ws';
import http from 'http';
import { trainAndPredict } from './ml.js';
import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';

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
app.use(express.static(path.join(process.cwd(), 'build'))); // Serve static files from build folder

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
    
    // Add to active training sessions
    activeTrainingSessions.set(descriptiveModelId, Date.now());
    
    // Notify clients about new training session
    broadcast({
      type: 'status',
      data: { 
        message: 'Starting analysis',
        stage: 'init',
        params: { sequenceLength, epochs, batchSize, daysToPredict },
        startTime: Date.now()
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
    
    // Handle progress messages from worker
    worker.on('message', (message) => {
      if (message.type === 'progress' || message.type === 'status') {
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
          console.log(`Removed ${descriptiveModelId} from multi-model tracking. Remaining multi-models: ${multiModelSessions.size}`);
        }
        
        // Send final status
        broadcast({
          type: 'status',
          data: { 
            message: 'Analysis complete',
            stage: 'complete',
            modelInfo: message.modelData
          }
        }, descriptiveModelId);
        
        // If this was the response for the original request, send it back
        if (message.originalRequest) {
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
          console.log(`Removed ${descriptiveModelId} from multi-model tracking due to error. Remaining multi-models: ${multiModelSessions.size}`);
        }
        
        // Send error status
        broadcast({
          type: 'status',
          data: { 
            message: message.error || 'Failed to analyze stock data',
            stage: 'error',
            error: message.error
          }
        }, descriptiveModelId);
        
        // If this was the response for the original request, send error
        if (message.originalRequest) {
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
        console.log(`Removed ${descriptiveModelId} from multi-model tracking due to error. Remaining multi-models: ${multiModelSessions.size}`);
      }
      
      // Send error status
      broadcast({
        type: 'status',
        data: { 
          message: error.message || 'Failed to analyze stock data',
          stage: 'error',
          error: error.toString()
        }
      }, descriptiveModelId);
      
      res.status(500).json({ error: error.message || 'Failed to analyze stock data' });
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
          console.log(`Removed ${descriptiveModelId} from multi-model tracking due to worker exit. Remaining multi-models: ${multiModelSessions.size}`);
        }
        
        // Send error status
        broadcast({
          type: 'status',
          data: { 
            message: `Worker exited unexpectedly with code ${code}`,
            stage: 'error',
            error: `Worker exited with code ${code}`
          }
        }, descriptiveModelId);
      }
    });
    
    // Don't wait for worker to complete if not the original requester
    if (!isMultiModel) {
      // Worker will send response when done
    } else {
      // For multi-model training, we don't need to wait for this specific model
      res.json({ 
        status: 'Training started in background',
        modelId: descriptiveModelId
      });
    }
    
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
  // ... keep existing code
});

// Combined model prediction endpoint
app.post('/api/models/combined-predict', async (req, res) => {
  try {
    const { stockData, modelIds, method = 'average' } = req.body;
    
    if (!stockData || !stockData.timeSeries || stockData.timeSeries.length === 0) {
      return res.status(400).json({ error: 'Invalid stock data provided' });
    }
    
    if (!modelIds || !Array.isArray(modelIds) || modelIds.length === 0) {
      return res.status(400).json({ error: 'No model IDs provided' });
    }
    
    const modelsDir = path.join(process.cwd(), 'models');
    const predictions = [];
    const modelErrors = [];
    const validModels = [];
    
    // First, gather predictions from all models
    for (const modelId of modelIds) {
      const modelPath = path.join(modelsDir, modelId);
      
      if (!fs.existsSync(path.join(modelPath, 'model.json'))) {
        modelErrors.push(`Model not found: ${modelId}`);
        continue;
      }
      
      const paramsPath = path.join(modelPath, 'params.json');
      if (!fs.existsSync(paramsPath)) {
        modelErrors.push(`Model parameters not found: ${modelId}`);
        continue;
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
        
        // Create a worker for prediction
        const worker = new Worker('./worker.js', {
          workerData: {
            stockData: cleanStockData,
            inputSize: params.inputSize || 0,
            epochs: params.epochs || 100,
            batchSize: params.batchSize || 32,
            outputSize: params.outputSize || 30,
            descriptiveModelId: modelId,
            isPredictionOnly: true
          }
        });
        
        // Wait for prediction result
        const result = await new Promise((resolve, reject) => {
          worker.on('message', (message) => {
            if (message.type === 'complete') {
              resolve(message);
            } else if (message.type === 'error') {
              reject(new Error(message.error));
            }
          });
          
          worker.on('error', reject);
          worker.on('exit', (code) => {
            if (code !== 0) {
              reject(new Error(`Worker exited with code ${code}`));
            }
          });
        });
        
        validModels.push({
          modelId,
          params,
          predictions: result.predictions
        });
        
      } catch (error) {
        console.error(`Error predicting with model ${modelId}:`, error);
        modelErrors.push(`Error with model ${modelId}: ${error.message}`);
      }
    }
    
    if (validModels.length === 0) {
      return res.status(400).json({ 
        error: 'No valid models found',
        modelErrors
      });
    }
    
    // Get the number of prediction days from the first valid model
    const daysToPredict = validModels[0].predictions.length;
    
    // Ensure all models have the same number of prediction days
    if (!validModels.every(model => model.predictions.length === daysToPredict)) {
      return res.status(400).json({ 
        error: 'Models have different prediction day lengths',
        modelErrors
      });
    }
    
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
    
    res.json({
      combinedPredictions,
      method,
      usedModels: validModels.map(m => m.modelId),
      modelErrors: modelErrors.length > 0 ? modelErrors : undefined
    });
    
  } catch (error) {
    console.error('Combined prediction error:', error);
    res.status(500).json({ error: error.message || 'Failed to make combined prediction' });
  }
});

// Create a combo training endpoint for batch training with multiple configurations
app.post('/api/combo-train', async (req, res) => {
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
      const modelId = `${stockData.symbol}_seq${sequenceLength}_pred${daysToPredict}_ep${epochs}_bs${batchSize}_dp${stockData.timeSeries.length}`;
      
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
    const batchSize = 4; // Start with 4 jobs at once
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
          startTime: Date.now()
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
            totalJobs: trainingJobs.length
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
              totalJobs: trainingJobs.length
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
              totalJobs: trainingJobs.length
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
            totalJobs: trainingJobs.length
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
              totalJobs: trainingJobs.length
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

app.get('/api/status', (req, res) => {
  res.status(200).json({ status: 'running' });
});
// Handle all other routes - serve the React app
app.get('*', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'build', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server running on ws://localhost:${PORT}`);
});
