import { useState, useEffect, useMemo } from "react";
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend,
  ReferenceLine,
  Area,
  ComposedChart
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StockData } from "@/types/stock";
import { cn } from "@/lib/utils";
import { Maximize2 } from "lucide-react";
import { Button } from "./ui/button";
import FullScreenChart from "./FullScreenChart";

interface PredictionData {
  date: string;
  prediction: number;
}

interface StockChartProps {
  stockData: StockData;
  predictions?: PredictionData[];
  className?: string;
  showPredictions?: boolean;
  title?: string;
}

interface ChartDataPoint {
  date: string;
  price?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  prediction?: number;
}

const timeRanges = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "All", days: Infinity },
];

const StockChart = ({ 
  stockData, 
  predictions = [], 
  className,
  showPredictions = true,
  title = "Price Chart" 
}: StockChartProps) => {
  const [timeRange, setTimeRange] = useState<number>(30);
  const [showFullScreen, setShowFullScreen] = useState(false);

  const chartData = useMemo(() => {
    if (!stockData?.timeSeries) return [];

    const filteredData = timeRange === Infinity 
      ? [...stockData.timeSeries]
      : stockData.timeSeries.slice(-timeRange);

    const formattedData: ChartDataPoint[] = filteredData.map(data => ({
      date: data.date,
      price: data.close,
      open: data.open,
      high: data.high,
      low: data.low,
      volume: data.volume,
    }));

    if (showPredictions && predictions.length > 0) {
      const existingDates = new Set(formattedData.map(d => d.date));

      predictions.forEach(pred => {
        if (!existingDates.has(pred.date)) {
          formattedData.push({
            date: pred.date,
            prediction: pred.prediction,
          });
        } else {
          const existingData = formattedData.find(d => d.date === pred.date);
          if (existingData) {
            existingData.prediction = pred.prediction;
          }
        }
      });
    }

    return formattedData.sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
  }, [stockData, timeRange, predictions, showPredictions]);

  const priceChange = useMemo(() => {
    if (!stockData?.timeSeries?.length) {
      return { change: 0, changePercent: 0 };
    }

    const latestPrice = stockData.timeSeries[stockData.timeSeries.length - 1].close;
    
    let previousPrice;
    if (timeRange === Infinity) {
      previousPrice = stockData.timeSeries[0].close;
    } else {
      const startIndex = Math.max(0, stockData.timeSeries.length - timeRange);
      previousPrice = stockData.timeSeries[startIndex].close;
    }

    const change = latestPrice - previousPrice;
    const changePercent = (change / previousPrice) * 100;

    return { change, changePercent };
  }, [stockData, timeRange]);

  const { change, changePercent } = priceChange;
  const isPositive = change >= 0;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="custom-tooltip card-glass p-3 text-sm">
          <p className="font-medium">{label}</p>
          {payload.map((entry: any, index: number) => (
            <div key={`tooltip-${index}`} className="flex gap-2 items-center">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: entry.color }} 
              />
              <p>
                {entry.name === "price" ? "Close" : 
                 entry.name === "prediction" ? "Prediction" : 
                 entry.name.charAt(0).toUpperCase() + entry.name.slice(1)}
                : {entry.value.toFixed(2)}
              </p>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  const formatDate = (date: string) => {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <>
      <Card className={cn("overflow-hidden", className)}>
        <CardHeader className="space-y-0 pb-2">
          <div className="flex justify-between items-center">
            <CardTitle className="text-xl">
              {title}
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className={isPositive ? "text-success" : "text-danger"}>
                <span className="text-xs font-medium">
                  {isPositive ? "+" : ""}{change.toFixed(2)} ({changePercent.toFixed(2)}%)
                </span>
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                className="p-1 h-auto" 
                onClick={() => setShowFullScreen(true)}
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between mt-2">
            <div className="flex gap-1">
              {timeRanges.map((range) => (
                <button
                  key={range.label}
                  className={cn(
                    "px-3 py-1 text-xs font-medium rounded-full transition-colors",
                    timeRange === range.days
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                  onClick={() => setTimeRange(range.days)}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 pb-4">
          <div className="w-full h-[300px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <defs>
                  <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorPrediction" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--accent-foreground))" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(var(--accent-foreground))" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={formatDate} 
                  minTickGap={30}
                  tick={{ fontSize: 12 }}
                  tickMargin={10}
                  className="text-xs text-muted-foreground"
                />
                <YAxis 
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 12 }}
                  tickMargin={10}
                  className="text-xs text-muted-foreground"
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Area 
                  type="monotone" 
                  dataKey="price" 
                  name="Price"
                  stroke="hsl(var(--primary))" 
                  fillOpacity={1}
                  fill="url(#colorPrice)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 6 }}
                />
                {showPredictions && predictions && predictions.length > 0 && (
                  <Line 
                    type="monotone" 
                    dataKey="prediction" 
                    name="Prediction"
                    stroke="hsl(var(--accent-foreground))" 
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={{ r: 3 }}
                    activeDot={{ r: 6 }}
                  />
                )}
                <ReferenceLine 
                  y={stockData.timeSeries[stockData.timeSeries.length - 1]?.close} 
                  stroke="hsl(var(--muted-foreground))" 
                  strokeDasharray="3 3" 
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <FullScreenChart 
        open={showFullScreen} 
        onOpenChange={setShowFullScreen} 
        stockData={stockData} 
        predictions={predictions}
        title={title}
        showPredictions={showPredictions}
      />
    </>
  );
};

export default StockChart;
