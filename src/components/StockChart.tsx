
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

  // Determine min and max values for better chart scaling
  let minValue = Math.min(
    ...combinedData
      .map(data => [data.close, data.prediction])
      .flat()
      .filter(val => val !== null && val !== undefined) as number[]
  );
  
  let maxValue = Math.max(
    ...combinedData
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
          <div style={{ height: `${height}px` }} className="w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={combinedData}
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="formattedDate"
                  tick={{ fontSize: 12 }}
                  interval="preserveStartEnd" 
                />
                <YAxis 
                  domain={[minValue, maxValue]} 
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value) => value.toFixed(1)}
                />
                <Tooltip
                  formatter={(value, name) => [
                    `₹${Number(value).toFixed(2)}`, 
                    name === "prediction" ? "Predicted Price" : "Actual Price"
                  ]}
                  labelFormatter={(label) => `Date: ${label}`}
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
                  dot={{ r: 1 }}
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
                    dot={{ r: 3 }}
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
          onClose={() => setShowFullScreen(false)}
        />
      )}
    </>
  );
};

export default StockChart;
