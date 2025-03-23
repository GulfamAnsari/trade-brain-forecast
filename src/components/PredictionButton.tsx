
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StockData, PredictionResult, ModelData } from "@/types/stock";
import { toast } from "sonner";
import { BrainCircuit, LineChart, Loader2 } from "lucide-react";
import PredictionSettings from "./PredictionSettings";
import { trainModelWithWorker, predictWithWorker, initializeTensorFlow } from "@/utils/ml";

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
  const [settings, setSettings] = useState(defaultSettings);
  const [tfInitialized, setTfInitialized] = useState(false);
  const [tfInitError, setTfInitError] = useState<string | null>(null);

  // Initialize TensorFlow when component mounts
  useEffect(() => {
    const initialize = async () => {
      try {
        setTfInitError(null);
        await initializeTensorFlow();
        console.log("TensorFlow initialized in PredictionButton component");
        setTfInitialized(true);
      } catch (error) {
        console.error("Failed to initialize TensorFlow:", error);
        setTfInitError(error instanceof Error ? error.message : "Unknown error");
        toast.error("Failed to initialize ML framework");
      }
    };
    
    initialize();
  }, []);

  // Handle running the prediction
  const handleRunPrediction = async () => {
    // Check if TensorFlow is initialized
    if (!tfInitialized) {
      if (tfInitError) {
        toast.error(`ML framework initialization failed: ${tfInitError}`);
      } else {
        toast.error("ML framework not initialized yet. Please try again in a moment.");
      }
      return;
    }
    
    if (!stockData || stockData.timeSeries.length < settings.sequenceLength + 5) {
      toast.error(`Not enough data to make predictions. Need at least ${settings.sequenceLength + 5} data points.`);
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
      console.log("Starting prediction process for stock:", stockData.symbol);
      
      // Train the model
      setProgressText("Preparing training data...");
      const trainedModel = await trainModelWithWorker(
        stockData,
        settings.sequenceLength,
        settings.epochs,
        settings.batchSize,
        (progress) => {
          const percentComplete = Math.floor((progress.epoch / progress.totalEpochs) * 100);
          setProgress(percentComplete);
          setProgressText(`Training model: ${progress.epoch}/${progress.totalEpochs} epochs (Loss: ${progress.loss.toFixed(4)})`);
        },
        newAbortController.signal
      );
      
      setModelData(trainedModel);
      setProgressText("Making predictions...");
      
      console.log("Model trained successfully, making predictions");
      
      // Make predictions
      const predictions = await predictWithWorker(
        trainedModel.modelData,
        stockData,
        settings.sequenceLength,
        trainedModel.min,
        trainedModel.range,
        settings.daysToPredict,
        newAbortController.signal
      );
      
      console.log("Predictions generated successfully:", predictions.length);
      
      onPredictionComplete(predictions);
      toast.success("Prediction completed successfully");
      
    } catch (error) {
      console.error("Prediction error:", error);
      if (error instanceof Error) {
        if (newAbortController.signal.aborted) {
          toast.info("Prediction was canceled");
        } else {
          toast.error(`Prediction failed: ${error.message}`);
        }
      } else {
        toast.error("Failed to make prediction. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Handle settings changes
  const handleSettingsChange = (newSettings: typeof settings) => {
    setSettings(newSettings);
  };

  // Clean up when component unmounts
  useEffect(() => {
    return () => {
      if (abortController) {
        abortController.abort();
      }
    };
  }, []);

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
        ) : tfInitError ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">
              ML framework initialization failed: {tfInitError}
            </p>
            <p className="text-sm text-muted-foreground">
              You may need to refresh the page or try a different browser.
            </p>
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
          disabled={isLoading || !!tfInitError}
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
