
import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { StockData, PredictionResult } from "@/types/stock";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from "recharts";
import { formatDate } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Maximize2 } from "lucide-react";
import FullScreenChart from "./FullScreenChart";

export interface StockChartProps {
  stockData: StockData;
  predictions?: PredictionResult[];
  showPredictions?: boolean;
  showHistorical?: boolean;
  title?: string;
  height?: number;
  className?: string;
}

// Create a type for chart data points
interface ChartDataPoint {
  date: string;
  formattedDate: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  prediction?: number;
}

// Time frame options
type TimeFrame = '1m' | '6m' | '1y' | '2y' | '5y' | 'all';

const StockChart = ({ 
  stockData, 
  predictions = [], 
  showPredictions = false,
  showHistorical = false,
  title = "Stock Price Chart", 
  height = 400, 
  className = "" 
}: StockChartProps) => {
  const [showFullScreen, setShowFullScreen] = useState(false);
  const [timeFrame, setTimeFrame] = useState<TimeFrame>('1m');

  if (!stockData || !stockData.timeSeries) {
    return (
      <Card className={className}>
        <CardContent className="p-4">
          <Skeleton className="h-[400px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const formattedData: ChartDataPoint[] = stockData.timeSeries.map((dataPoint) => ({
    ...dataPoint,
    formattedDate: formatDate(new Date(dataPoint.date))
  }));

  const latestDate = new Date(stockData.timeSeries[stockData.timeSeries.length - 1].date);
  
  // Filter data based on selected time frame
  const filterDataByTimeFrame = (data: ChartDataPoint[]): ChartDataPoint[] => {
    const now = new Date();
    let cutoffDate: Date;
    
    switch (timeFrame) {
      case '1m':
        cutoffDate = new Date(now.setMonth(now.getMonth() - 1));
        break;
      case '6m':
        cutoffDate = new Date(now.setMonth(now.getMonth() - 6));
        break;
      case '1y':
        cutoffDate = new Date(now.setFullYear(now.getFullYear() - 1));
        break;
      case '2y':
        cutoffDate = new Date(now.setFullYear(now.getFullYear() - 2));
        break;
      case '5y':
        cutoffDate = new Date(now.setFullYear(now.getFullYear() - 5));
        break;
      case 'all':
      default:
        return [...data];
    }
    
    return data.filter(item => new Date(item.date) >= cutoffDate);
  };
  
  // Combine historical data with prediction data
  const combinedData: ChartDataPoint[] = [...formattedData];
  
  // Add prediction data if available and showing predictions
  if (predictions && showPredictions) {
    // Only add predictions for future dates by default (unless showHistorical is true)
    const predictionData: ChartDataPoint[] = predictions
      .filter(prediction => {
        const predDate = new Date(prediction.date);
        return showHistorical || predDate > latestDate;
      })
      .map(prediction => ({
        date: prediction.date,
        formattedDate: formatDate(new Date(prediction.date)),
        open: undefined,
        high: undefined,
        low: undefined,
        close: undefined,
        volume: undefined,
        prediction: prediction.prediction
      }));
    
    combinedData.push(...predictionData);
  }

  // Sort the combined data by date
  combinedData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  // Apply time frame filter
  const filteredData = filterDataByTimeFrame(combinedData);

  // Determine min and max values for better chart scaling
  let minValue = Math.min(
    ...filteredData
      .map(data => [data.close, data.prediction])
      .flat()
      .filter(val => val !== null && val !== undefined) as number[]
  );
  
  let maxValue = Math.max(
    ...filteredData
      .map(data => [data.close, data.prediction])
      .flat()
      .filter(val => val !== null && val !== undefined) as number[]
  );

  // Add some padding to the min and max values
  const range = maxValue - minValue;
  minValue = minValue - range * 0.05;
  maxValue = maxValue + range * 0.05;

  return (
    <>
      <Card className={className}>
        <CardContent className="p-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">{title}</h3>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowFullScreen(true)}
              title="View Full Screen"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
          
          {/* Time frame selector */}
          <div className="flex flex-wrap gap-2 mb-4">
            <Button 
              variant={timeFrame === '1m' ? "default" : "outline"} 
              size="sm"
              onClick={() => setTimeFrame('1m')}
            >
              1M
            </Button>
            <Button 
              variant={timeFrame === '6m' ? "default" : "outline"} 
              size="sm"
              onClick={() => setTimeFrame('6m')}
            >
              6M
            </Button>
            <Button 
              variant={timeFrame === '1y' ? "default" : "outline"} 
              size="sm"
              onClick={() => setTimeFrame('1y')}
            >
              1Y
            </Button>
            <Button 
              variant={timeFrame === '2y' ? "default" : "outline"} 
              size="sm"
              onClick={() => setTimeFrame('2y')}
            >
              2Y
            </Button>
            <Button 
              variant={timeFrame === '5y' ? "default" : "outline"} 
              size="sm"
              onClick={() => setTimeFrame('5y')}
            >
              5Y
            </Button>
            <Button 
              variant={timeFrame === 'all' ? "default" : "outline"} 
              size="sm"
              onClick={() => setTimeFrame('all')}
            >
              All
            </Button>
          </div>
          
          <div style={{ height: `${height}px` }} className="w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={filteredData}
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              >
                <XAxis 
                  dataKey="formattedDate"
                  tick={{ fontSize: 10 }}
                  interval="preserveStartEnd" 
                />
                <YAxis 
                  domain={[minValue, maxValue]} 
                  tick={{ fontSize: 10 }}
                  tickFormatter={(value) => value.toFixed(1)}
                />
                <Tooltip
                  formatter={(value, name) => [
                    `₹${Number(value).toFixed(2)}`, 
                    name === "prediction" ? "Predicted Price" : "Actual Price"
                  ]}
                  labelFormatter={(label) => `Date: ${label}`}
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--border))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '4px',
                    padding: '8px'
                  }}
                />
                <Legend />
                <ReferenceLine
                  x={formatDate(latestDate)}
                  stroke="#ff0000"
                  strokeDasharray="3 3"
                  label={{ value: "Today", position: "insideBottomRight" }}
                />
                <Line
                  type="monotone"
                  dataKey="close"
                  stroke="#8884d8"
                  name="Actual Price"
                  dot={{ r: 0 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                  connectNulls
                />
                {showPredictions && (
                  <Line
                    type="monotone"
                    dataKey="prediction"
                    stroke="#82ca9d"
                    strokeWidth={2}
                    name="Predicted Price"
                    dot={{ r: 0 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
      
      {showFullScreen && (
        <FullScreenChart
          stockData={stockData}
          predictions={predictions}
          showPredictions={showPredictions}
          showHistorical={showHistorical}
          title={title}
          timeFrame={timeFrame}
          onClose={() => setShowFullScreen(false)}
        />
      )}
    </>
  );
};

export default StockChart;
