// Worker setup with better error handling
self.addEventListener('error', (e) => {
  console.error('Worker global error:', e.message, e.filename, e.lineno);
  self.postMessage({
    type: 'error',
    error: `Global worker error: ${e.message}`,
    id: self.requestId || 'unknown'
  });
});

// Import TensorFlow.js via CDN with error handling
try {
  importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js');
  console.log("TensorFlow.js successfully loaded in worker");
} catch (error) {
  console.error("Failed to load TensorFlow.js in worker:", error);
  self.postMessage({
    type: 'error',
    error: "Failed to load TensorFlow.js in worker: " + (error ? error.message : "Unknown error"),
    id: self.requestId || 'unknown'
  });
}

// Initialize worker state
let model = null;
let requestId = null;
let isAborted = false; // Flag to track abort status

// Safe post message that handles errors
function safePostMessage(message) {
  try {
    self.postMessage(message);
  } catch (error) {
    console.error("Error posting message from worker:", error);
    // Try to send a simplified error message
    try {
      self.postMessage({
        type: 'error',
        error: "Failed to send message from worker: " + error.message,
        id: message.id || 'unknown'
      });
    } catch (e) {
      console.error("Critical error: Could not send any message from worker");
    }
  }
}

// Listen for messages from the main thread
self.addEventListener('message', async (event) => {
  const { type, data, id } = event.data;
  requestId = id;
  self.requestId = id; // Store globally for error handler
  
  // Reset abort flag on new requests
  if (type === 'train' || type === 'predict') {
    isAborted = false;
  }

  try {
    console.log(`Worker received ${type} operation with id ${id}`);
    
    switch (type) {
      case 'train':
        await trainModel(data);
        break;
      case 'predict':
        await makePredictions(data);
        break;
      case 'cleanup':
        cleanup();
        break;
      case 'abort':
        // Set the abort flag
        isAborted = true;
        console.log('Worker received abort signal');
        break;
      default:
        throw new Error(`Unknown operation: ${type}`);
    }
  } catch (error) {
    console.error('Worker operation error:', error);
    safePostMessage({
      type: 'error',
      error: error.message || 'Unknown error in worker',
      id: requestId
    });
    
    // Try to clean up resources on error
    try {
      if (model) {
        model.dispose();
      }
      tf.disposeVariables();
    } catch (cleanupError) {
      console.error("Error during cleanup after worker error:", cleanupError);
    }
  }
});

// Check if operation has been aborted
function checkAborted() {
  if (isAborted) {
    throw new Error('Operation was canceled');
  }
}

// Clean up TensorFlow memory and models
function cleanup() {
  if (model) {
    try {
      // Dispose the model to free memory
      model.dispose();
      model = null;
      // Run garbage collection
      tf.disposeVariables();
      tf.engine().endScope();
      tf.engine().startScope();
      
      safePostMessage({
        type: 'cleanup_complete',
        id: requestId
      });
    } catch (error) {
      safePostMessage({
        type: 'error',
        error: error.message,
        id: requestId
      });
    }
  }
}

// Function to safely dispose tensors
function safeTensorDispose(tensors) {
  if (!tensors) return;
  
  if (Array.isArray(tensors)) {
    tensors.forEach(tensor => {
      if (tensor && typeof tensor.dispose === 'function') {
        try {
          tensor.dispose();
        } catch (e) {
          console.error("Error disposing tensor:", e);
        }
      }
    });
  } else if (tensors && typeof tensors.dispose === 'function') {
    try {
      tensors.dispose();
    } catch (e) {
      console.error("Error disposing tensor:", e);
    }
  }
}

