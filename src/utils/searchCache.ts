
// Cache storage
const SEARCH_CACHE_KEY = "stock-search-cache";
const SEARCH_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Interface for the cache item
interface CacheItem {
  results: any[];
  timestamp: number;
}

// Interface for the cache
interface Cache {
  [query: string]: CacheItem;
}

// Load cache from localStorage
const loadCache = (): Cache => {
  try {
    const cacheStr = localStorage.getItem(SEARCH_CACHE_KEY);
    return cacheStr ? JSON.parse(cacheStr) : {};
  } catch (error) {
    console.error("Error loading search cache:", error);
    return {};
  }
};

// Save cache to localStorage
const saveCache = (cache: Cache): void => {
  try {
    localStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.error("Error saving search cache:", error);
  }
};

// Get search results from cache
export const getFromCache = (query: string): any[] | null => {
  const cache = loadCache();
  const cacheItem = cache[query];
  
  // If the data doesn't exist or is expired, return null
  if (!cacheItem || Date.now() - cacheItem.timestamp > SEARCH_CACHE_TTL) {
    return null;
  }
  
  return cacheItem.results;
};

// Save search results to cache
export const saveToCache = (query: string, results: any[]): void => {
  const cache = loadCache();
  
  cache[query] = {
    results,
    timestamp: Date.now(),
  };
  
  saveCache(cache);
};

// Clear the entire search cache
export const clearCache = (): void => {
  localStorage.removeItem(SEARCH_CACHE_KEY);
};
