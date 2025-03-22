
import * as tf from "@tensorflow/tfjs";
import { toast } from "sonner";
import { StockData, TimeSeriesData } from "@/types/stock";

// Worker for training the model
const createWorker = () => {
  const workerCode = `
    importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs/dist/tf.min.js');

    self.onmessage = async function(e) {
      const { type, data } = e.data;

      if (type === 'train') {
        const { features, labels, epochs, batchSize } = data;
        
        try {
          // Convert to tensors
          const xs = tf.tensor2d(features);
          const ys = tf.tensor2d(labels);
          
          // Create model
          const model = tf.sequential();
          
          // Add layers
          model.add(tf.layers.dense({
            units: 50,
            activation: 'relu',
            inputShape: [features[0].length]
          }));
          
          model.add(tf.layers.dropout({ rate: 0.2 }));
          
          model.add(tf.layers.dense({
            units: 30,
            activation: 'relu'
          }));
          
          model.add(tf.layers.dropout({ rate: 0.2 }));
          
          model.add(tf.layers.dense({
            units: labels[0].length,
            activation: 'linear'
          }));
          
          // Compile model
          model.compile({
            optimizer: tf.train.adam(0.001),
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
                // Only send update every 500ms to avoid flooding the main thread
                if (now - lastUpdate > 500) {
                  self.postMessage({
                    type: 'progress',
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
          
        } catch (error) {
          self.postMessage({
            type: 'error',
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
          
        } catch (error) {
          self.postMessage({
            type: 'error',
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

// Train model with worker
export const trainModelWithWorker = (
  stockData: StockData,
  sequenceLength: number = 10,
  epochs: number = 100,
  batchSize: number = 32,
  onProgress?: (progress: { epoch: number; totalEpochs: number; loss: number }) => void
): Promise<{
  modelData: any;
  min: number;
  range: number;
  history: { loss: number[]; val_loss: number[] };
}> => {
  return new Promise((resolve, reject) => {
    const worker = createWorker();

    // Prepare data
    const { features, labels, min, range } = prepareTrainingData(
      stockData,
      sequenceLength
    );

    // Set up message handling
    worker.onmessage = (e) => {
      const { type, data } = e.data;

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
  daysToPredict: number = 7
): Promise<{ date: string; prediction: number }[]> => {
  return new Promise((resolve, reject) => {
    const worker = createWorker();

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
      futureDates.push(nextDate.toISOString().split('T')[0]);
    }

    // Set up message handling
    worker.onmessage = (e) => {
      const { type, data } = e.data;

      if (type === "prediction") {
        const predictions: { date: string; prediction: number }[] = [];
        
        // Current prediction is just for the next day
        const normalizedPrediction = data[0][0];
        const prediction = denormalizeData(normalizedPrediction, min, range) as number;
        
        // Store the prediction for the current day
        predictions.push({
          date: futureDates[0],
          prediction,
        });
        
        // If we need more predictions, we need to update features and predict again
        if (daysToPredict > 1) {
          // Create a copy of the features
          const newFeatures = [...features[0]];
          
          // Remove the oldest value
          newFeatures.shift();
          
          // Add the new prediction
          newFeatures.push(normalizedPrediction);
          
          // Make recursive predictions for the remaining days
          predictRemainingDays(
            worker,
            modelData,
            [newFeatures],
            futureDates.slice(1),
            predictions,
            min,
            range,
            1
          );
        } else {
          // We're done, resolve the promise
          resolve(predictions);
          worker.terminate();
        }
      } else if (type === "error") {
        reject(new Error(data));
        worker.terminate();
      }
    };

    // Start prediction for the first day
    worker.postMessage({
      type: "predict",
      data: {
        model: modelData,
        features,
      },
    });
  });
};

// Helper function to recursively predict remaining days
const predictRemainingDays = (
  worker: Worker,
  modelData: any,
  features: number[][],
  futureDates: string[],
  predictions: { date: string; prediction: number }[],
  min: number,
  range: number,
  currentDay: number
) => {
  // Use a local variable to store the original handler
  const handleMessage = (e: MessageEvent) => {
    const { type, data } = e.data;

    if (type === "prediction") {
      // Get the normalized prediction
      const normalizedPrediction = data[0][0];
      
      // Denormalize
      const prediction = denormalizeData(normalizedPrediction, min, range) as number;
      
      // Add to predictions
      predictions.push({
        date: futureDates[0],
        prediction,
      });
      
      // If we have more days to predict
      if (currentDay < futureDates.length - 1) {
        // Create a copy of the features
        const newFeatures = [...features[0]];
        
        // Remove the oldest value
        newFeatures.shift();
        
        // Add the new prediction
        newFeatures.push(normalizedPrediction);
        
        // Remove current message handler
        worker.removeEventListener('message', handleMessage);
        
        // Predict the next day
        predictRemainingDays(
          worker,
          modelData,
          [newFeatures],
          futureDates.slice(1),
          predictions,
          min,
          range,
          currentDay + 1
        );
      } else {
        // We're done, trigger completion
        worker.removeEventListener('message', handleMessage);
        
        // Complete by resolving the promise through the worker's onmessage
        if (worker.onmessage) {
          const completeEvent = new MessageEvent("message", {
            data: {
              type: "complete",
              data: { predictions },
            },
          });
          
          worker.onmessage(completeEvent);
        }
      }
    } else if (type === "error") {
      // Pass the error
      worker.removeEventListener('message', handleMessage);
      
      if (worker.onmessage) {
        const errorEvent = new MessageEvent("message", {
          data: {
            type: "error",
            data: data,
          },
        });
        
        worker.onmessage(errorEvent);
      }
    }
  };

  // Add the message handler
  worker.addEventListener('message', handleMessage);

  // Start prediction for the current day
  worker.postMessage({
    type: "predict",
    data: {
      model: modelData,
      features,
    },
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
    await tf.ready();
    console.log("TensorFlow.js initialized successfully");
  } catch (error) {
    console.error("Failed to initialize TensorFlow.js:", error);
    toast.error("Failed to initialize machine learning capabilities. Some features may not work properly.");
  }
};
