
import { StockData, PredictionResult } from "@/types/stock";

const SERVER_URL = "http://localhost:5000/api";
const WS_URL = "ws://localhost:5000";

let websocket: WebSocket | null = null;
let messageHandlers: Map<string, Set<(data: any) => void>> = new Map();
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectDelay = 2000; // 2 seconds
let activeModelTraining = new Set<string>(); // Track active model training

export const initializeWebSocket = () => {
  if (websocket?.readyState === WebSocket.OPEN) {
    return websocket;
  }
  
  websocket = new WebSocket(WS_URL);
  
  websocket.onopen = () => {
    console.log('WebSocket connected');
    reconnectAttempts = 0; // Reset reconnect attempts on successful connection
  };
  
  websocket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      const modelId = message.modelId || 'global';
      
      console.log(`WebSocket message received for modelId: ${modelId}`, message);
      
      // Keep track of completed models
      if (message.type === 'status' && message.data && message.data.stage === 'complete' && modelId !== 'global') {
        // Remove from active training when a model is complete
        activeModelTraining.delete(modelId);
        console.log(`Model ${modelId} completed, remaining active models: ${activeModelTraining.size}`);
      }
      
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
  
  websocket.onclose = (event) => {
    console.log('WebSocket disconnected', event.code, event.reason);
    websocket = null;
    
    // Attempt to reconnect if not a normal closure and not exceeded max attempts
    if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++;
      console.log(`Attempting to reconnect (${reconnectAttempts}/${maxReconnectAttempts})...`);
      setTimeout(() => {
        initializeWebSocket();
      }, reconnectDelay * reconnectAttempts); // Exponential backoff
    }
  };
  
  return websocket;
};

export const addWebSocketHandler = (handler: (data: any) => void, modelId?: string) => {
  if (!websocket || websocket.readyState !== WebSocket.OPEN) {
    initializeWebSocket();
  }
  
  const id = modelId || 'global';
  
  if (!messageHandlers.has(id)) {
    messageHandlers.set(id, new Set());
  }
  
  messageHandlers.get(id)?.add(handler);
  
  // Track this model as active for training if it has a model ID
  if (modelId && modelId !== 'global') {
    activeModelTraining.add(modelId);
  }
  
  return () => {
    const handlers = messageHandlers.get(id);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        messageHandlers.delete(id);
      }
    }
    
    // Remove from active training when handler is removed
    if (modelId && modelId !== 'global') {
      activeModelTraining.delete(modelId);
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

// Helper to generate descriptive model ID with all parameters
export const generateModelId = (
  stockData: StockData,
  sequenceLength: number,
  epochs: number,
  batchSize: number,
  daysToPredict: number
): string => {
  return `${stockData.symbol}_seq${sequenceLength}_pred${daysToPredict}_ep${epochs}_bs${batchSize}_dp${stockData.timeSeries.length}`;
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
    // Generate a descriptive model ID if none is provided
    const descriptiveModelId = modelId || 
      generateModelId(stockData, sequenceLength, epochs, batchSize, daysToPredict);
    
    // Add WebSocket handler specifically for this model ID
    const removeHandler = addWebSocketHandler((message) => {
      // Only process messages for this specific model or without a modelId
      if (message.modelId === descriptiveModelId || 
         (!message.modelId && !descriptiveModelId) || 
         (message.type === 'global')) {
        
        if (message.type === 'progress' || message.type === 'status') {
          onProgress(message.data);
        }
      }
    }, descriptiveModelId); // Register handler with the specific model ID
    
    // Make a deep copy of the stock data to avoid reference issues
    const stockDataCopy = {
      ...stockData,
      timeSeries: [...stockData.timeSeries]
    };

    // Validate data
    if (!stockData || !stockData.timeSeries || stockData.timeSeries.length < sequenceLength + 5) {
      throw new Error(`Not enough data points for analysis. Need at least ${sequenceLength + 5}.`);
    }

    try {
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
          modelId: descriptiveModelId,
          // Add a flag to indicate this is part of multi-model training
          isMultiModel: activeModelTraining.size > 1
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
      // If the request was aborted, we should throw an abort error
      if (signal.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      throw error;
    }
  } catch (error) {
    console.error("Analysis error:", error);
    throw error;
  }
};
