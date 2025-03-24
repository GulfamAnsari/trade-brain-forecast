
import { StockData } from "@/types/stock";

// Cache storage
const CACHE_KEY = "stock-data-cache";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Interface for the cache item
interface CacheItem {
  data: StockData;
  timestamp: number;
}

// Interface for the cache
interface Cache {
  [symbol: string]: CacheItem;
}

// Load cache from localStorage and clean expired items
const loadCache = (): Cache => {
  try {
    const cacheStr = localStorage.getItem(CACHE_KEY);
    const cache = cacheStr ? JSON.parse(cacheStr) : {};
    
    // Clean expired cache entries
    const now = Date.now();
    let hasExpired = false;
    
    Object.keys(cache).forEach(symbol => {
      if (now - cache[symbol].timestamp > CACHE_TTL) {
        delete cache[symbol];
        hasExpired = true;
      }
    });
    
    // Save cleaned cache if any items were removed
    if (hasExpired) {
      saveCache(cache);
    }
    
    return cache;
  } catch (error) {
    console.error("Error loading cache:", error);
    return {};
  }
};

// Save cache to localStorage
const saveCache = (cache: Cache): void => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.error("Error saving cache:", error);
  }
};

// Get stock data from cache
export const getFromCache = (symbol: string): StockData | null => {
  const cache = loadCache();
  const cacheItem = cache[symbol];
  
  // If the data doesn't exist or is expired, return null
  if (!cacheItem || Date.now() - cacheItem.timestamp > CACHE_TTL) {
    return null;
  }
  
  return cacheItem.data;
};

// Save stock data to cache
export const saveToCache = (symbol: string, data: StockData): void => {
  const cache = loadCache();
  
  cache[symbol] = {
    data,
    timestamp: Date.now(),
  };
  
  saveCache(cache);
};

// Clear the entire cache
export const clearCache = (): void => {
  localStorage.removeItem(CACHE_KEY);
};

// Clear a specific symbol from the cache
export const clearCacheForSymbol = (symbol: string): void => {
  const cache = loadCache();
  
  if (cache[symbol]) {
    delete cache[symbol];
    saveCache(cache);
  }
};

// Check and clean expired cache items - this can be called periodically
export const cleanExpiredCache = (): void => {
  loadCache(); // This will clean expired items automatically
};