// Function to preprocess the data
function preprocessData(data, sequenceLength) {
  let xsTensor = null;
  let ysTensor = null;
  
  try {
    const { timeSeries, min, range } = data;
    
    if (!timeSeries || !Array.isArray(timeSeries) || timeSeries.length === 0) {
      throw new Error("Invalid time series data provided");
    }
    
    // Extract closing prices and normalize the data
    const closingPrices = timeSeries.map(entry => {
      if (typeof entry.close !== 'number') {
        throw new Error("Invalid closing price value in time series");
      }
      return (entry.close - min) / range;
    });
    
    const xs = [];
    const ys = [];
    
    // Create sequences
    for (let i = 0; i < closingPrices.length - sequenceLength; i++) {
      const sequence = closingPrices.slice(i, i + sequenceLength);
      const target = closingPrices[i + sequenceLength];
      xs.push(sequence);
      ys.push(target);
    }
    
    if (xs.length === 0 || ys.length === 0) {
      throw new Error("Failed to create valid sequences from data");
    }
    
    // Convert to tensors
    xsTensor = tf.tensor2d(xs, [xs.length, sequenceLength]);
    ysTensor = tf.tensor1d(ys);
    
    return { xsTensor, ysTensor };
  } catch (error) {
    console.error("Error in preprocessData:", error);
    
    // Clean up on error
    safeTensorDispose([xsTensor, ysTensor]);
    
    throw new Error(`Data preprocessing failed: ${error.message}`);
  }
}

