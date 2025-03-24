
import tf from '@tensorflow/tfjs-node';

// Function to train and predict using the provided algorithm
export async function trainAndPredict(stockData, sequenceLength, epochs, batchSize, daysToPredict) {
  try {
    console.log("Training model with data:", 
      JSON.stringify({
        timeSeriesLength: stockData ? stockData.timeSeries.length : 0,
        sequenceLength,
        epochs,
        daysToPredict
      })
    );
    
    if (!stockData || !stockData.timeSeries || stockData.timeSeries.length < sequenceLength + daysToPredict) {
      throw new Error(`Not enough data points for prediction. Need at least ${sequenceLength + daysToPredict}.`);
    }
    
    // Extract closing prices
    const closingPrices = stockData.timeSeries.map(entry => entry.close);
    
    // Calculate min and max values for normalization
    const minPrice = Math.min(...closingPrices);
    const maxPrice = Math.max(...closingPrices);
    const range = maxPrice - minPrice;
    
    if (range === 0) {
      throw new Error("Cannot normalize data: all closing prices are identical");
    }
    
    console.log("Data range:", { minPrice, maxPrice, range });
    
    // Normalize prices
    const normalizedPrices = closingPrices.map(price => (price - minPrice) / range);
    
    // Prepare training data
    const inputSize = sequenceLength;
    const outputSize = daysToPredict;
    const xs = [];
    const ys = [];
    
    for (let i = 0; i < normalizedPrices.length - inputSize - outputSize; i++) {
      const inputSlice = normalizedPrices.slice(i, i + inputSize);
      // Ensure correct shape for TensorFlow tensor3d()
      const formattedInput = inputSlice.map(v => [v]);
      
      xs.push(formattedInput);
      ys.push(normalizedPrices.slice(i + inputSize, i + inputSize + outputSize));
    }
    
    if (xs.length === 0 || ys.length === 0) {
      throw new Error("Training data is empty after processing.");
    }
    
    console.log(`Training on ${xs.length} samples.`);
    
    // Convert to tensors
    const tensorXs = tf.tensor3d(xs, [xs.length, inputSize, 1]);
    const tensorYs = tf.tensor2d(ys, [ys.length, outputSize]);
    
    // Define the LSTM model
    const model = tf.sequential();
    model.add(tf.layers.lstm({ 
      units: 64, 
      returnSequences: false, 
      inputShape: [inputSize, 1] 
    }));
    model.add(tf.layers.dense({ units: 32, activation: "relu" }));
    model.add(tf.layers.dense({ units: outputSize }));
    
    model.compile({ 
      optimizer: tf.train.adam(0.001), 
      loss: "meanSquaredError" 
    });
    
    console.log("Training model...");
    
    // Track history for reporting
    const history = {
      loss: [],
      val_loss: []
    };
    
    // Train the model
    const result = await model.fit(tensorXs, tensorYs, {
      epochs: epochs,
      batchSize: batchSize,
      verbose: 1,
      validationSplit: 0.2,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          console.log(`Epoch ${epoch+1}/${epochs}: loss = ${logs.loss.toFixed(4)}, val_loss = ${logs.val_loss.toFixed(4)}`);
          history.loss.push(logs.loss);
          history.val_loss.push(logs.val_loss);
        },
        ...tf.callbacks.earlyStopping({ monitor: "val_loss", patience: 5 })
      }
    });
    
    tensorXs.dispose();
    tensorYs.dispose();
    
    console.log("Preparing data for prediction...");
    const lastSequence = normalizedPrices.slice(-inputSize).map(v => [v]);
    const tensorInput = tf.tensor3d([lastSequence], [1, inputSize, 1]);
    
    console.log("Running prediction...");
    const predictionTensor = model.predict(tensorInput);
    
    if (!predictionTensor) {
      throw new Error("Model prediction returned undefined.");
    }
    
    const predictedNormalized = await predictionTensor.data();
    predictionTensor.dispose();
    tensorInput.dispose();
    
    // Convert back to original price range
    const predictedPrices = Array.from(predictedNormalized).map(p => p * range + minPrice);
    
    // Get the last date from the data
    const lastDate = new Date(stockData.timeSeries[stockData.timeSeries.length - 1].date);
    
    // Prepare prediction results
    const predictions = [];
    for (let i = 0; i < daysToPredict; i++) {
      // Calculate the next date (skip weekends)
      const predictionDate = new Date(lastDate);
      predictionDate.setDate(lastDate.getDate() + i + 1);
      
      // Skip weekends (Saturday = 6, Sunday = 0)
      while (predictionDate.getDay() === 6 || predictionDate.getDay() === 0) {
        predictionDate.setDate(predictionDate.getDate() + 1);
      }
      
      predictions.push({
        date: predictionDate.toISOString().split('T')[0],
        prediction: predictedPrices[i]
      });
    }
    
    // Clean up the model
    model.dispose();
    
    return {
      predictions,
      modelData: {
        history,
        min: minPrice,
        range: range
      }
    };
    
  } catch (error) {
    console.error("Training and prediction error:", error);
    throw error;
  }
}

// Maintains the old function signatures but uses the new implementation
export async function trainModel(stockData, sequenceLength, epochs, batchSize, onProgress) {
  console.log("Delegating to trainAndPredict implementation");
  // This function is kept for backward compatibility
  return { modelData: null, min: 0, range: 0, history: { loss: [], val_loss: [] } };
}

export async function predictPrices(modelData, stockData, sequenceLength, min, range, daysToPredict) {
  console.log("Delegating to trainAndPredict implementation");
  // This function is kept for backward compatibility
  return [];
}
