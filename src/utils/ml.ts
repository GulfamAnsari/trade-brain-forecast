
import { StockData, PredictionResult } from "@/types/stock";

// Worker instances cache
let trainWorker: Worker | null = null;
let predictWorker: Worker | null = null;

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
    // Use the existing worker file
    const worker = new Worker('/src/workers/predictionWorker.js', { type: 'module' });
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
      reject(error);
      worker.terminate();
      trainWorker = null;
    };
    
    // Handle abortion
    signal.addEventListener('abort', () => {
      reject(new Error('Training was canceled'));
      worker.terminate();
      trainWorker = null;
    });
    
    // Start the training process
    worker.postMessage({
      type: 'train',
      data: {
        stockData,
        sequenceLength,
        epochs,
        batchSize,
        signal
      },
      id: requestId
    });
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
    // Use the existing worker file
    const worker = new Worker('/src/workers/predictionWorker.js', { type: 'module' });
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
      reject(error);
      worker.terminate();
      predictWorker = null;
    };
    
    // Handle abortion
    signal.addEventListener('abort', () => {
      reject(new Error('Prediction was canceled'));
      worker.terminate();
      predictWorker = null;
    });
    
    // Start the prediction process
    worker.postMessage({
      type: 'predict',
      data: {
        modelData,
        stockData,
        sequenceLength,
        min,
        range,
        daysToPredict,
        signal
      },
      id: requestId
    });
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
