import * as tf from "@tensorflow/tfjs";
import { toast } from "sonner";
import { StockData, TimeSeriesData } from "@/types/stock";

// Worker for training the model
const createWorker = () => {
  const workerCode = `
    importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs/dist/tf.min.js');

    self.onmessage = async function(e) {
      const { type, data, id } = e.data;

      if (type === 'train') {
        const { features, labels, epochs, batchSize } = data;
        
        try {
          // Convert to tensors
          const xs = tf.tensor2d(features);
          const ys = tf.tensor2d(labels);
          
          // Create model with simpler architecture
          const model = tf.sequential();
          
          // Add layers - simplified architecture
          model.add(tf.layers.dense({
            units: 32, // Reduced from 50
            activation: 'relu',
            inputShape: [features[0].length]
          }));
          
          model.add(tf.layers.dropout({ rate: 0.1 })); // Reduced dropout
          
          model.add(tf.layers.dense({
            units: 16, // Reduced from 30
            activation: 'relu'
          }));
          
          model.add(tf.layers.dense({
            units: labels[0].length,
            activation: 'linear'
          }));
          
          // Compile model with increased learning rate
          model.compile({
            optimizer: tf.train.adam(0.005), // Increased from 0.001
            loss: 'meanSquaredError',
            metrics: ['mse']
          });
          
          // Train model with progress updates
          let lastUpdate = Date.now();
          const history = await model.fit(xs, ys, {
            epochs,
            batchSize,
            validationSplit: 0.1,
            shuffle: true,
            callbacks: {
              onEpochEnd: (epoch, logs) => {
                const now = Date.now();
                // Only send update every 300ms to avoid flooding the main thread
                if (now - lastUpdate > 300) {
                  self.postMessage({
                    type: 'progress',
                    id,
                    data: {
                      epoch,
                      totalEpochs: epochs,
                      loss: logs.loss,
                      val_loss: logs.val_loss
                    }
                  });
                  lastUpdate = now;
                }
              }
            }
          });
          
          // Save model as ArrayBuffer to send back to main thread
          const modelData = await model.save(tf.io.withSaveHandler(async (modelArtifacts) => {
            return modelArtifacts;
          }));
          
          // Send final model and training history back
          self.postMessage({
            type: 'complete',
            id,
            data: {
              model: modelData,
              history: {
                loss: history.history.loss,
                val_loss: history.history.val_loss
              }
            }
          });
          
          // Clean up
          xs.dispose();
          ys.dispose();
          model.dispose();
          tf.disposeVariables(); // Add explicit cleanup
          
        } catch (error) {
          self.postMessage({
            type: 'error',
            id,
            data: error.message
          });
        }
      }
      
      if (type === 'predict') {
        const { model, features } = data;
        
        try {
          // Load the model
          const loadedModel = await tf.loadLayersModel(tf.io.fromMemory(model));
          
          // Convert features to tensor
          const xs = tf.tensor2d(features);
          
          // Make prediction
          const prediction = loadedModel.predict(xs);
          
          // Convert to array and send back
          const predictionData = Array.isArray(prediction) 
            ? await prediction[0].array() 
            : await prediction.array();
          
          self.postMessage({
            type: 'prediction',
            id,
            data: predictionData
          });
          
          // Clean up
          xs.dispose();
          loadedModel.dispose();
          if (Array.isArray(prediction)) {
            prediction.forEach(p => p.dispose());
          } else {
            prediction.dispose();
          }
          tf.disposeVariables(); // Add explicit cleanup
          
        } catch (error) {
          self.postMessage({
            type: 'error',
            id,
            data: error.message
          });
        }
      }
    };
  `;

  const blob = new Blob([workerCode], { type: "application/javascript" });
  return new Worker(URL.createObjectURL(blob));
};

// Create sequences for time series prediction
const createSequences = (
  data: number[],
  sequenceLength: number
): [number[][], number[][]] => {
  const xs: number[][] = [];
  const ys: number[][] = [];

  for (let i = 0; i < data.length - sequenceLength - 1; i++) {
    const sequence = data.slice(i, i + sequenceLength);
    xs.push(sequence);
    ys.push([data[i + sequenceLength]]);
  }

  return [xs, ys];
};

