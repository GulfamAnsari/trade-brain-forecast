
import { StockData, PredictionResult } from "@/types/stock";

const SERVER_URL = "http://localhost:5000/api";
const WS_URL = "ws://localhost:5000";

let websocket: WebSocket | null = null;
let messageHandlers: Set<(data: any) => void> = new Set();

export const initializeWebSocket = () => {
  if (websocket?.readyState === WebSocket.OPEN) {
    return websocket;
  }
  
  websocket = new WebSocket(WS_URL);
  
  websocket.onopen = () => {
    console.log('WebSocket connected');
  };
  
  websocket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      messageHandlers.forEach(handler => handler(data));
    } catch (error) {
      console.error('WebSocket message parsing error:', error);
    }
  };
  
  websocket.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
  
  websocket.onclose = () => {
    console.log('WebSocket disconnected');
    websocket = null;
  };
  
  return websocket;
};

export const addWebSocketHandler = (handler: (data: any) => void) => {
  if (!websocket) {
    initializeWebSocket();
  }
  messageHandlers.add(handler);
  return () => messageHandlers.delete(handler);
};

export const initializeTensorFlow = async () => {
  try {
    const response = await fetch(`${SERVER_URL}/status`);
    if (!response.ok) {
      throw new Error('ML server is not responding');
    }
    console.log('ML server is running');
    initializeWebSocket();
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
  onProgress: (progress: any) => void,
  signal: AbortSignal
): Promise<{
  modelData: any;
  predictions: PredictionResult[];
}> => {
  try {
    // Add WebSocket handler for progress updates
    const removeHandler = addWebSocketHandler((message) => {
      if (message.type === 'progress' || message.type === 'status') {
        onProgress(message.data);
      }
    });
    
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
    
    // Clean up WebSocket handler
    removeHandler();

    return {
      modelData: data.modelData,
      predictions: data.predictions
    };
  } catch (error) {
    console.error("Analysis error:", error);
    throw error;
  }
};
