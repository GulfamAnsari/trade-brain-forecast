import * as tf from '@tensorflow/tfjs-node';
import fs from 'fs';
import path from 'path';

// Create models directory if it doesn't exist
const modelsDir = path.join(process.cwd(), 'models');
if (!fs.existsSync(modelsDir)) {
  fs.mkdirSync(modelsDir, { recursive: true });
}


export async function trainAndPredict(stockData, sequenceLength, epochs, batchSize, daysToPredict, onProgress) {
  if (!stockData || !stockData.timeSeries || stockData.timeSeries.length === 0) {
    throw new Error("Stock data is empty or invalid.");
  }

  // Sort and slice the latest 360 records
  stockData.timeSeries.sort((a, b) => new Date(a.date) - new Date(b.date));
  if (stockData.timeSeries.length > 360) {
    stockData.timeSeries = stockData.timeSeries.slice(-360);
  }

  try {
    onProgress({ stage: "starting", message: "Initializing model training...", percent: 5 });

    if (stockData.timeSeries.length < sequenceLength + daysToPredict) {
      throw new Error(`Not enough data points for prediction. Need at least ${sequenceLength + daysToPredict}, but got ${stockData.timeSeries.length}.`);
    }

    const modelKey = `${stockData.symbol}_${sequenceLength}_${daysToPredict}`;
    const modelPath = path.join("models", `${modelKey}`);
    let model;
    let shouldTrain = true;

    // Load saved model if available
    if (fs.existsSync(path.join(modelPath, "model.json"))) {
      try {
        onProgress({ stage: "loading", message: "Loading saved model...", percent: 10 });
        model = await tf.loadLayersModel(`file://${modelPath}/model.json`);
        shouldTrain = false;
        onProgress({ stage: "loading", message: "Using saved model", percent: 15 });
      } catch (loadError) {
        console.error("Error loading saved model:", loadError);
        shouldTrain = true;
      }
    }

    // Extract closing prices
    const closingPrices = stockData.timeSeries.map(entry => entry.close);

    // Normalize data
    const minPrice = Math.min(...closingPrices);
    const maxPrice = Math.max(...closingPrices);
    const range = maxPrice - minPrice;

    if (range === 0) {
      throw new Error("Cannot normalize data: all closing prices are identical.");
    }

    onProgress({ stage: "preprocessing", message: "Normalizing data...", percent: 20 });

    const normalizedPrices = closingPrices.map(p => (2 * (p - minPrice) / range) - 1);

    // Prepare training data
    const inputSize = sequenceLength;
    const outputSize = daysToPredict;
    const xs = [];
    const ys = [];

    for (let i = 0; i <= normalizedPrices.length - inputSize - outputSize; i++) {
      xs.push(normalizedPrices.slice(i, i + inputSize).map(v => [v]));
      ys.push(normalizedPrices.slice(i + inputSize, i + inputSize + outputSize));
    }

    if (xs.length === 0 || ys.length === 0) {
      throw new Error("Not enough samples for training.");
    }

    onProgress({ stage: "preparing", message: `Prepared ${xs.length} training samples`, percent: 30 });

    if (shouldTrain) {
      // Convert to tensors
      const tensorXs = tf.tensor3d(xs, [xs.length, inputSize, 1]);
      const tensorYs = tf.tensor2d(ys, [ys.length, outputSize]);

      // Define the LSTM model
      model = tf.sequential();
      model.add(tf.layers.lstm({
        units: 128,
        returnSequences: true,
        inputShape: [inputSize, 1]
      }));
      model.add(tf.layers.lstm({ units: 64, returnSequences: false }));
      model.add(tf.layers.dropout({ rate: 0.2 }));
      model.add(tf.layers.dense({ units: 64, activation: "relu" }));
      model.add(tf.layers.batchNormalization());
      model.add(tf.layers.dense({ units: outputSize }));

      model.compile({
        optimizer: tf.train.adam(0.0005),
        loss: "meanSquaredError"
      });

      onProgress({ stage: "training", message: "Starting model training...", percent: 40 });

      await model.fit(tensorXs, tensorYs, {
        epochs: epochs,
        batchSize: batchSize,
        verbose: 1,
        validationSplit: 0.1,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            const progress = 40 + Math.round((epoch / epochs) * 40);
            onProgress({ stage: "training", message: `Epoch ${epoch + 1}/${epochs} - Loss: ${logs.loss}`, percent: progress, epoch, epochs, loss: logs.loss });
          }
        }
      });

      // Save the model
      onProgress({ stage: "saving", message: "Saving trained model...", percent: 85 });

      try {
        await model.save(`file://${modelPath}`);
      } catch (saveError) {
        console.error("Error saving model:", saveError);
      }

      tensorXs.dispose();
      tensorYs.dispose();
    }

    onProgress({ stage: "predicting", message: "Generating predictions...", percent: 90 });

    // Predict next `daysToPredict`
    const lastSequence = normalizedPrices.slice(-inputSize).map(v => [v]);
    const tensorInput = tf.tensor3d([lastSequence], [1, inputSize, 1]);

    const predictionTensor = model.predict(tensorInput);
    if (!predictionTensor) {
      throw new Error("Model prediction returned undefined.");
    }

    const predictedNormalized = await predictionTensor.data();
    predictionTensor.dispose();
    tensorInput.dispose();

    // Convert back to original price range
    const predictedPrices = Array.from(predictedNormalized).map(p => ((p + 1) * range / 2) + minPrice);

    // Get the last date from the data
    const lastDate = new Date(stockData.timeSeries[stockData.timeSeries.length - 1].date);

    // Prepare prediction results
    const predictions = [];
    for (let i = 0; i < daysToPredict; i++) {
      const predictionDate = new Date(lastDate);
      predictionDate.setDate(lastDate.getDate() + i + 1);

      // Skip weekends (Saturday = 6, Sunday = 0)
      while (predictionDate.getDay() === 6 || predictionDate.getDay() === 0) {
        predictionDate.setDate(predictionDate.getDate() + 1);
      }

      predictions.push({
        date: predictionDate.toISOString().split("T")[0],
        prediction: predictedPrices[i] || null
      });
    }

    if (!shouldTrain) {
      model.dispose();
    }

    onProgress({ stage: "completed", message: "Prediction complete!", percent: 100 });

    return {
      predictions,
      modelData: {
        isExistingModel: !shouldTrain,
        min: minPrice,
        range: range,
        params: { inputSize, outputSize, epochs, batchSize }
      }
    };

  } catch (error) {
    console.error("Training and prediction error:", error);
    onProgress({ stage: "error", message: error.message, percent: 0 });
    throw error;
  }
}
