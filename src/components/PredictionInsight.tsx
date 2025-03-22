
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, AlertCircle, Check, HelpCircle } from "lucide-react";
import { PredictionResult } from "@/types/stock";
import { cn } from "@/lib/utils";

interface PredictionInsightProps {
  predictions: PredictionResult[];
  currentPrice: number;
  className?: string;
}

const PredictionInsight = ({ predictions, currentPrice, className }: PredictionInsightProps) => {
  if (!predictions || predictions.length === 0) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-muted-foreground" />
            Price Prediction Insight
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Run the prediction model to see insights about future price trends.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Get the last prediction (furthest in the future)
  const lastPrediction = predictions[predictions.length - 1];
  
  // Calculate the change from current price to last prediction
  const priceChange = lastPrediction.prediction - currentPrice;
  const percentChange = (priceChange / currentPrice) * 100;
  const isPositive = priceChange >= 0;

  // Calculate the trend (how many predictions are up vs down)
  let upCount = 0;
  let downCount = 0;
  let previousPrice = currentPrice;

  for (const prediction of predictions) {
    if (prediction.prediction > previousPrice) {
      upCount++;
    } else if (prediction.prediction < previousPrice) {
      downCount++;
    }
    previousPrice = prediction.prediction;
  }

  // Determine trend strength
  const trendStrength = Math.abs(upCount - downCount) / predictions.length;
  const hasClearTrend = trendStrength > 0.6;
  const isTrendUp = upCount > downCount;

  // Format numbers
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          {isPositive ? (
            <TrendingUp className="h-5 w-5 text-emerald-500" />
          ) : (
            <TrendingDown className="h-5 w-5 text-rose-500" />
          )}
          Price Prediction Insight
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-medium mb-1">Predicted in {predictions.length} days:</h4>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold">{formatCurrency(lastPrediction.prediction)}</span>
              <span className={cn(
                "text-sm font-medium",
                isPositive ? "text-emerald-500" : "text-rose-500"
              )}>
                {isPositive ? "+" : ""}{priceChange.toFixed(2)} ({percentChange.toFixed(2)}%)
              </span>
            </div>
          </div>
          
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Trend Analysis:</h4>
            <div className="flex items-start gap-2 text-sm">
              {hasClearTrend ? (
                <>
                  <Check className={cn(
                    "h-4 w-4 mt-0.5",
                    isTrendUp ? "text-emerald-500" : "text-rose-500"
                  )} />
                  <div>
                    <p className="font-medium">
                      {isTrendUp ? "Strong Upward Trend" : "Strong Downward Trend"}
                    </p>
                    <p className="text-muted-foreground mt-1">
                      The model predicts a {isTrendUp ? "consistent increase" : "consistent decrease"} 
                      in price over the next {predictions.length} days.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5" />
                  <div>
                    <p className="font-medium">Mixed or Uncertain Trend</p>
                    <p className="text-muted-foreground mt-1">
                      The model predicts price fluctuations with no clear direction
                      over the next {predictions.length} days.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
          
          <div className="text-xs text-muted-foreground border-t pt-2 mt-4">
            Note: These predictions are based on historical data patterns and may not
            account for unexpected market events or news.
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default PredictionInsight;
