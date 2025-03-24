
import tf from '@tensorflow/tfjs-node';

// Function to preprocess the data
function preprocessData(data, sequenceLength) {
  const { timeSeries, min, range } = data;
  
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
  const xsTensor = tf.tensor2d(xs, [xs.length, sequenceLength]);
  const ysTensor = tf.tensor1d(ys);
  
  return { xsTensor, ysTensor };
}

// Function to train the model
export async function trainModel(stockData, sequenceLength, epochs, batchSize, onProgress) {
  console.log("Training model with data:", 
    JSON.stringify({
      timeSeriesLength: stockData ? stockData.timeSeries.length : 0,
      sequenceLength,
      epochs,
      batchSize
    })
  );
  
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
  
  if (xsTensor.shape[0] < 10) {
    throw new Error("Not enough data for training");
  }
  
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
  
  // Create and compile the model
  console.log("Creating model...");
  const model = tf.sequential();
  
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
  
  // Reshape inputs for LSTM
  const xsTrainReshaped = xsTrain.reshape([xsTrain.shape[0], xsTrain.shape[1], 1]);
  const xsTestReshaped = xsTest.reshape([xsTest.shape[0], xsTest.shape[1], 1]);
  
  // Create a callback to report progress
  const batchesPerEpoch = Math.ceil(xsTrainReshaped.shape[0] / batchSize);
  
  const history = {
    loss: [],
    val_loss: []
  };
  
  console.log("Starting training with", epochs, "epochs...");
  
  // Train the model with batch processing
  for (let epoch = 0; epoch < epochs; epoch++) {
    let batchLoss = 0;
    
    // Process in batches
    for (let batchStart = 0; batchStart < xsTrainReshaped.shape[0]; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize, xsTrainReshaped.shape[0]);
      const batchSize = batchEnd - batchStart;
      
      if (batchSize <= 0) {
        console.warn("Skipping empty batch");
        continue;
      }
      
      const batchX = xsTrainReshaped.slice([batchStart, 0, 0], 
                                          [batchSize, sequenceLength, 1]);
      const batchY = ysTrain.slice([batchStart], [batchSize]);
      
      const result = await model.trainOnBatch(batchX, batchY);
      batchLoss += result;
      
      // Clean up tensors
      batchX.dispose();
      batchY.dispose();
    }
    
    // Calculate batch average loss
    const avgLoss = batchLoss / batchesPerEpoch;
    
    // Evaluate on validation set
    const valLoss = model.evaluate(xsTestReshaped, ysTest);
    const valLossValue = await valLoss.dataSync()[0];
    valLoss.dispose();
    
    // Store loss values
    history.loss.push(avgLoss);
    history.val_loss.push(valLossValue);
    
    // Report progress
    if (onProgress) {
      onProgress({
        epoch: epoch + 1,
        totalEpochs: epochs,
        loss: avgLoss,
        val_loss: valLossValue
      });
    }
  }
  
  console.log("Training complete, saving model...");
  
  // Save the trained model to a format we can return
  const modelArtifacts = await model.save(tf.io.withSaveHandler(async modelArtifacts => {
    return modelArtifacts;
  }));
  
  console.log("Model saved successfully");
  
  // Clean up tensors
  xsTensor.dispose();
  ysTensor.dispose();
  xsTrain.dispose();
  xsTest.dispose();
  ysTrain.dispose();
  ysTest.dispose();
  xsTrainReshaped.dispose();
  xsTestReshaped.dispose();
  
  // Return the model data and other necessary information
  return {
    modelData: modelArtifacts,
    min,
    range,
    history
  };
}

// Function to make predictions
export async function predictPrices(modelData, stockData, sequenceLength, min, range, daysToPredict) {
  if (!modelData || !stockData || stockData.timeSeries.length < sequenceLength) {
    throw new Error(`Not enough data points for prediction. Need at least ${sequenceLength}.`);
  }
  
  // Load the model
  console.log("Loading model from provided data...");
  const model = await tf.loadLayersModel(tf.io.fromMemory(modelData));
  console.log("Model loaded successfully");
  
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
    inputTensor.dispose();
    inputReshaped.dispose();
    predictionTensor.dispose();
  }
  
  // Clean up the model
  model.dispose();
  
  return predictions;
}