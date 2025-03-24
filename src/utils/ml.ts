
import { StockData, PredictionResult } from "@/types/stock";
import { toast } from "sonner";

const SERVER_URL = "http://localhost:5000/api";

export const initializeTensorFlow = async () => {
  try {
    const response = await fetch(`${SERVER_URL}/status`);
    if (!response.ok) {
      throw new Error('ML server is not responding');
    }
    console.log('ML server is running');
    return true;
  } catch (error) {
    console.error('Error connecting to ML server:', error);
    throw new Error('Unable to connect to ML server. Please ensure it is running.');
  }
};

export const analyzeStock = async (
  stockData: StockData,
  sequenceLength: number,
  epochs: number,
  batchSize: number,
  daysToPredict: number,
  onProgress: (progress: { epoch: number; totalEpochs: number; loss: number }) => void,
  signal: AbortSignal
): Promise<{
  modelData: any;
  predictions: PredictionResult[];
}> => {
  try {
    // Make a deep copy of the stock data to avoid reference issues
    const stockDataCopy = {
      ...stockData,
      timeSeries: [...stockData.timeSeries]
    };

    // Validate data
    if (!stockData || !stockData.timeSeries || stockData.timeSeries.length < sequenceLength + 5) {
      throw new Error(`Not enough data points for analysis. Need at least ${sequenceLength + 5}.`);
    }

    const response = await fetch(`${SERVER_URL}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        stockData: stockDataCopy,
        sequenceLength,
        epochs,
        batchSize,
        daysToPredict
      }),
      signal
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Server analysis failed');
    }

    const data = await response.json();

    // Simulate progress since we don't have real-time updates
    for (let i = 1; i <= epochs; i++) {
      if (signal.aborted) break;
      onProgress({
        epoch: i,
        totalEpochs: epochs,
        loss: data.modelData.history.loss[Math.min(i-1, data.modelData.history.loss.length-1)]
      });
    }

    return {
      modelData: data.modelData,
      predictions: data.predictions
    };
  } catch (error) {
    console.error("Analysis error:", error);
    throw error;
  }
};
