
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import StockChart from "@/components/StockChart";
import { StockData, PredictionResult } from "@/types/stock";

interface FullScreenChartProps {
  stockData: StockData;
  predictions?: PredictionResult[];
  title: string;
  showPredictions?: boolean;
  showHistorical?: boolean;
  timeFrame?: '1m' | '6m' | '1y' | '5y' | 'all';
  onClose: () => void;
}

const FullScreenChart = ({
  stockData,
  predictions = [],
  title,
  showPredictions = true,
  showHistorical = false,
  timeFrame = '1y',
  onClose
}: FullScreenChartProps) => {
  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[90vw] w-[90vw] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="h-[80vh]">
          <StockChart 
            stockData={stockData} 
            predictions={predictions}
            showPredictions={showPredictions}
            showHistorical={showHistorical}
            className="h-full"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default FullScreenChart;
