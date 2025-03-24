import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StockData, PredictionResult, ModelData } from "@/types/stock";
import { toast } from "sonner";
import { BrainCircuit, LineChart, Loader2, ServerCrash } from "lucide-react";
import PredictionSettings from "./PredictionSettings";
import { analyzeStock, initializeTensorFlow } from "@/utils/ml";

interface PredictionButtonProps {
  stockData: StockData;
  onPredictionComplete: (predictions: PredictionResult[]) => void;
  className?: string;
}

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
  const [serverConnected, setServerConnected] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    const initialize = async () => {
      try {
        setServerError(null);
        await initializeTensorFlow();
        console.log("Connected to ML server successfully");
        setServerConnected(true);
      } catch (error) {
        console.error("Failed to connect to ML server:", error);
        setServerError(error instanceof Error ? error.message : "Unknown error");
        toast.error("Failed to connect to ML server");
      }
    };
    
    initialize();
  }, []);

  const handleRunPrediction = async () => {
    if (!serverConnected) {
      if (serverError) {
        toast.error(`ML server connection failed: ${serverError}`);
      } else {
        toast.error("ML server not connected yet. Please try again in a moment.");
      }
      return;
    }
    
    if (!stockData || stockData.timeSeries.length < settings.sequenceLength + 5) {
      toast.error(`Not enough data to make predictions. Need at least ${settings.sequenceLength + 5} data points.`);
      return;
    }
    
    if (abortController) {
      abortController.abort();
    }
    
    const newAbortController = new AbortController();
    setAbortController(newAbortController);
    
    setIsLoading(true);
    setProgress(0);
    setProgressText("Initializing analysis...");
    
    try {
      const result = await analyzeStock(
        stockData,
        settings.sequenceLength,
        settings.epochs,
        settings.batchSize,
        settings.daysToPredict,
        (progress) => {
          const percentComplete = Math.floor((progress.epoch / progress.totalEpochs) * 100);
          setProgress(percentComplete);
          setProgressText(`Training model: ${progress.epoch}/${progress.totalEpochs} epochs (Loss: ${progress.loss.toFixed(4)})`);
        },
        newAbortController.signal
      );
      
      setModelData(result.modelData);
      onPredictionComplete(result.predictions);
      toast.success("Analysis completed successfully");
      
    } catch (error) {
      console.error("Analysis error:", error);
      if (error instanceof Error) {
        if (newAbortController.signal.aborted) {
          toast.info("Analysis was canceled");
        } else {
          toast.error(`Analysis failed: ${error.message}`);
        }
      } else {
        toast.error("Failed to analyze stock data. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSettingsChange = (newSettings: typeof settings) => {
    setSettings(newSettings);
  };

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
        ) : serverError ? (
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <ServerCrash className="h-5 w-5 text-destructive mt-0.5" />
              <div>
                <p className="text-sm font-medium text-destructive">
                  ML server connection failed
                </p>
                <p className="text-sm text-muted-foreground">
                  {serverError}
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Please make sure the ML server is running by starting it with:<br />
              <code className="bg-muted p-1 rounded text-xs">cd server && npm install && npm start</code>
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Click the button below to run the prediction model. This uses a server-side ML model for better performance.
          </p>
        )}
      </CardContent>
      <CardFooter>
        <Button 
          onClick={handleRunPrediction} 
          className="w-full"
          disabled={isLoading || !!serverError}
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
