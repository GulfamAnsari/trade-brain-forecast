
import { StockData, StockSearchResult, TimeSeriesData } from "@/types/stock";

// Mock data for NSE (National Stock Exchange of India) stocks
const mockStocks: StockSearchResult[] = [
  {
    symbol: "RELIANCE.BSE",
    name: "Reliance Industries Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "TCS.BSE",
    name: "Tata Consultancy Services Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "INFY.BSE",
    name: "Infosys Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "HDFCBANK.BSE",
    name: "HDFC Bank Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "ICICIBANK.BSE",
    name: "ICICI Bank Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "HINDUNILVR.BSE",
    name: "Hindustan Unilever Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "BHARTIARTL.BSE",
    name: "Bharti Airtel Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "ITC.BSE",
    name: "ITC Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "SBIN.BSE",
    name: "State Bank of India",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "KOTAKBANK.BSE",
    name: "Kotak Mahindra Bank Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
];

// Generate mock time series data for a given symbol
const generateMockTimeSeriesData = (symbol: string): TimeSeriesData[] => {
  const today = new Date();
  const data: TimeSeriesData[] = [];
  
  // Generate random starting point based on symbol
  const symbolSum = symbol.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  let basePrice = 1000 + (symbolSum % 9000); // Base price between 1000 and 10000
  
  // Generate 365 days of data
  for (let i = 365; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    
    // Small random change each day with some trend following
    const changePercent = (Math.random() - 0.48) * 2; // Slightly biased towards positive
    const change = basePrice * (changePercent / 100);
    
    const open = basePrice;
    const close = basePrice + change;
    const high = Math.max(open, close) + Math.random() * Math.abs(change) * 0.5;
    const low = Math.min(open, close) - Math.random() * Math.abs(change) * 0.5;
    const volume = Math.floor(Math.random() * 10000000) + 1000000;
    
    data.push({
      date: dateStr,
      open,
      high,
      low,
      close,
      volume,
    });
    
    // Update base price for the next day
    basePrice = close;
  }
  
  return data;
};

// Function to get mock stock search results based on a query
export const getMockStockSearch = (query: string): StockSearchResult[] => {
  if (!query) return [];
  
  const lowerQuery = query.toLowerCase();
  return mockStocks.filter(
    stock => 
      stock.symbol.toLowerCase().includes(lowerQuery) || 
      stock.name.toLowerCase().includes(lowerQuery)
  );
};

// Function to get mock stock data for a symbol
export const getMockStockData = (symbol: string): StockData => {
  const stock = mockStocks.find(s => s.symbol === symbol) || {
    symbol,
    name: symbol,
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  };
  
  return {
    symbol: stock.symbol,
    name: stock.name,
    lastUpdated: new Date().toISOString().split('T')[0],
    timeSeries: generateMockTimeSeriesData(symbol),
  };
};
