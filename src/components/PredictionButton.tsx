
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StockData, PredictionResult, ModelData } from "@/types/stock";
import { trainModelWithWorker, predictWithWorker } from "@/utils/ml";
import { toast } from "sonner";
import { BrainCircuit, LineChart, Loader2 } from "lucide-react";

interface PredictionButtonProps {
  stockData: StockData;
  onPredictionComplete: (predictions: PredictionResult[]) => void;
  className?: string;
}

const PredictionButton = ({ stockData, onPredictionComplete, className }: PredictionButtonProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [modelData, setModelData] = useState<ModelData | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Cleanup when component unmounts
  useEffect(() => {
    return () => {
      if (abortController) {
        abortController.abort();
      }
    };
  }, [abortController]);

  const handleRunPrediction = async () => {
    if (!stockData || stockData.timeSeries.length < 30) {
      toast.error("Not enough data to make predictions");
      return;
    }
    
    // Cancel any previous prediction
    if (abortController) {
      abortController.abort();
    }
    
    // Create new abort controller
    const newAbortController = new AbortController();
    setAbortController(newAbortController);
    
    setIsLoading(true);
    setProgress(0);
    setProgressText("Initializing model...");
    
    try {
      // Use simplified model parameters for better performance
      const trainedModel = await trainModelWithWorker(
        stockData,
        7, // Reduced sequence length (was 10)
        30, // Reduced epochs (was 50)
        32, // batch size
        (progress) => {
          const percentComplete = Math.floor((progress.epoch / progress.totalEpochs) * 100);
          setProgress(percentComplete);
          setProgressText(`Training model: ${progress.epoch}/${progress.totalEpochs} epochs (Loss: ${progress.loss.toFixed(4)})`);
        },
        newAbortController.signal
      );
      
      // Check if aborted
      if (newAbortController.signal.aborted) {
        throw new Error("Prediction was cancelled");
      }
      
      setModelData(trainedModel);
      setProgressText("Making predictions...");
      
      // Make predictions with reduced days to predict
      const predictions = await predictWithWorker(
        trainedModel.modelData,
        stockData,
        7, // sequence length (was 10)
        trainedModel.min,
        trainedModel.range,
        5, // Reduced days to predict (was 7)
        newAbortController.signal
      );
      
      // Check if aborted
      if (newAbortController.signal.aborted) {
        throw new Error("Prediction was cancelled");
      }
      
      onPredictionComplete(predictions);
      
      toast.success("Prediction completed successfully");
    } catch (error) {
      if (error instanceof Error && error.message === "Prediction was cancelled") {
        console.log("Prediction was cancelled");
      } else {
        console.error("Prediction error:", error);
        toast.error("Failed to make prediction. Please try again.");
      }
    } finally {
      // Only update state if not aborted
      if (!newAbortController.signal.aborted) {
        setIsLoading(false);
      }
    }
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xl flex items-center gap-2">
          <BrainCircuit className="h-5 w-5 text-primary" />
          Machine Learning Prediction
        </CardTitle>
        <CardDescription>
          Generate price predictions for the next 5 days using our ML model
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-2">
        {isLoading ? (
          <>
            <Progress value={progress} className="w-full h-2" />
            <p className="text-sm text-muted-foreground mt-2">{progressText}</p>
            <Button 
              variant="outline" 
              size="sm" 
              className="mt-3 w-full"
              onClick={() => {
                if (abortController) {
                  abortController.abort();
                  setIsLoading(false);
                }
              }}
            >
              Cancel
            </Button>
          </>
        ) : modelData ? (
          <div className="space-y-3">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Training loss:</span>
              <span className="font-medium">{modelData.history.loss[modelData.history.loss.length - 1].toFixed(4)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Validation loss:</span>
              <span className="font-medium">{modelData.history.val_loss[modelData.history.val_loss.length - 1].toFixed(4)}</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Click the button below to run the prediction model. This may take a few moments.
          </p>
        )}
      </CardContent>
      <CardFooter>
        <Button 
          onClick={handleRunPrediction} 
          className="w-full"
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : modelData ? (
            <>
              <LineChart className="mr-2 h-4 w-4" />
              Run Prediction Again
            </>
          ) : (
            <>
              <LineChart className="mr-2 h-4 w-4" />
              Run Prediction
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default PredictionButton;