// Normalize data
const normalizeData = (data: number[]): [number[], number, number] => {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;
  
  const normalized = data.map(x => (x - min) / range);
  
  return [normalized, min, range];
};

// Denormalize data
const denormalizeData = (
  normalizedData: number | number[],
  min: number,
  range: number
): number | number[] => {
  if (Array.isArray(normalizedData)) {
    return normalizedData.map(x => x * range + min);
  }
  return normalizedData * range + min;
};

// Prepare data for training
const prepareTrainingData = (
  stockData: StockData,
  sequenceLength: number = 10
): {
  features: number[][];
  labels: number[][];
  min: number;
  range: number;
} => {
  // Extract closing prices and reverse to have oldest first
  const closingPrices = stockData.timeSeries
    .map(data => data.close)
    .reverse();

  // Normalize data
  const [normalizedPrices, min, range] = normalizeData(closingPrices);

  // Create sequences
  const [features, labels] = createSequences(normalizedPrices, sequenceLength);

  return {
    features,
    labels,
    min,
    range,
  };
};

// Extract features for prediction
const extractFeaturesForPrediction = (
  stockData: StockData,
  sequenceLength: number = 10,
  min: number,
  range: number
): number[][] => {
  // Extract the most recent data points
  const closingPrices = stockData.timeSeries
    .map(data => data.close)
    .slice(-sequenceLength)
    .reverse();

  // Normalize
  const normalizedPrices = closingPrices.map(price => (price - min) / range);

  // Return as a single feature set
  return [normalizedPrices];
};

// Generate unique ID for requests
const generateRequestId = () => {
  return Math.random().toString(36).substring(2, 15);
};

// Train model with worker
export const trainModelWithWorker = (
  stockData: StockData,
  sequenceLength: number = 10,
  epochs: number = 100,
  batchSize: number = 32,
  onProgress?: (progress: { epoch: number; totalEpochs: number; loss: number }) => void,
  abortSignal?: AbortSignal
): Promise<{
  modelData: any;
  min: number;
  range: number;
  history: { loss: number[]; val_loss: number[] };
}> => {
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    const requestId = generateRequestId();

    // Set up abort handling
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        worker.terminate();
        reject(new Error("Prediction was cancelled"));
      });
      
      // If already aborted, reject immediately
      if (abortSignal.aborted) {
        reject(new Error("Prediction was cancelled"));
        return;
      }
    }

    // Prepare data - Use smaller slice of data for better performance
    const { timeSeries } = stockData;
    const dataForTraining = {
      ...stockData,
      timeSeries: timeSeries.slice(-365) // Use at most last year of data
    };
    
    const { features, labels, min, range } = prepareTrainingData(
      dataForTraining,
      sequenceLength
    );

    // Set up message handling
    worker.onmessage = (e) => {
      const { type, id, data } = e.data;
      
      // Ignore messages for other requests
      if (id !== requestId) return;

      if (type === "progress" && onProgress) {
        onProgress(data);
      } else if (type === "complete") {
        resolve({
          modelData: data.model,
          min,
          range,
          history: data.history,
        });
        worker.terminate();
      } else if (type === "error") {
        reject(new Error(data));
        worker.terminate();
      }
    };

    // Start training
    worker.postMessage({
      type: "train",
      id: requestId,
      data: {
        features,
        labels,
        epochs,
        batchSize,
      },
    });
  });
};

