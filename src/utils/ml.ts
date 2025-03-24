import { StockData, PredictionResult } from "@/types/stock";
import { toast } from "sonner";

// Server URL - change this in production
const SERVER_URL = "http://localhost:5000/api";

// Function to initialize TensorFlow
export const initializeTensorFlow = async () => {
  try {
    // Now this function just checks if the server is running
    const response = await fetch(`${SERVER_URL}/status`);
    if (!response.ok) {
      throw new Error('ML server is not responding');
    }
    console.log('ML server is running');
    return true;
  } catch (error) {
    console.error('Error connecting to ML server:', error);
    throw new Error('Unable to connect to ML server. Please ensure it is running.');
  }
};

// Function to train a model using the server API
export const trainModelWithWorker = async (
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
    // Create a function to handle abortion
    const abortHandler = () => {
      reject(new Error('Training was canceled'));
    };

    // Add abort listener
    signal.addEventListener('abort', abortHandler);

    // Make a deep copy of the stock data to avoid reference issues
    const stockDataCopy = {
      ...stockData,
      timeSeries: [...stockData.timeSeries]
    };

    // Validate data before sending to server
    if (!stockData || !stockData.timeSeries || stockData.timeSeries.length < sequenceLength + 5) {
      reject(new Error(`Not enough data points for training. Need at least ${sequenceLength + 5}.`));
      return;
    }

    // Call the server API
    fetch(`${SERVER_URL}/train`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        stockData: stockDataCopy,
        sequenceLength,
        epochs,
        batchSize
      })
    })
    .then(response => {
      if (!response.ok) {
        return response.json().then(err => {
          throw new Error(err.error || 'Server training failed');
        });
      }
      return response.json();
    })
    .then(data => {
      // Simulate progress since we don't have real-time updates yet
      // In a production app, WebSockets would be used here
      for (let i = 1; i <= epochs; i++) {
        if (signal.aborted) break;
        onProgress({
          epoch: i,
          totalEpochs: epochs,
          loss: data.history.loss[Math.min(i-1, data.history.loss.length-1)]
        });
      }
      
      resolve({
        modelData: data.modelData,
        min: data.min,
        range: data.range,
        history: data.history
      });
    })
    .catch(error => {
      console.error("Error in trainModelWithWorker:", error);
      reject(error);
    })
    .finally(() => {
      // Remove abort listener
      signal.removeEventListener('abort', abortHandler);
    });
  });
};

// Function to make predictions using the server API
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
    // Create a function to handle abortion
    const abortHandler = () => {
      reject(new Error('Prediction was canceled'));
    };

    // Add abort listener
    signal.addEventListener('abort', abortHandler);

    // Make a deep copy of the stock data to avoid reference issues
    const stockDataCopy = {
      ...stockData,
      timeSeries: [...stockData.timeSeries]
    };

    // Validate data before sending to server
    if (!modelData) {
      reject(new Error("Model data is required for prediction"));
      return;
    }

    if (!stockData || !stockData.timeSeries || stockData.timeSeries.length < sequenceLength) {
      reject(new Error(`Not enough data points for prediction. Need at least ${sequenceLength}.`));
      return;
    }

    // Call the server API
    fetch(`${SERVER_URL}/predict`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        modelData,
        stockData: stockDataCopy,
        sequenceLength,
        min,
        range,
        daysToPredict
      })
    })
    .then(response => {
      if (!response.ok) {
        return response.json().then(err => {
          throw new Error(err.error || 'Server prediction failed');
        });
      }
      return response.json();
    })
    .then(data => {
      resolve(data.predictions);
    })
    .catch(error => {
      console.error("Error in predictWithWorker:", error);
      reject(error);
    })
    .finally(() => {
      // Remove abort listener
      signal.removeEventListener('abort', abortHandler);
    });
  });
};

// Function to clean up workers (no longer needed with server approach)
export const cleanupWorkers = () => {
  // No workers to clean up, but keeping the function for API compatibility
  console.log("No workers to clean up in server-based approach");
};