// Function to train the model
async function trainModel(data) {
  console.log("Training model with data:", 
    JSON.stringify({
      hasStockData: !!data.stockData,
      timeSeriesLength: data.stockData ? data.stockData.timeSeries.length : 0,
      sequenceLength: data.sequenceLength,
      epochs: data.epochs,
      batchSize: data.batchSize
    })
  );
  
  const { stockData, sequenceLength, epochs, batchSize } = data;
  
  // Tensors to keep track of for disposal
  const tensorsToDispose = [];
  
  try {
    if (!stockData || !stockData.timeSeries || stockData.timeSeries.length === 0) {
      throw new Error("Invalid stock data provided");
    }
    
    // Calculate min and max values for normalization
    const closingPrices = stockData.timeSeries.map(entry => entry.close);
    const min = Math.min(...closingPrices);
    const max = Math.max(...closingPrices);
    const range = max - min;
    
    console.log("Data range:", { min, max, range });
    
    if (range === 0) {
      throw new Error("Cannot normalize data: all closing prices are identical");
    }
    
    // Preprocess the data
    const { xsTensor, ysTensor } = preprocessData({
      timeSeries: stockData.timeSeries,
      min,
      range
    }, sequenceLength);
    
    tensorsToDispose.push(xsTensor, ysTensor);
    
    if (xsTensor.shape[0] < 10) {
      throw new Error("Not enough data for training");
    }
    
    // Check if operation was aborted
    checkAborted();
    
    console.log("Data preprocessed, tensor shapes:", {
      xsShape: xsTensor.shape,
      ysShape: ysTensor.shape
    });
    
    // Split the data into training and validation sets (80/20 split)
    const splitIdx = Math.floor(xsTensor.shape[0] * 0.8);
    
    const xsTrain = xsTensor.slice([0, 0], [splitIdx, sequenceLength]);
    const xsTest = xsTensor.slice([splitIdx, 0], [xsTensor.shape[0] - splitIdx, sequenceLength]);
    
    const ysTrain = ysTensor.slice([0], [splitIdx]);
    const ysTest = ysTensor.slice([splitIdx], [ysTensor.shape[0] - splitIdx]);
    
    tensorsToDispose.push(xsTrain, xsTest, ysTrain, ysTest);
    
    // Create and compile the model
    if (model) {
      model.dispose();
    }
    
    console.log("Creating model...");
    model = tf.sequential();
    
    // Add layers to the model with error handling
    try {
      // Add layers to the model
      model.add(tf.layers.lstm({
        units: 50,
        returnSequences: false,
        inputShape: [sequenceLength, 1]
      }));
      
      model.add(tf.layers.dense({ units: 1 }));
      
      // Compile the model
      model.compile({
        optimizer: 'adam',
        loss: 'meanSquaredError'
      });
      
      console.log("Model created and compiled successfully");
    } catch (modelError) {
      console.error("Error creating model:", modelError);
      throw new Error("Failed to create or compile model: " + modelError.message);
    }
    
    // Reshape inputs for LSTM
    const xsTrainReshaped = xsTrain.reshape([xsTrain.shape[0], xsTrain.shape[1], 1]);
    const xsTestReshaped = xsTest.reshape([xsTest.shape[0], xsTest.shape[1], 1]);
    
    tensorsToDispose.push(xsTrainReshaped, xsTestReshaped);
    
    // Create a callback to report progress
    const batchesPerEpoch = Math.ceil(xsTrainReshaped.shape[0] / batchSize);
    
    const history = {
      loss: [],
      val_loss: []
    };
    
    console.log("Starting training with", epochs, "epochs...");
    
    // Train the model with batch processing
    for (let epoch = 0; epoch < epochs; epoch++) {
      // Check if operation was aborted between epochs
      checkAborted();
      
      let batchLoss = 0;
      
      // Process in batches
      for (let batchStart = 0; batchStart < xsTrainReshaped.shape[0]; batchStart += batchSize) {
        // Check if operation was aborted within an epoch
        if (batchStart % (batchSize * 3) === 0) { // Check every few batches
          checkAborted();
        }
        
        const batchEnd = Math.min(batchStart + batchSize, xsTrainReshaped.shape[0]);
        const batchSize = batchEnd - batchStart;
        
        if (batchSize <= 0) {
          console.warn("Skipping empty batch");
          continue;
        }
        
        const batchX = xsTrainReshaped.slice([batchStart, 0, 0], 
                                            [batchSize, sequenceLength, 1]);
        const batchY = ysTrain.slice([batchStart], [batchSize]);
        
        // Add to disposal list
        tensorsToDispose.push(batchX, batchY);
        
        const result = await model.trainOnBatch(batchX, batchY);
        batchLoss += result;
        
        // Free memory after each batch
        safeTensorDispose([batchX, batchY]);
        
        // Remove from disposal list
        tensorsToDispose.pop();
        tensorsToDispose.pop();
      }
      
      // Calculate batch average loss
      const avgLoss = batchLoss / batchesPerEpoch;
      
      // Evaluate on validation set
      let valLoss;
      try {
        valLoss = await model.evaluate(xsTestReshaped, ysTest);
        tensorsToDispose.push(valLoss);
        
        const valLossValue = await valLoss.dataSync()[0];
        
        // Store loss values
        history.loss.push(avgLoss);
        history.val_loss.push(valLossValue);
        
        // Report progress
        safePostMessage({
          type: 'progress',
          epoch: epoch + 1,
          totalEpochs: epochs,
          loss: avgLoss,
          val_loss: valLossValue,
          id: requestId
        });
        
        safeTensorDispose([valLoss]);
        tensorsToDispose.pop(); // Remove valLoss
      } catch (evalError) {
        console.error("Error during validation evaluation:", evalError);
        // Continue training even if validation fails
      }
    }
    
    // Check if operation was aborted before completing
    checkAborted();
    
    console.log("Training complete, saving model...");
    
    // Save the trained model
    let modelData;
    try {
      modelData = await model.save(tf.io.withSaveHandler(async modelArtifacts => {
        return modelArtifacts;
      }));
      
      console.log("Model saved successfully");
    } catch (saveError) {
      console.error("Error saving model:", saveError);
      throw new Error("Failed to save trained model: " + saveError.message);
    }
    
    // Send the results
    safePostMessage({
      type: 'trained',
      modelData,
      min,
      range,
      history,
      id: requestId
    });
    
    console.log("Training results sent to main thread");
    
  } catch (error) {
    console.error('Error in trainModel:', error);
    safePostMessage({
      type: 'error',
      error: error.message || "Unknown training error",
      id: requestId
    });
  } finally {
    // Clean up tensors
    safeTensorDispose(tensorsToDispose);
    
    // Run garbage collection
    try {
      tf.disposeVariables();
    } catch (e) {
      console.error("Error during final cleanup:", e);
    }
  }
}