// Make predictions with worker
export const predictWithWorker = (
  modelData: any,
  stockData: StockData,
  sequenceLength: number = 10,
  min: number,
  range: number,
  daysToPredict: number = 7,
  abortSignal?: AbortSignal
): Promise<{ date: string; prediction: number }[]> => {
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    const requestId = generateRequestId();

    // Set up abort handling
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        worker.terminate();
        reject(new Error("Prediction was cancelled"));
      });
      
      // If already aborted, reject immediately
      if (abortSignal.aborted) {
        reject(new Error("Prediction was cancelled"));
        return;
      }
    }

    // Prepare initial features
    let features = extractFeaturesForPrediction(
      stockData,
      sequenceLength,
      min,
      range
    );

    // Generate future dates
    const lastDate = new Date(stockData.timeSeries[stockData.timeSeries.length - 1].date);
    const futureDates: string[] = [];
    
    for (let i = 1; i <= daysToPredict; i++) {
      const nextDate = new Date(lastDate);
      nextDate.setDate(lastDate.getDate() + i);
      // Skip weekends
      while (nextDate.getDay() === 0 || nextDate.getDay() === 6) {
        nextDate.setDate(nextDate.getDate() + 1);
      }
      futureDates.push(nextDate.toISOString().split('T')[0]);
    }

    // Make all predictions at once to improve performance
    const makeBatchPredictions = async () => {
      try {
        const allPredictions: { date: string; prediction: number }[] = [];
        let currentFeatures = [...features[0]];
        
        // First prediction
        worker.postMessage({
          type: "predict",
          id: requestId,
          data: {
            model: modelData,
            features: [currentFeatures]
          }
        });
        
        // Set up message handling for sequence of predictions
        for (let i = 0; i < daysToPredict; i++) {
          // Wait for response
          const result = await new Promise((res, rej) => {
            const messageHandler = (e: MessageEvent) => {
              const { type, id, data } = e.data;
              
              // Ignore messages for other requests
              if (id !== requestId) return;
              
              if (type === "prediction") {
                res(data[0][0]);
                worker.removeEventListener('message', messageHandler);
              } else if (type === "error") {
                rej(new Error(data));
                worker.removeEventListener('message', messageHandler);
              }
            };
            
            worker.addEventListener('message', messageHandler);
          });
          
          // Add to predictions
          const normalizedPrediction = result as number;
          const prediction = denormalizeData(normalizedPrediction, min, range) as number;
          
          allPredictions.push({
            date: futureDates[i],
            prediction
          });
          
          // Update features for next prediction, if needed
          if (i < daysToPredict - 1) {
            currentFeatures = [...currentFeatures.slice(1), normalizedPrediction];
            
            // Check for abort before continuing
            if (abortSignal?.aborted) {
              throw new Error("Prediction was cancelled");
            }
            
            // Send next prediction request
            worker.postMessage({
              type: "predict",
              id: requestId,
              data: {
                model: modelData,
                features: [currentFeatures]
              }
            });
          }
        }
        
        return allPredictions;
      } finally {
        // Always terminate worker when done
        worker.terminate();
      }
    };
    
    // Run the predictions
    makeBatchPredictions()
      .then(resolve)
      .catch(reject);
  });
};

// Evaluate model performance
export const evaluateModel = (
  actualData: TimeSeriesData[],
  predictions: { date: string; prediction: number }[]
): {
  mse: number;
  rmse: number;
  mae: number;
  mape: number;
} => {
  // Create a map of actual data by date
  const actualByDate = new Map<string, number>();
  actualData.forEach(data => {
    actualByDate.set(data.date, data.close);
  });

  // Filter predictions to only those with actual data
  const validPredictions = predictions.filter(p => actualByDate.has(p.date));
  
  if (validPredictions.length === 0) {
    return { mse: NaN, rmse: NaN, mae: NaN, mape: NaN };
  }

  // Calculate errors
  let sumSquaredError = 0;
  let sumAbsError = 0;
  let sumAbsPercentError = 0;

  validPredictions.forEach(pred => {
    const actual = actualByDate.get(pred.date)!;
    const error = pred.prediction - actual;
    
    sumSquaredError += error * error;
    sumAbsError += Math.abs(error);
    sumAbsPercentError += Math.abs(error / actual) * 100;
  });

  const mse = sumSquaredError / validPredictions.length;
  const rmse = Math.sqrt(mse);
  const mae = sumAbsError / validPredictions.length;
  const mape = sumAbsPercentError / validPredictions.length;

  return { mse, rmse, mae, mape };
};

// Initialize TensorFlow.js
export const initializeTensorFlow = async (): Promise<void> => {
  try {
    // Set memory management options
    tf.env().set('WEBGL_DELETE_TEXTURE_THRESHOLD', 0); // Lower threshold for texture deletion
    tf.env().set('WEBGL_FORCE_F16_TEXTURES', true); // Use F16 textures to reduce memory
    
    await tf.ready();
    console.log("TensorFlow.js initialized successfully");
  } catch (error) {
    console.error("Failed to initialize TensorFlow.js:", error);
    toast.error("Failed to initialize machine learning capabilities. Some features may not work properly.");
  }
};
