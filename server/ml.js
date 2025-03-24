
import tf from '@tensorflow/tfjs-node';
import fs from 'fs';
import path from 'path';

// Create models directory if it doesn't exist
const modelsDir = path.join(process.cwd(), 'models');
if (!fs.existsSync(modelsDir)) {
  fs.mkdirSync(modelsDir, { recursive: true });
}

// Function to train and predict using the provided algorithm
export async function trainAndPredict(stockData, sequenceLength, epochs, batchSize, daysToPredict, onProgress) {
  stockData?.timeSeries.sort((a, b) => {
    return a.date - b.date;
  });

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
    
    const modelKey = `${stockData.symbol}_${sequenceLength}_${daysToPredict}`;
    const modelPath = path.join(modelsDir, `${modelKey}`);
    let model;
    let shouldTrain = true;

    // Check if we have a saved model
    if (fs.existsSync(modelPath)) {
      try {
        onProgress({ stage: 'loading', message: 'Loading saved model' });
        model = await tf.loadLayersModel(`file://${modelPath}/model.json`);
        shouldTrain = false;
        console.log("Loaded existing model from disk");
        onProgress({ stage: 'loading', message: 'Using saved model' });
      } catch (loadError) {
        console.error("Error loading saved model:", loadError);
        shouldTrain = true;
      }
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
    onProgress({ stage: 'preprocessing', message: 'Normalizing data' });
    
    // Normalize prices
    // const normalizedPrices = closingPrices.map(price => (price - minPrice) / range);
    
    // 🔹 Normalize data between -1 and 1 (better for LSTMs)
    const normalizedPrices = closingPrices.map(
      (p) => (2 * (p - minPrice) / (maxPrice - minPrice)) - 1
    );
    // Prepare training data
    const inputSize = sequenceLength;
    const outputSize = daysToPredict;
    
    if (shouldTrain) {
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
      onProgress({ stage: 'preparing', message: `Prepared ${xs.length} training samples` });
      
      // Convert to tensors
      const tensorXs = tf.tensor3d(xs, [xs.length, inputSize, 1]);
      const tensorYs = tf.tensor2d(ys, [ys.length, outputSize]);
      
      // Define the LSTM model
      // model = tf.sequential();
      // model.add(tf.layers.lstm({ 
      //   units: 64, 
      //   returnSequences: false, 
      //   inputShape: [inputSize, 1] 
      // }));


      // Define the LSTM model
      model = tf.sequential();
      // 🔹 First LSTM Layer (Extract patterns from stock prices)
      model.add(tf.layers.lstm({ 
        units: 128,   // Increased neurons for better learning
        returnSequences: true,  // Enable return sequences for deeper learning
        inputShape: [inputSize, 1]
      }));
      // 🔹 Second LSTM Layer (Refining patterns)
      model.add(tf.layers.lstm({ 
        units: 64, 
        returnSequences: false 
      }));
      // 🔹 Dropout Layer (Prevents Overfitting)
      model.add(tf.layers.dropout({ rate: 0.2 })); 
      // 🔹 Dense Layer (Feature extraction)
      model.add(tf.layers.dense({ units: 64, activation: "relu" }));
      // 🔹 Batch Normalization (Improves stability)
      model.add(tf.layers.batchNormalization());
      // 🔹 Output Layer (Predicting next 7 days)
      model.add(tf.layers.dense({ units: outputSize }));
      // 🔹 Compile Model with Adam Optimizer and Lower Learning Rate
      model.compile({ 
        optimizer: tf.train.adam(0.0005),  // Lower learning rate for smoother learning
        loss: "meanSquaredError"
      });

      // model.add(tf.layers.dense({ units: 32, activation: "relu" }));
      // model.add(tf.layers.dense({ units: outputSize }));
      
      // model.compile({ 
      //   optimizer: tf.train.adam(0.001), 
      //   loss: "meanSquaredError" 
      // });
      
      console.log("Training model...");
      onProgress({ stage: 'training', message: 'Starting model training' });
      
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
        validationSplit: 0.1,//before  validationSplit: 0.1
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            console.log(`Epoch ${epoch+1}/${epochs}: loss = ${logs.loss.toFixed(4)}, val_loss = ${logs.val_loss.toFixed(4)}`);
            history.loss.push(logs.loss);
            history.val_loss.push(logs.val_loss);
            onProgress({ 
              stage: 'training', 
              epoch: epoch + 1, 
              totalEpochs: epochs, 
              loss: logs.loss, 
              val_loss: logs.val_loss
            });
          },
          ...tf.callbacks.earlyStopping({ monitor: "val_loss", patience: 5 })
        }
      });
      
      // Save the model
      onProgress({ stage: 'saving', message: 'Saving model to disk' });
      try {
        await model.save(`file://${modelPath}`);
        console.log(`Model saved to ${modelPath}`);
      } catch (saveError) {
        console.error("Error saving model:", saveError);
      }
      
      tensorXs.dispose();
      tensorYs.dispose();
    }
    
    console.log("Preparing data for prediction...");
    onProgress({ stage: 'predicting', message: 'Generating predictions' });
    
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
    
    // Clean up the model if it's not going to be saved
    if (!shouldTrain) {
      model.dispose();
    }
    
    return {
      predictions,
      modelData: {
        isExistingModel: !shouldTrain,
        history: shouldTrain ? {
          loss: model.history?.history?.loss || [],
          val_loss: model.history?.history?.val_loss || []
        } : null,
        min: minPrice,
        range: range,
        params: {
          inputSize,
          outputSize,
          epochs,
          batchSize
        }
      }
    };
    
  } catch (error) {
    console.error("Training and prediction error:", error);
    throw error;
  }
}
