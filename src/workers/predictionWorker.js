
// Import TensorFlow.js
importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js');

// Initialize worker state
let model = null;
let requestId = null;

// Listen for messages from the main thread
self.addEventListener('message', async (event) => {
  const { type, data, id } = event.data;
  requestId = id;

  try {
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
      default:
        throw new Error(`Unknown operation: ${type}`);
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error.message,
      id: requestId
    });
  }
});

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
      
      self.postMessage({
        type: 'cleanup_complete',
        id: requestId
      });
    } catch (error) {
      self.postMessage({
        type: 'error',
        error: error.message,
        id: requestId
      });
    }
  }
}

// Function to preprocess the data
function preprocessData(data, sequenceLength) {
  const { timeSeries, min, range } = data;
  
  // Extract closing prices and normalize the data
  const closingPrices = timeSeries.map(entry => (entry.close - min) / range);
  
  const xs = [];
  const ys = [];
  
  // Create sequences
  for (let i = 0; i < closingPrices.length - sequenceLength; i++) {
    const sequence = closingPrices.slice(i, i + sequenceLength);
    const target = closingPrices[i + sequenceLength];
    xs.push(sequence);
    ys.push(target);
  }
  
  // Convert to tensors
  const xsTensor = tf.tensor2d(xs, [xs.length, sequenceLength]);
  const ysTensor = tf.tensor1d(ys);
  
  return { xsTensor, ysTensor };
}

// Function to train the model
async function trainModel(data) {
  const { stockData, sequenceLength, epochs, batchSize, signal } = data;
  
  try {
    // Calculate min and max values for normalization
    const closingPrices = stockData.timeSeries.map(entry => entry.close);
    const min = Math.min(...closingPrices);
    const max = Math.max(...closingPrices);
    const range = max - min;
    
    // Preprocess the data
    const { xsTensor, ysTensor } = preprocessData({
      timeSeries: stockData.timeSeries,
      min,
      range
    }, sequenceLength);
    
    // Split the data into training and validation sets (80/20 split)
    const splitIdx = Math.floor(xsTensor.shape[0] * 0.8);
    
    const xsTrain = xsTensor.slice([0, 0], [splitIdx, sequenceLength]);
    const xsTest = xsTensor.slice([splitIdx, 0], [xsTensor.shape[0] - splitIdx, sequenceLength]);
    
    const ysTrain = ysTensor.slice([0], [splitIdx]);
    const ysTest = ysTensor.slice([splitIdx], [ysTensor.shape[0] - splitIdx]);
    
    // Create and compile the model
    if (model) {
      model.dispose();
    }
    
    model = tf.sequential();
    
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
    
    // Reshape inputs for LSTM
    const xsTrainReshaped = xsTrain.reshape([xsTrain.shape[0], xsTrain.shape[1], 1]);
    const xsTestReshaped = xsTest.reshape([xsTest.shape[0], xsTest.shape[1], 1]);
    
    // Create a callback to report progress
    const batchesPerEpoch = Math.ceil(xsTrainReshaped.shape[0] / batchSize);
    
    const history = {
      loss: [],
      val_loss: []
    };
    
    // Train the model with batch processing
    for (let epoch = 0; epoch < epochs; epoch++) {
      // Check if canceled
      if (signal && signal.aborted) {
        throw new Error('Training was canceled');
      }
      
      let batchLoss = 0;
      
      // Process in batches
      for (let batchStart = 0; batchStart < xsTrainReshaped.shape[0]; batchStart += batchSize) {
        const batchEnd = Math.min(batchStart + batchSize, xsTrainReshaped.shape[0]);
        const batchX = xsTrainReshaped.slice([batchStart, 0, 0], 
                                            [batchEnd - batchStart, sequenceLength, 1]);
        const batchY = ysTrain.slice([batchStart], [batchEnd - batchStart]);
        
        const result = await model.trainOnBatch(batchX, batchY);
        batchLoss += result;
        
        // Free memory after each batch
        tf.dispose([batchX, batchY]);
      }
      
      // Calculate batch average loss
      const avgLoss = batchLoss / batchesPerEpoch;
      
      // Evaluate on validation set
      const valLoss = await model.evaluate(xsTestReshaped, ysTest);
      const valLossValue = await valLoss.dataSync()[0];
      tf.dispose(valLoss);
      
      // Store loss values
      history.loss.push(avgLoss);
      history.val_loss.push(valLossValue);
      
      // Report progress
      self.postMessage({
        type: 'progress',
        epoch: epoch + 1,
        totalEpochs: epochs,
        loss: avgLoss,
        val_loss: valLossValue,
        id: requestId
      });
    }
    
    // Save the trained model
    const modelData = await model.save(tf.io.withSaveHandler(async modelArtifacts => {
      return modelArtifacts;
    }));
    
    // Send the results
    self.postMessage({
      type: 'trained',
      modelData,
      min,
      range,
      history,
      id: requestId
    });
    
    // Cleanup tensors
    tf.dispose([xsTensor, ysTensor, xsTrain, xsTest, ysTrain, ysTest, xsTrainReshaped, xsTestReshaped]);
    
  } catch (error) {
    // Clean up in case of error
    tf.disposeVariables();
    throw error;
  }
}

// Function to make predictions
async function makePredictions(data) {
  const { modelData, stockData, sequenceLength, min, range, daysToPredict, signal } = data;
  
  try {
    // Load the model if needed
    if (!model) {
      model = await tf.loadLayersModel(tf.io.fromMemory(modelData));
    }
    
    // Get the last sequence for prediction
    const closingPrices = stockData.timeSeries.map(entry => (entry.close - min) / range);
    const lastSequence = closingPrices.slice(-sequenceLength);
    
    // Make predictions for the specified number of days
    const predictions = [];
    let currentSequence = [...lastSequence];
    
    // Get the last date from the data
    const lastDate = new Date(stockData.timeSeries[stockData.timeSeries.length - 1].date);
    
    for (let i = 0; i < daysToPredict; i++) {
      // Check if canceled
      if (signal && signal.aborted) {
        throw new Error('Prediction was canceled');
      }
      
      // Reshape the sequence for prediction
      const inputTensor = tf.tensor2d([currentSequence], [1, sequenceLength]);
      const inputReshaped = inputTensor.reshape([1, sequenceLength, 1]);
      
      // Make a prediction
      const predictionTensor = model.predict(inputReshaped);
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
      
      // Clean up tensors
      tf.dispose([inputTensor, inputReshaped, predictionTensor]);
    }
    
    // Send the results
    self.postMessage({
      type: 'predicted',
      predictions,
      id: requestId
    });
    
  } catch (error) {
    // Clean up in case of error
    tf.disposeVariables();
    throw error;
  }
}
