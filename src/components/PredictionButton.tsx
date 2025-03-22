
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StockData, PredictionResult, ModelData } from "@/types/stock";
import { toast } from "sonner";
import { BrainCircuit, LineChart, Loader2 } from "lucide-react";
import PredictionSettings from "./PredictionSettings";

interface PredictionButtonProps {
  stockData: StockData;
  onPredictionComplete: (predictions: PredictionResult[]) => void;
  className?: string;
}

// Default prediction settings
const defaultSettings = {
  daysToPredict: 5,
  sequenceLength: 7,
  epochs: 30,
  batchSize: 32
};

const PredictionButton = ({ stockData, onPredictionComplete, className }: PredictionButtonProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [modelData, setModelData] = useState<ModelData | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [worker, setWorker] = useState<Worker | null>(null);
  const [settings, setSettings] = useState(defaultSettings);

  // Initialize worker
  useEffect(() => {
    // Create worker
    const newWorker = new Worker('/src/workers/predictionWorker.js', { type: 'module' });
    setWorker(newWorker);

    // Set up message handler
    newWorker.onmessage = (event) => {
      const { type, error, id, ...data } = event.data;
      
      switch (type) {
        case 'progress':
          const percentComplete = Math.floor((data.epoch / data.totalEpochs) * 100);
          setProgress(percentComplete);
          setProgressText(`Training model: ${data.epoch}/${data.totalEpochs} epochs (Loss: ${data.loss.toFixed(4)})`);
          break;
          
        case 'trained':
          setModelData({
            modelData: data.modelData,
            min: data.min,
            range: data.range,
            history: data.history
          });
          setProgressText("Making predictions...");
          break;
          
        case 'predicted':
          setIsLoading(false);
          onPredictionComplete(data.predictions);
          toast.success("Prediction completed successfully");
          break;
          
        case 'cleanup_complete':
          console.log("Model memory cleaned up");
          break;
          
        case 'error':
          console.error("Prediction error:", error);
          toast.error("Failed to make prediction. Please try again.");
          setIsLoading(false);
          break;
      }
    };

    // Handle worker errors
    newWorker.onerror = (error) => {
      console.error("Worker error:", error);
      toast.error("An error occurred with the prediction worker");
      setIsLoading(false);
    };

    // Cleanup when component unmounts
    return () => {
      if (newWorker) {
        newWorker.postMessage({ type: 'cleanup', id: Date.now().toString() });
        newWorker.terminate();
      }
      if (abortController) {
        abortController.abort();
      }
    };
  }, [onPredictionComplete]);

  const handleRunPrediction = async () => {
    if (!stockData || stockData.timeSeries.length < 30) {
      toast.error("Not enough data to make predictions");
      return;
    }
    
    if (!worker) {
      toast.error("Prediction worker not available");
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
    
    // Generate a unique request ID
    const requestId = Date.now().toString();
    
    try {
      // Start training the model
      worker.postMessage({
        type: 'train',
        data: {
          stockData,
          sequenceLength: settings.sequenceLength,
          epochs: settings.epochs,
          batchSize: settings.batchSize,
          signal: newAbortController.signal
        },
        id: requestId
      });
      
    } catch (error) {
      console.error("Error starting prediction:", error);
      setIsLoading(false);
      toast.error("Failed to start prediction. Please try again.");
    }
  };

  // Handle settings changes
  const handleSettingsChange = (newSettings: typeof settings) => {
    setSettings(newSettings);
  };

  // Handle predict stage after model training is done
  useEffect(() => {
    if (modelData && isLoading && worker) {
      const requestId = Date.now().toString();
      worker.postMessage({
        type: 'predict',
        data: {
          modelData: modelData.modelData,
          stockData,
          sequenceLength: settings.sequenceLength,
          min: modelData.min,
          range: modelData.range,
          daysToPredict: settings.daysToPredict,
          signal: abortController?.signal
        },
        id: requestId
      });
    }
  }, [modelData, isLoading, worker, stockData, settings, abortController]);

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-xl flex items-center gap-2">
              <BrainCircuit className="h-5 w-5 text-primary" />
              Machine Learning Prediction
            </CardTitle>
            <CardDescription>
              Generate price predictions using ML model
            </CardDescription>
          </div>
          {!isLoading && (
            <PredictionSettings 
              onSettingsChange={handleSettingsChange} 
              defaultSettings={settings} 
            />
          )}
        </div>
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
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Prediction days:</span>
              <span className="font-medium">{settings.daysToPredict}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Sequence length:</span>
              <span className="font-medium">{settings.sequenceLength}</span>
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
