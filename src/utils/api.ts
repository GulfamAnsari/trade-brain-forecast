
import { toast } from "sonner";
import { StockData, StockSearchResult } from "@/types/stock";
import { getFromCache, saveToCache } from "./cache";
import { getMockEnabled } from "./config";
import { getMockStockData, getMockStockSearch } from "./mockData";
import { searchIndianStocks } from "@/data/indianStocks";

// AlphaVantage API key
const API_KEY = "demo"; // Replace with your API key

// Base URL for the AlphaVantage API
const BASE_URL = "https://www.alphavantage.co/query";

// Function to search for stocks
export const searchStocks = async (query: string): Promise<StockSearchResult[]> => {
  try {
    // Check if mock is enabled
    if (getMockEnabled()) {
      return getMockStockSearch(query);
    }

    // Use hardcoded Indian stocks data instead of API
    return searchIndianStocks(query);

    /* Uncomment if you want to use the API instead
    const response = await fetch(
      `${BASE_URL}?function=SYMBOL_SEARCH&keywords=${query}&apikey=${API_KEY}`
    );

    if (!response.ok) {
      throw new Error("Failed to fetch stock data");
    }

    const data = await response.json();
    
    if (data.bestMatches) {
      return data.bestMatches.map((match: any) => ({
        symbol: match["1. symbol"],
        name: match["2. name"],
        type: match["3. type"],
        region: match["4. region"],
        marketOpen: match["5. marketOpen"],
        marketClose: match["6. marketClose"],
        timezone: match["7. timezone"],
        currency: match["8. currency"],
      }));
    }
    */
    
    return [];
  } catch (error) {
    console.error("Error searching stocks:", error);
    toast.error("Failed to search stocks. Please try again later.");
    return [];
  }
};

// Function to get stock data
export const getStockData = async (symbol: string): Promise<StockData | null> => {
  try {
    // Check cache first
    const cachedData = getFromCache(symbol);
    if (cachedData) {
      return cachedData;
    }

    // Check if mock is enabled
    if (getMockEnabled()) {
      const mockData = getMockStockData(symbol);
      saveToCache(symbol, mockData);
      return mockData;
    }

    const response = await fetch(
      `${BASE_URL}?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=full&apikey=${API_KEY}`
    );

    if (!response.ok) {
      throw new Error("Failed to fetch stock data");
    }

    const data = await response.json();
    
    if (data["Time Series (Daily)"]) {
      const timeSeries = data["Time Series (Daily)"];
      const stockData: StockData = {
        symbol,
        name: data["Meta Data"]?.["2. Symbol"] || symbol,
        lastUpdated: data["Meta Data"]?.["3. Last Refreshed"] || new Date().toISOString().split('T')[0],
        timeSeries: Object.entries(timeSeries).map(([date, values]: [string, any]) => ({
          date,
          open: parseFloat(values["1. open"]),
          high: parseFloat(values["2. high"]),
          low: parseFloat(values["3. low"]),
          close: parseFloat(values["4. close"]),
          volume: parseInt(values["5. volume"], 10),
        })).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
      };
      
      // Save to cache
      saveToCache(symbol, stockData);
      
      return stockData;
    }
    
    return null;
  } catch (error) {
    console.error("Error fetching stock data:", error);
    toast.error("Failed to fetch stock data. Please try again later.");
    return null;
  }
};
