
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getFavoriteStocks } from "@/utils/storage";
import { getStockData } from "@/utils/api";
import { StockData } from "@/types/stock";
import { TrendingUp, TrendingDown, BookmarkX } from "lucide-react";
import { cn } from "@/lib/utils";

const FavoritesList = () => {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [stocksData, setStocksData] = useState<Record<string, StockData | null>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadFavorites = () => {
      const favoriteStocks = getFavoriteStocks();
      setFavorites(favoriteStocks);
      
      if (favoriteStocks.length === 0) {
        setIsLoading(false);
      }
    };

    loadFavorites();

    // Set up interval to refresh every minute
    const interval = setInterval(loadFavorites, 60000);
    
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchStockData = async () => {
      if (favorites.length === 0) return;
      
      setIsLoading(true);
      
      const newStocksData: Record<string, StockData | null> = { ...stocksData };
      
      for (const symbol of favorites) {
        try {
          const data = await getStockData(symbol);
          newStocksData[symbol] = data;
        } catch (error) {
          console.error(`Error fetching data for ${symbol}:`, error);
          newStocksData[symbol] = null;
        }
      }
      
      setStocksData(newStocksData);
      setIsLoading(false);
    };

    fetchStockData();
  }, [favorites]);

  const getPriceChange = (stock: StockData) => {
    if (!stock || !stock.timeSeries || stock.timeSeries.length < 2) {
      return { change: 0, percentChange: 0 };
    }
    
    const latestData = stock.timeSeries[stock.timeSeries.length - 1];
    const previousData = stock.timeSeries[stock.timeSeries.length - 2];
    
    const change = latestData.close - previousData.close;
    const percentChange = (change / previousData.close) * 100;
    
    return { change, percentChange };
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="pb-4">
              <div className="h-5 bg-muted rounded w-1/3"></div>
              <div className="h-4 bg-muted rounded w-1/2 mt-2"></div>
            </CardHeader>
            <CardContent>
              <div className="h-8 bg-muted rounded w-1/2 mb-2"></div>
              <div className="h-4 bg-muted rounded w-1/4"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (favorites.length === 0) {
    return (
      <Card className="text-center py-12">
        <CardContent>
          <BookmarkX className="h-12 w-12 mx-auto text-muted-foreground" />
          <h3 className="text-xl font-semibold mt-4">No favorites yet</h3>
          <p className="text-muted-foreground mt-2">
            Search for stocks and add them to your favorites to see them here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {favorites.map((symbol) => {
        const stock = stocksData[symbol];
        
        if (!stock) {
          return (
            <Card key={symbol} className="animate-pulse">
              <CardHeader>
                <CardTitle>{symbol}</CardTitle>
                <CardDescription>Loading...</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-4 bg-muted rounded w-1/2"></div>
              </CardContent>
            </Card>
          );
        }
        
        const { change, percentChange } = getPriceChange(stock);
        const isPositive = change >= 0;
        const latestData = stock.timeSeries[stock.timeSeries.length - 1];
        
        return (
          <Link key={symbol} to={`/stock/${symbol}`} className="transition-transform hover:scale-[1.02]">
            <Card className="h-full">
              <CardHeader className="pb-2">
                <CardTitle>{stock.name}</CardTitle>
                <CardDescription>{symbol}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  ₹{latestData.close.toFixed(2)}
                </div>
                <div className={cn(
                  "flex items-center mt-2 text-sm font-medium",
                  isPositive ? "text-success" : "text-danger"
                )}>
                  {isPositive ? (
                    <TrendingUp className="h-4 w-4 mr-1" />
                  ) : (
                    <TrendingDown className="h-4 w-4 mr-1" />
                  )}
                  {isPositive ? "+" : ""}{change.toFixed(2)} ({percentChange.toFixed(2)}%)
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
};

export default FavoritesList;