// Function to make predictions
async function makePredictions(data) {
  const { modelData, stockData, sequenceLength, min, range, daysToPredict } = data;
  
  // Tensors to keep track of for disposal
  const tensorsToDispose = [];
  
  try {
    if (!modelData) {
      throw new Error("Model data is missing");
    }
    
    if (!stockData || stockData.timeSeries.length < sequenceLength) {
      throw new Error("Not enough data points for prediction");
    }
    
    // Check if operation was aborted
    checkAborted();
    
    // Load the model if needed
    if (!model) {
      try {
        console.log("Loading model from provided data...");
        model = await tf.loadLayersModel(tf.io.fromMemory(modelData));
        console.log("Model loaded successfully");
      } catch (err) {
        console.error("Error loading model:", err);
        throw new Error("Failed to load prediction model: " + err.message);
      }
    }
    
    // Get the last sequence for prediction
    const closingPrices = stockData.timeSeries.map(entry => (entry.close - min) / range);
    
    if (closingPrices.length < sequenceLength) {
      throw new Error(`Need at least ${sequenceLength} data points, but only got ${closingPrices.length}`);
    }
    
    const lastSequence = closingPrices.slice(-sequenceLength);
    
    // Make predictions for the specified number of days
    const predictions = [];
    let currentSequence = [...lastSequence];
    
    // Get the last date from the data
    const lastDate = new Date(stockData.timeSeries[stockData.timeSeries.length - 1].date);
    
    console.log("Making predictions for", daysToPredict, "days starting from", lastDate);
    
    for (let i = 0; i < daysToPredict; i++) {
      // Check if operation was aborted during prediction
      checkAborted();
      
      // Reshape the sequence for prediction
      const inputTensor = tf.tensor2d([currentSequence], [1, sequenceLength]);
      const inputReshaped = inputTensor.reshape([1, sequenceLength, 1]);
      
      tensorsToDispose.push(inputTensor, inputReshaped);
      
      // Make a prediction
      let predictionTensor;
      try {
        predictionTensor = model.predict(inputReshaped);
        tensorsToDispose.push(predictionTensor);
        
        const predictionValue = await predictionTensor.dataSync()[0];
        
        // Denormalize the prediction
        const denormalizedValue = predictionValue * range + min;
        
        // Calculate the next date (skip weekends)
        const nextDate = new Date(lastDate);
        nextDate.setDate(lastDate.getDate() + i + 1);
        
        // Skip weekends (Saturday = 6, Sunday = 0)
        while (nextDate.getDay() === 6 || nextDate.getDay() === 0) {
          nextDate.setDate(nextDate.getDate() + 1);
        }
        
        // Add the prediction to the results
        predictions.push({
          date: nextDate.toISOString().split('T')[0],
          prediction: denormalizedValue
        });
        
        // Update the sequence for the next prediction
        currentSequence.shift();
        currentSequence.push(predictionValue);
        
        // Clean up tensors for this iteration
        safeTensorDispose([inputTensor, inputReshaped, predictionTensor]);
        tensorsToDispose.pop();
        tensorsToDispose.pop();
        tensorsToDispose.pop();
      } catch (predictionError) {
        console.error("Error making prediction:", predictionError);
        throw new Error("Failed to make prediction: " + predictionError.message);
      }
    }
    
    console.log("Predictions completed:", predictions.length);
    
    // Send the results
    safePostMessage({
      type: 'predicted',
      predictions,
      id: requestId
    });
    
  } catch (error) {
    console.error('Error in makePredictions:', error);
    safePostMessage({
      type: 'error',
      error: error.message || "Unknown prediction error",
      id: requestId
    });
  } finally {
    // Clean up tensors
    safeTensorDispose(tensorsToDispose);
    
    // Run garbage collection
    try {
      tf.disposeVariables();
    } catch (e) {
      console.error("Error during final cleanup:", e);
    }
  }
}

// Log successful worker initialization
console.log("Prediction worker initialized successfully");
