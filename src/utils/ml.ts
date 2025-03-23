
import { StockData, PredictionResult } from "@/types/stock";
import * as tf from '@tensorflow/tfjs';

// Worker instances cache
let trainWorker: Worker | null = null;
let predictWorker: Worker | null = null;

// Function to initialize TensorFlow
export const initializeTensorFlow = async () => {
  try {
    // Enable WebGL backend for better performance
    await tf.setBackend('webgl');
    await tf.ready();
    console.log('TensorFlow initialized with backend:', tf.getBackend());
  } catch (error) {
    console.error('Error initializing TensorFlow:', error);
    // Fallback to CPU if WebGL fails
    try {
      await tf.setBackend('cpu');
      await tf.ready();
      console.log('TensorFlow fallback to CPU backend');
    } catch (fallbackError) {
      console.error('Failed to initialize TensorFlow:', fallbackError);
    }
  }
};

// Create a worker with error handling
const createWorker = () => {
  try {
    return new Worker(new URL('../workers/predictionWorker.js', import.meta.url), { type: 'module' });
  } catch (error) {
    console.error("Error creating worker:", error);
    throw new Error("Failed to initialize prediction worker");
  }
};

// Function to train a model with a worker
export const trainModelWithWorker = (
  stockData: StockData,
  sequenceLength: number,
  epochs: number,
  batchSize: number,
  onProgress: (progress: { epoch: number; totalEpochs: number; loss: number }) => void,
  signal: AbortSignal
): Promise<{
  modelData: any;
  min: number;
  range: number;
  history: { loss: number[]; val_loss: number[] };
}> => {
  return new Promise((resolve, reject) => {
    try {
      // Create a new worker or use the existing one
      if (trainWorker) {
        trainWorker.terminate();
      }
      
      const worker = createWorker();
      trainWorker = worker;
      
      // Generate a unique request ID
      const requestId = Date.now().toString();
      
      // Set up message handler
      worker.onmessage = (event) => {
        const { type, error, id, ...data } = event.data;
        
        // Ignore messages from other requests
        if (id !== requestId) return;
        
        if (type === 'progress') {
          onProgress({
            epoch: data.epoch,
            totalEpochs: data.totalEpochs,
            loss: data.loss
          });
        } else if (type === 'trained') {
          resolve({
            modelData: data.modelData,
            min: data.min,
            range: data.range,
            history: data.history
          });
          worker.terminate();
          trainWorker = null;
        } else if (type === 'error') {
          reject(new Error(error));
          worker.terminate();
          trainWorker = null;
        }
      };
      
      // Handle worker errors
      worker.onerror = (error) => {
        console.error("Worker error in trainModelWithWorker:", error);
        reject(new Error("Training worker encountered an error"));
        worker.terminate();
        trainWorker = null;
      };
      
      // Handle abortion - but don't pass the signal directly
      const abortHandler = () => {
        console.log("Training aborted by user");
        // Notify worker about abortion
        worker.postMessage({
          type: 'abort',
          id: requestId
        });
        reject(new Error('Training was canceled'));
        worker.terminate();
        trainWorker = null;
      };
      
      // Add abort listener
      signal.addEventListener('abort', abortHandler);
      
      // Validate data before sending to worker
      if (!stockData || !stockData.timeSeries || stockData.timeSeries.length < sequenceLength + 5) {
        throw new Error(`Not enough data points for training. Need at least ${sequenceLength + 5}.`);
      }
      
      // Start the training process - don't pass the signal
      worker.postMessage({
        type: 'train',
        data: {
          stockData,
          sequenceLength,
          epochs,
          batchSize
        },
        id: requestId
      });
    } catch (error) {
      console.error("Error creating worker in trainModelWithWorker:", error);
      reject(error);
    }
  });
};

// Function to make predictions with a worker
export const predictWithWorker = (
  modelData: any,
  stockData: StockData,
  sequenceLength: number,
  min: number,
  range: number,
  daysToPredict: number,
  signal: AbortSignal
): Promise<PredictionResult[]> => {
  return new Promise((resolve, reject) => {
    try {
      // Create a new worker or use the existing one
      if (predictWorker) {
        predictWorker.terminate();
      }
      
      const worker = createWorker();
      predictWorker = worker;
      
      // Generate a unique request ID
      const requestId = Date.now().toString();
      
      // Set up message handler
      worker.onmessage = (event) => {
        const { type, error, id, ...data } = event.data;
        
        // Ignore messages from other requests
        if (id !== requestId) return;
        
        if (type === 'predicted') {
          resolve(data.predictions);
          worker.terminate();
          predictWorker = null;
        } else if (type === 'error') {
          reject(new Error(error));
          worker.terminate();
          predictWorker = null;
        }
      };
      
      // Handle worker errors
      worker.onerror = (error) => {
        console.error("Worker error in predictWithWorker:", error);
        reject(new Error("Prediction worker encountered an error"));
        worker.terminate();
        predictWorker = null;
      };
      
      // Handle abortion - but don't pass the signal directly
      const abortHandler = () => {
        console.log("Prediction aborted by user");
        // Notify worker about abortion
        worker.postMessage({
          type: 'abort',
          id: requestId
        });
        reject(new Error('Prediction was canceled'));
        worker.terminate();
        predictWorker = null;
      };
      
      // Add abort listener
      signal.addEventListener('abort', abortHandler);
      
      // Validate data before sending to worker
      if (!modelData) {
        throw new Error("Model data is required for prediction");
      }
      
      if (!stockData || !stockData.timeSeries || stockData.timeSeries.length < sequenceLength) {
        throw new Error(`Not enough data points for prediction. Need at least ${sequenceLength}.`);
      }
      
      // Start the prediction process - don't pass the signal
      worker.postMessage({
        type: 'predict',
        data: {
          modelData,
          stockData,
          sequenceLength,
          min,
          range,
          daysToPredict
        },
        id: requestId
      });
    } catch (error) {
      console.error("Error creating worker in predictWithWorker:", error);
      reject(error);
    }
  });
};

// Function to clean up workers
export const cleanupWorkers = () => {
  if (trainWorker) {
    trainWorker.terminate();
    trainWorker = null;
  }
  
  if (predictWorker) {
    predictWorker.terminate();
    predictWorker = null;
  }
};
