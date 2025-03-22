
// Local storage keys
const FAVORITE_STOCKS_KEY = "favorite-stocks";

// Get favorite stocks from localStorage
export const getFavoriteStocks = (): string[] => {
  try {
    const storedStocks = localStorage.getItem(FAVORITE_STOCKS_KEY);
    return storedStocks ? JSON.parse(storedStocks) : [];
  } catch (error) {
    console.error("Error getting favorite stocks:", error);
    return [];
  }
};

// Add a stock to favorites
export const addToFavorites = (symbol: string): void => {
  try {
    const favorites = getFavoriteStocks();
    
    if (!favorites.includes(symbol)) {
      favorites.push(symbol);
      localStorage.setItem(FAVORITE_STOCKS_KEY, JSON.stringify(favorites));
    }
  } catch (error) {
    console.error("Error adding to favorites:", error);
  }
};

// Remove a stock from favorites
export const removeFromFavorites = (symbol: string): void => {
  try {
    let favorites = getFavoriteStocks();
    
    favorites = favorites.filter(stock => stock !== symbol);
    localStorage.setItem(FAVORITE_STOCKS_KEY, JSON.stringify(favorites));
  } catch (error) {
    console.error("Error removing from favorites:", error);
  }
};

// Check if a stock is in favorites
export const isInFavorites = (symbol: string): boolean => {
  const favorites = getFavoriteStocks();
  return favorites.includes(symbol);
};
