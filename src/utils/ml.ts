
import { StockData, PredictionResult } from "@/types/stock";

const SERVER_URL = "http://localhost:5000/api";
const WS_URL = "ws://localhost:5000";

let websocket: WebSocket | null = null;
let messageHandlers: Map<string, Set<(data: any) => void>> = new Map();

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
      const message = JSON.parse(event.data);
      const modelId = message.modelId || 'global';
      
      // Handle messages for specific models
      if (messageHandlers.has(modelId)) {
        messageHandlers.get(modelId)?.forEach(handler => handler(message));
      }
      
      // Always send to global handlers as well, but only if this isn't already a global message
      if (modelId !== 'global' && messageHandlers.has('global')) {
        messageHandlers.get('global')?.forEach(handler => handler(message));
      }
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

export const addWebSocketHandler = (handler: (data: any) => void, modelId?: string) => {
  if (!websocket) {
    initializeWebSocket();
  }
  
  const id = modelId || 'global';
  
  if (!messageHandlers.has(id)) {
    messageHandlers.set(id, new Set());
  }
  
  messageHandlers.get(id)?.add(handler);
  
  return () => {
    const handlers = messageHandlers.get(id);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        messageHandlers.delete(id);
      }
    }
  };
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
  signal: AbortSignal,
  modelId?: string
): Promise<{
  modelData: any;
  predictions: PredictionResult[];
}> => {
  try {
    // Add WebSocket handler specifically for this model ID
    const removeHandler = addWebSocketHandler((message) => {
      // Only process messages for this specific model or without a modelId
      if (message.modelId === modelId || 
         (!message.modelId && !modelId) || 
         (message.type === 'global')) {
        
        if (message.type === 'progress' || message.type === 'status') {
          onProgress(message.data);
        }
      }
    }, modelId); // Register handler with the specific model ID
    
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
        daysToPredict,
        modelId
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
