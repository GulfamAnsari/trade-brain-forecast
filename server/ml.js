import * as tf from '@tensorflow/tfjs-node';
import fs from 'fs';
import path from 'path';

// Create models directory if it doesn't exist
const modelsDir = path.join(process.cwd(), '..', 'models');
if (!fs.existsSync(modelsDir)) {
  fs.mkdirSync(modelsDir, { recursive: true });
}

// Helper function to check if a date is a business day (not a weekend)
function isBusinessDay(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6; // 0 is Sunday, 6 is Saturday
}

// Helper function to get next business day
function getNextBusinessDay(date) {
  const nextDay = new Date(date);
  nextDay.setDate(date.getDate() + 1);
  
  // Keep adding days until we get a business day
  while (!isBusinessDay(nextDay)) {
    nextDay.setDate(nextDay.getDate() + 1);
  }
  
  return nextDay;
}

export async function trainAndPredict(stockData, sequenceLength, epochs, batchSize, daysToPredict, onProgress, modelId, isPredictionOnly = false, predictPastDays = 0) {
  if (!stockData || !stockData.timeSeries || stockData.timeSeries.length === 0) {
    throw new Error("Stock data is empty or invalid.");
  }

  try {
    onProgress({ stage: "starting", message: "Initializing model training...", percent: 5 });

    // Sort data by date (ascending)
    stockData.timeSeries.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Use only the specified sequence length of data if provided
    const trimmedData = sequenceLength > 0 && stockData.timeSeries.length > sequenceLength 
      ? stockData.timeSeries.slice(-sequenceLength) 
      : stockData.timeSeries;
    
    if (trimmedData.length < 5) {
      throw new Error(`Not enough data points for prediction. Need at least 5, but got ${trimmedData.length}.`);
    }

    onProgress({ 
      stage: "data", 
      message: `Using ${trimmedData.length} data points for analysis`, 
      percent: 10,
      dataPoints: trimmedData.length
    });

    // Generate a more descriptive model ID that includes training parameters but NOT data points count
    // If a specific model ID is not provided by the caller
    const generatedModelId = modelId || 
      `${stockData.symbol}_seq${sequenceLength}_pred${daysToPredict}_ep${epochs}_bs${batchSize}`;
    
    // Use the generated model ID
    const modelPath = path.join(modelsDir, generatedModelId);
    let model;
    let shouldTrain = true;
    let savedMinPrice, savedRange, savedModelParams;

    // Load saved model if available
    if (fs.existsSync(path.join(modelPath, "model.json"))) {
      try {
        onProgress({ stage: "loading", message: "Loading saved model...", percent: 15 });
        model = await tf.loadLayersModel(`file://${modelPath}/model.json`);
        
        // Load normalization parameters
        if (fs.existsSync(path.join(modelPath, "params.json"))) {
          const params = JSON.parse(fs.readFileSync(path.join(modelPath, "params.json"), 'utf8'));
          savedMinPrice = params.minPrice;
          savedRange = params.range;
          savedModelParams = params;
          
          onProgress({ 
            stage: "loading", 
            message: "Using saved model and parameters", 
            percent: 20,
            modelInfo: {
              inputSize: params.inputSize,
              outputSize: params.outputSize,
              saved: true,
              epochs: params.epochs,
              totalEpochs: params.totalEpochs || params.epochs,
              batchSize: params.batchSize,
              dataPoints: params.dataPoints || trimmedData.length,
              created: params.created || params.trainingTime
            }
          });
        }
        
        shouldTrain = false;
      } catch (loadError) {
        console.error("Error loading saved model:", loadError);
        
        // If this is prediction only mode, rethrow the error
        if (isPredictionOnly) {
          throw loadError;
        }
        
        shouldTrain = true;
      }
    } else if (isPredictionOnly) {
      // If we're in prediction only mode and the model doesn't exist, throw an error
      throw new Error(`Model ${generatedModelId} not found.`);
    }

    // Extract closing prices
    const closingPrices = trimmedData.map(entry => entry.close);

    // Normalize data
    let minPrice, range;
    
    if (!shouldTrain && savedMinPrice !== undefined && savedRange !== undefined) {
      // Use saved normalization parameters
      minPrice = savedMinPrice;
      range = savedRange;
    } else {
      // Calculate new normalization parameters
      minPrice = Math.min(...closingPrices);
      range = Math.max(...closingPrices) - minPrice;
    }

    if (range === 0) {
      throw new Error("Cannot normalize data: all closing prices are identical.");
    }

    onProgress({ 
      stage: "preprocessing", 
      message: "Normalizing data...", 
      percent: 25,
      dataPoints: trimmedData.length,
      minPrice,
      range
    });

    // Normalize to [-1, 1] range for better training
    const normalizedPrices = closingPrices.map(p => (2 * (p - minPrice) / range) - 1);

    let windowSize;
    
    if (shouldTrain) {
      // Prepare training data - use all available data points for training
      const xs = [];
      const ys = [];
      
      // Create sequences for training
      windowSize = Math.min(60, Math.floor(trimmedData.length / 3)); // Use appropriate window size
      
      for (let i = 0; i <= normalizedPrices.length - windowSize - daysToPredict; i++) {
        xs.push(normalizedPrices.slice(i, i + windowSize).map(v => [v]));
        ys.push(normalizedPrices.slice(i + windowSize, i + windowSize + daysToPredict));
      }

      if (xs.length === 0 || ys.length === 0) {
        throw new Error("Not enough samples for training.");
      }

      onProgress({ 
        stage: "preparing", 
        message: `Prepared ${xs.length} training samples`, 
        percent: 30,
        samples: xs.length,
        windowSize
      });

      // Convert to tensors
      const tensorXs = tf.tensor3d(xs, [xs.length, windowSize, 1]);
      const tensorYs = tf.tensor2d(ys, [ys.length, daysToPredict]);

      // Define the LSTM model
      model = tf.sequential();
      model.add(tf.layers.lstm({
        units: 64,
        returnSequences: true,
        inputShape: [windowSize, 1]
      }));
      model.add(tf.layers.dropout({ rate: 0.2 }));
      model.add(tf.layers.lstm({ units: 64, returnSequences: false }));
      model.add(tf.layers.dropout({ rate: 0.2 }));
      model.add(tf.layers.dense({ units: 32, activation: "relu" }));
      model.add(tf.layers.dense({ units: daysToPredict }));

      model.compile({
        optimizer: tf.train.adam(0.001),
        loss: "meanSquaredError"
      });

      onProgress({ 
        stage: "training", 
        message: "Starting model training...", 
        percent: 40,
        modelInfo: {
          layers: [64, 64, 32, daysToPredict],
          inputSize: windowSize,
          outputSize: daysToPredict,
          epochs: epochs,
          totalEpochs: epochs,
          batchSize: batchSize,
          dataPoints: trimmedData.length,
          minPrice,
          range
        }
      });

      // Train the model
      const history = await model.fit(tensorXs, tensorYs, {
        epochs: epochs,
        batchSize: batchSize,
        verbose: 1,
        validationSplit: 0.2,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            const progress = 40 + Math.round((epoch / epochs) * 40);
            onProgress({ 
              stage: "training", 
              message: `Epoch ${epoch + 1}/${epochs}`, 
              percent: progress, 
              epoch: epoch + 1, 
              totalEpochs: epochs, 
              loss: logs.loss,
              val_loss: logs.val_loss
            });
          }
        }
      });

      // Save model and parameters
      onProgress({ stage: "saving", message: "Saving trained model...", percent: 85 });

      try {
        await model.save(`file://${modelPath}`);
        
        // Save normalization parameters
        const params = {
          minPrice,
          range,
          inputSize: windowSize,
          outputSize: daysToPredict,
          batchSize,
          epochs,
          totalEpochs: epochs,
          dataPoints: trimmedData.length,
          created: new Date().toISOString(),
          finalLoss: history.history.loss[history.history.loss.length - 1],
          finalValLoss: history.history.val_loss[history.history.val_loss.length - 1]
        };
        
        fs.writeFileSync(
          path.join(modelPath, "params.json"), 
          JSON.stringify(params), 
          'utf8'
        );
        
        onProgress({ 
          stage: "saved", 
          message: "Model saved successfully", 
          percent: 90,
          modelId: generatedModelId,
          history: {
            loss: history.history.loss,
            val_loss: history.history.val_loss
          },
          modelInfo: {
            inputSize: windowSize,
            outputSize: daysToPredict,
            epochs: epochs,
            totalEpochs: epochs,
            batchSize: batchSize,
            created: new Date().toISOString(),
            dataPoints: trimmedData.length,
            minPrice,
            range,
            finalLoss: history.history.loss[history.history.loss.length - 1],
            finalValLoss: history.history.val_loss[history.history.val_loss.length - 1]
          }
        });
      } catch (saveError) {
        console.error("Error saving model:", saveError);
        onProgress({ 
          stage: "error", 
          message: `Failed to save model: ${saveError.message}`, 
          percent: 90 
        });
      }

      tensorXs.dispose();
      tensorYs.dispose();
    } else {
      // For loaded models, get the input size from the model
      windowSize = model.inputs[0].shape[1];
      
      // Send progress with loaded model info
      onProgress({
        stage: "loaded",
        message: "Model loaded successfully",
        percent: 75,
        modelInfo: {
          inputSize: windowSize,
          outputSize: daysToPredict,
          epochs: savedModelParams?.epochs || 0,
          totalEpochs: savedModelParams?.totalEpochs || savedModelParams?.epochs || 0,
          batchSize: savedModelParams?.batchSize || 0,
          created: savedModelParams?.created || savedModelParams?.trainingTime,
          dataPoints: savedModelParams?.dataPoints || trimmedData.length,
          minPrice,
          range,
          finalLoss: savedModelParams?.finalLoss,
          finalValLoss: savedModelParams?.finalValLoss
        }
      });
    }

    onProgress({ 
      stage: "predicting", 
      message: "Generating predictions...", 
      percent: 95,
      windowSize,
      dataPoints: trimmedData.length
    });

    // Prepare for prediction - use the last available window
    const inputWindowSize = model.inputs[0].shape[1];
    
    // Choose the input window based on whether we're predicting past days or future days
    let inputWindow;
    let startIndex;
    
    if (predictPastDays > 0) {
      // For past prediction, use a window from the earlier part of the data
      const pastPredictionStartIndex = trimmedData.length - inputWindowSize - predictPastDays;
      if (pastPredictionStartIndex < 0) {
        throw new Error("Not enough historical data to predict the requested past days");
      }
      inputWindow = normalizedPrices.slice(pastPredictionStartIndex, pastPredictionStartIndex + inputWindowSize).map(v => [v]);
      startIndex = pastPredictionStartIndex + inputWindowSize;
    } else {
      // For future prediction, use the most recent window
      inputWindow = normalizedPrices.slice(-inputWindowSize).map(v => [v]);
      startIndex = trimmedData.length;
    }
    
    const tensorInput = tf.tensor3d([inputWindow], [1, inputWindowSize, 1]);
    const predictionTensor = model.predict(tensorInput);
    
    if (!predictionTensor) {
      throw new Error("Model prediction returned undefined.");
    }

    const predictedNormalized = await predictionTensor.data();
    predictionTensor.dispose();
    tensorInput.dispose();

    // Convert back to original price range
    const predictedPrices = Array.from(predictedNormalized).map(p => ((p + 1) * range / 2) + minPrice);

    // Get the reference date (last date from data or a past date)
    const referenceDate = predictPastDays > 0
      ? new Date(trimmedData[startIndex - 1].date)
      : new Date(trimmedData[trimmedData.length - 1].date);

    // Prepare prediction results with proper business day logic
    const predictions = [];
    let currentDate = new Date(referenceDate);
    
    for (let i = 0; i < daysToPredict; i++) {
      // Move to the next business day, skipping weekends
      currentDate = getNextBusinessDay(currentDate);
      
      predictions.push({
        date: currentDate.toISOString().split("T")[0],
        prediction: predictedPrices[i] || null,
        // If we're predicting the past, include the actual price for comparison
        actual: predictPastDays > 0 && startIndex + i < trimmedData.length ? trimmedData[startIndex + i].close : undefined
      });
    }

    // Clean up memory
    if (!shouldTrain) {
      model.dispose();
    }

    onProgress({ 
      stage: "completed", 
      message: "Prediction complete!", 
      percent: 100,
      dataPoints: trimmedData.length,
      modelId: generatedModelId
    });

    return {
      predictions,
      modelData: {
        modelId: generatedModelId,
        isExistingModel: !shouldTrain,
        min: minPrice,
        range: range,
        dataPoints: trimmedData.length,
        params: { 
          inputSize: windowSize || model.inputs[0].shape[1], 
          outputSize: daysToPredict, 
          epochs, 
          totalEpochs: epochs,
          batchSize,
          dataPoints: trimmedData.length,
          finalLoss: savedModelParams?.finalLoss
        }
      }
    };

  } catch (error) {
    console.error("Training and prediction error:", error);
    onProgress({ 
      stage: "error", 
      message: error.message, 
      percent: 0,
      error: error.toString()
    });
    throw error;
  }
}
