
// Stock search result interface
export interface StockSearchResult {
  symbol: string;
  name: string;
  type: string;
  region: string;
  marketOpen: string;
  marketClose: string;
  timezone: string;
  currency: string;
}

// Time series data interface
export interface TimeSeriesData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Stock data interface
export interface StockData {
  symbol: string;
  name: string;
  lastUpdated: string;
  timeSeries: TimeSeriesData[];
}

// Prediction result interface
export interface PredictionResult {
  date: string;
  prediction: number;
}

// Model data interface
export interface ModelData {
  modelData: any;
  min: number;
  range: number;
  history: {
    loss: number[];
    val_loss: number[];
  };
}
