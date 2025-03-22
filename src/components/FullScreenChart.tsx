
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import StockChart from "@/components/StockChart";
import { StockData, PredictionResult } from "@/types/stock";

interface FullScreenChartProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stockData: StockData;
  predictions?: PredictionResult[];
  title: string;
  showPredictions?: boolean;
}

const FullScreenChart = ({
  open,
  onOpenChange,
  stockData,
  predictions = [],
  title,
  showPredictions = true
}: FullScreenChartProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] w-[90vw] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="h-[80vh]">
          <StockChart 
            stockData={stockData} 
            predictions={showPredictions ? predictions : []} 
            className="h-full"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default FullScreenChart;
