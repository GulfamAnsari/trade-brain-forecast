
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Star, Clock, DollarSign, BarChart2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StockData } from "@/types/stock";
import { isInFavorites, addToFavorites, removeFromFavorites } from "@/utils/storage";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface StockDetailsProps {
  stockData: StockData;
  className?: string;
}

const StockDetails = ({ stockData, className }: StockDetailsProps) => {
  const [isFavorite, setIsFavorite] = useState(false);

  useEffect(() => {
    setIsFavorite(isInFavorites(stockData.symbol));
  }, [stockData.symbol]);

  const handleFavoriteToggle = () => {
    if (isFavorite) {
      removeFromFavorites(stockData.symbol);
      setIsFavorite(false);
      toast.success(`Removed ${stockData.name} from favorites`);
    } else {
      addToFavorites(stockData.symbol);
      setIsFavorite(true);
      toast.success(`Added ${stockData.name} to favorites`);
    }
  };

  if (!stockData || !stockData.timeSeries || stockData.timeSeries.length === 0) {
    return (
      <Card className={cn("animate-pulse", className)}>
        <CardHeader>
          <CardTitle className="bg-muted h-6 rounded-md w-1/3"></CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="bg-muted h-4 rounded-md w-full"></div>
            <div className="bg-muted h-4 rounded-md w-2/3"></div>
            <div className="bg-muted h-4 rounded-md w-3/4"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const latestData = stockData.timeSeries[stockData.timeSeries.length - 1];
  const previousData = stockData.timeSeries[stockData.timeSeries.length - 2] || latestData;
  
  const priceChange = latestData.close - previousData.close;
  const percentChange = (priceChange / previousData.close) * 100;
  const isPositive = priceChange >= 0;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  const formatVolume = (volume: number) => {
    return new Intl.NumberFormat('en-IN', {
      notation: "compact",
      compactDisplay: "short"
    }).format(volume);
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-2xl font-bold">{stockData.name}</CardTitle>
            <div className="text-sm text-muted-foreground mt-1">{stockData.symbol}</div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleFavoriteToggle}
            className={cn(
              "transition-all hover:scale-110",
              isFavorite ? "text-yellow-500 hover:text-yellow-600" : "text-muted-foreground"
            )}
          >
            <Star 
              className={cn(
                "h-5 w-5",
                isFavorite ? "fill-yellow-500" : "fill-none"
              )} 
            />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
          <div className="space-y-4">
            <div>
              <div className="text-3xl font-bold">{formatCurrency(latestData.close)}</div>
              <div className="flex items-center mt-1">
                <div className={cn(
                  "flex items-center text-sm font-medium",
                  isPositive ? "text-success" : "text-danger"
                )}>
                  {isPositive ? (
                    <TrendingUp className="h-4 w-4 mr-1" />
                  ) : (
                    <TrendingDown className="h-4 w-4 mr-1" />
                  )}
                  {isPositive ? "+" : ""}{priceChange.toFixed(2)} ({percentChange.toFixed(2)}%)
                </div>
              </div>
            </div>
            
            <div className="flex items-center">
              <Clock className="h-4 w-4 mr-2 text-muted-foreground" />
              <span className="text-sm">
                Last updated: {new Date(stockData.lastUpdated).toLocaleDateString()}
              </span>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg p-3 bg-accent/50">
              <div className="flex items-center mb-1">
                <DollarSign className="h-4 w-4 mr-1 text-muted-foreground" />
                <span className="text-sm font-medium">Price Range</span>
              </div>
              <div className="text-sm mt-1">
                <div>High: {formatCurrency(latestData.high)}</div>
                <div>Low: {formatCurrency(latestData.low)}</div>
              </div>
            </div>
            
            <div className="rounded-lg p-3 bg-accent/50">
              <div className="flex items-center mb-1">
                <BarChart2 className="h-4 w-4 mr-1 text-muted-foreground" />
                <span className="text-sm font-medium">Volume</span>
              </div>
              <div className="text-sm mt-1">
                {formatVolume(latestData.volume)}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default StockDetails;
