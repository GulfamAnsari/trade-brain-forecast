import { workerData, parentPort } from 'worker_threads';
import { trainAndPredict } from './ml.js';

// Get data from the main thread
const { 
  stockData, 
  sequenceLength, 
  epochs, 
  batchSize, 
  daysToPredict, 
  descriptiveModelId,
  isPredictionOnly,
  jobIndex,
  totalJobs
} = workerData;

// Progress callback for sending progress updates back to the main thread
const onProgress = (progress) => {
  // Add job context if this is part of a combo training
  if (jobIndex !== undefined && totalJobs !== undefined) {
    progress = {
      ...progress,
      jobIndex,
      totalJobs
    };
  }
  
  // Send progress updates to parent
  parentPort.postMessage({
    type: 'progress',
    data: progress
  });
};

// Execute the model training or prediction
try {
  const result = await trainAndPredict(
    stockData,
    sequenceLength,
    epochs,
    batchSize,
    daysToPredict,
    onProgress,
    descriptiveModelId,
    isPredictionOnly
  );
  
  // Send result back to parent thread
  parentPort.postMessage({
    type: 'complete',
    modelData: result.modelData,
    predictions: result.predictions,
    originalRequest: true
  });
} catch (error) {
  console.error('Worker error:', error);
  
  // Send error back to parent thread
  parentPort.postMessage({
    type: 'error',
    error: error.message || 'Unknown error in worker',
    originalRequest: true
  });
}
