import { StockData, PredictionResult } from "@/types/stock";

const SERVER_URL = "http://localhost:5000/api";
const WS_URL = "ws://localhost:5000";

let websocket: WebSocket | null = null;
let messageHandlers: Map<string, Set<(data: any) => void>> = new Map();
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectDelay = 2000; // 2 seconds
let activeModelTraining = new Set<string>(); // Track active model training
let initialActiveModelsReceived = false;

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
      
      // Handle active models list on first connection
      if (message.type === 'activeModels' && !initialActiveModelsReceived) {
        initialActiveModelsReceived = true;
        message.data.forEach((model: any) => {
          activeModelTraining.add(model.modelId);
        });
        console.log('Received active models on connection:', activeModelTraining);
      }
      
      // Handle combo training started event
      if (message.type === 'comboTrainingStarted') {
        message.data.jobs.forEach((job: any) => {
          activeModelTraining.add(job.modelId);
        });
        
        // Let all global handlers know about this event
        if (messageHandlers.has('global')) {
          messageHandlers.get('global')?.forEach(handler => handler(message));
        }
      }
      
      // Keep track of completed models
      if (message.type === 'status' && message.data) {
        if (message.data.stage === 'complete' && modelId !== 'global') {
          // Remove from active training when a model is complete
          activeModelTraining.delete(modelId);
          console.log(`Model ${modelId} completed, remaining active models: ${activeModelTraining.size}`);
        } else if (message.data.stage === 'error' && modelId !== 'global') {
          // Remove from active training when a model errors out
          activeModelTraining.delete(modelId);
          console.log(`Model ${modelId} errored, remaining active models: ${activeModelTraining.size}`);
        } else if (message.data.stage === 'cancelled' && modelId !== 'global') {
          // Remove from active training when a model is cancelled
          activeModelTraining.delete(modelId);
          console.log(`Model ${modelId} cancelled, remaining active models: ${activeModelTraining.size}`);
        }
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
    
    // Note: We no longer automatically remove from active training when handler is removed
    // This allows the UI to reconnect to ongoing training after page refresh
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
    
    // Get active models
    try {
      const activeModelsResponse = await fetch(`${SERVER_URL}/active-models`);
      if (activeModelsResponse.ok) {
        const { activeModels } = await activeModelsResponse.json();
        activeModels.forEach((model: any) => {
          activeModelTraining.add(model.modelId);
        });
        console.log('Retrieved active models from server:', activeModelTraining);
      }
    } catch (err) {
      console.error('Error fetching active models:', err);
    }
    
    return true;
  } catch (error) {
    console.error('Error connecting to ML server:', error);
    throw new Error('Unable to connect to ML server. Please ensure it is running.');
  }
};

// Check if a model is currently being trained
export const isModelTraining = (modelId: string): boolean => {
  return activeModelTraining.has(modelId);
};

// Get all active training models
export const getActiveTrainingModels = (): string[] => {
  return Array.from(activeModelTraining);
};

// Cancel an active training model
export const cancelTraining = (modelId: string): boolean => {
  if (!activeModelTraining.has(modelId)) {
    console.warn(`Model ${modelId} is not currently training`);
    return false;
  }
  
  if (!websocket || websocket.readyState !== WebSocket.OPEN) {
    console.error('WebSocket not connected');
    return false;
  }
  
  // Send cancel message to server
  websocket.send(JSON.stringify({
    type: 'cancelTraining',
    modelId
  }));
  
  return true;
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
      
      // Note: Don't remove handler immediately to allow receiving final messages
      // The server will notify us when training is complete

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

// Combine predictions from multiple models
export const combinePredictions = async (
  stockData: StockData,
  modelIds: string[],
  method: 'average' | 'weighted' | 'stacking' | 'bayesian' = 'average',
  signal?: AbortSignal
): Promise<{
  combinedPredictions: PredictionResult[];
  method: string;
  usedModels: string[];
  modelErrors?: string[];
}> => {
  try {
    const response = await fetch(`${SERVER_URL}/models/combined-predict`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        stockData,
        modelIds,
        method
      }),
      signal
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Combined prediction failed');
    }

    return await response.json();
  } catch (error) {
    console.error("Combined prediction error:", error);
    throw error;
  }
};

// Start combo training with multiple configurations
export const startComboTraining = async (
  stockData: StockData,
  configurations: Array<{
    sequenceLength: number;
    epochs: number;
    batchSize: number;
    daysToPredict: number;
  }>,
  signal?: AbortSignal
): Promise<{
  status: string;
  totalJobs: number;
  jobs: Array<{
    modelId: string;
    config: {
      sequenceLength: number;
      epochs: number;
      batchSize: number;
      daysToPredict: number;
    };
  }>;
}> => {
  try {
    const response = await fetch(`${SERVER_URL}/combo-train`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        stockData,
        configurations
      }),
      signal
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Combo training failed to start');
    }

    return await response.json();
  } catch (error) {
    console.error("Combo training error:", error);
    throw error;
  }
};
