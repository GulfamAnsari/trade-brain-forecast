
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StockData, PredictionResult } from "@/types/stock";
import { toast } from "sonner";
import { BrainCircuit, LineChart, Loader2, ServerCrash, Settings, AlertTriangle, History } from "lucide-react";
import PredictionSettings from "./PredictionSettings";
import { analyzeStock, initializeTensorFlow } from "@/utils/ml";
import { SERVER_URL, generateModelId } from "@/config";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";

interface PredictionButtonProps {
  stockData: StockData;
  onPredictionComplete: (predictions: PredictionResult[]) => void;
  className?: string;
}

const defaultSettings = {
  daysToPredict: 30,
  sequenceLength: 360,
  epochs: 100,
  batchSize: 32
};

const PredictionButton = ({ stockData, onPredictionComplete, className }: PredictionButtonProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [modelData, setModelData] = useState<any | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [settings, setSettings] = useState(defaultSettings);
  const [serverConnected, setServerConnected] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [trainingStats, setTrainingStats] = useState<any | null>(null);
  const [usingSavedModel, setUsingSavedModel] = useState(false);
  const [dataPoints, setDataPoints] = useState<number | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [savedModels, setSavedModels] = useState<{modelId: string; config?: any}[]>([]);
  const [modelExists, setModelExists] = useState(false);
  const [predictionTab, setPredictionTab] = useState<'future' | 'past'>('future');
  const [selectedModelId, setSelectedModelId] = useState<string>("");

  useEffect(() => {
    const initialize = async () => {
      try {
        setServerError(null);
        await initializeTensorFlow();
        console.log("Connected to ML server successfully");
        setServerConnected(true);
        fetchSavedModels();
      } catch (error) {
        console.error("Failed to connect to ML server:", error);
        setServerError(error instanceof Error ? error.message : "Unknown error");
        toast.error("Failed to connect to ML server");
      }
    };
    
    initialize();
  }, []);

  useEffect(() => {
    if (stockData && settings) {
      // Calculate the model ID based on current settings and stock data
      const newModelId = generateModelId(
        stockData.symbol, 
        settings.sequenceLength, 
        settings.daysToPredict, 
        settings.epochs, 
        settings.batchSize
      );
      
      setModelId(newModelId);
      
      // Check if this model already exists in saved models
      setModelExists(savedModels.some(model => model.modelId === newModelId));
      
      // Set the selected model if it's not set yet and we have models
      if (!selectedModelId && savedModels.length > 0) {
        // Filter for models that match this stock
        const stockModels = savedModels.filter(model => 
          model.modelId.startsWith(stockData.symbol)
        );
        
        if (stockModels.length > 0) {
          setSelectedModelId(stockModels[0].modelId);
        }
      }
    }
  }, [stockData, settings, savedModels, selectedModelId]);

  const fetchSavedModels = async () => {
    try {
      const response = await fetch(`${SERVER_URL}/api/models`);
      if (!response.ok) throw new Error("Failed to fetch models");
      
      const data = await response.json();
      
      // Set models with any additional config data
      setSavedModels(data.models.map((model: any) => ({
        modelId: model.modelId,
        config: model.config || {}
      })));
      
      // Filter for this specific stock's models
      const stockModels = data.models.filter((model: any) => 
        model.modelId.startsWith(stockData.symbol)
      );
      
      // Set a default selected model if we have any for this stock
      if (stockModels.length > 0 && !selectedModelId) {
        setSelectedModelId(stockModels[0].modelId);
      }
    } catch (error) {
      console.error("Error fetching saved models:", error);
    }
  };

  const handleLoadExistingModel = async () => {
    // For past prediction, use selectedModelId; for future prediction use modelId
    const modelToUse = predictionTab === 'past' ? selectedModelId : modelId;
    
    if (!modelToUse) {
      toast.error("No model selected. Please select a model first.");
      return;
    }
    
    setIsLoading(true);
    setProgress(0);
    setProgressText("Loading existing model...");
    setUsingSavedModel(true);
    
    try {
      // Make a clean copy of stock data
      const cleanStockData = {
        ...stockData,
        timeSeries: stockData.timeSeries.map(item => ({
          date: item.date,
          open: item.open,
          high: item.high,
          low: item.low,
          close: item.close,
          volume: item.volume
        }))
      };
      
      const endpoint = predictionTab === 'past' 
        ? `${SERVER_URL}/api/models/${modelToUse}/predict-past` 
        : `${SERVER_URL}/api/models/${modelToUse}/predict`;
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          stockData: cleanStockData,
          pastDays: predictionTab === 'past' ? settings.daysToPredict : 0
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to make prediction');
      }
      
      const result = await response.json();
      
      if (!result.predictions || result.predictions.length === 0) {
        throw new Error('No predictions returned from model');
      }
      
      console.log(`Prediction successful, received ${result.predictions.length} data points`);
      
      setModelData({
        isExistingModel: true,
        modelId: modelToUse,
        params: {
          inputSize: settings.sequenceLength,
          outputSize: settings.daysToPredict,
          epochs: settings.epochs,
          batchSize: settings.batchSize
        }
      });
      
      onPredictionComplete(result.predictions);
      toast.success(`${predictionTab === 'past' ? 'Past validation' : 'Prediction'} completed using existing model`);
      
    } catch (error) {
      console.error("Error using existing model:", error);
      toast.error("Failed to use existing model. Training new one...");
      // If loading failed, fall back to training
      handleRunPrediction(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunPrediction = async (forceTraining = false) => {
    if (!serverConnected) {
      if (serverError) {
        toast.error(`ML server connection failed: ${serverError}`);
      } else {
        toast.error("ML server not connected yet. Please try again in a moment.");
      }
      return;
    }
    
    if (!stockData || stockData.timeSeries.length < 5) {
      toast.error(`Not enough data to make predictions. Need at least 5 data points.`);
      return;
    }
    
    // If model exists and we're not forcing training, load the existing model
    if (modelExists && !forceTraining && predictionTab === 'future') {
      handleLoadExistingModel();
      return;
    }
    
    // For past validation with selected model, use that instead of training
    if (predictionTab === 'past' && selectedModelId && !forceTraining) {
      handleLoadExistingModel();
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
    setTrainingStats(null);
    setUsingSavedModel(false);
    setDataPoints(null);
    
    try {
      // Add past days prediction parameter
      const predictPastDays = predictionTab === 'past' ? settings.daysToPredict : 0;
      
      const result = await analyzeStock(
        stockData,
        settings.sequenceLength,
        settings.epochs,
        settings.batchSize,
        settings.daysToPredict,
        (progressData) => {
          // Set default progress
          setProgress(progressData.percent || 0);
          
          if (progressData.stage === 'data') {
            setDataPoints(progressData.dataPoints);
            setProgressText(`Using ${progressData.dataPoints} data points for analysis...`);
          } else if (progressData.stage === 'loading') {
            setUsingSavedModel(true);
            setProgressText(`${progressData.message || 'Loading saved model'}...`);
            
            if (progressData.modelInfo) {
              setTrainingStats({
                ...trainingStats,
                ...progressData.modelInfo
              });
            }
          } else if (progressData.stage === 'training') {
            setProgressText(`Training model: ${progressData.epoch || 0}/${progressData.totalEpochs || settings.epochs} epochs`);
            
            setTrainingStats({
              currentEpoch: progressData.epoch,
              totalEpochs: progressData.totalEpochs || settings.epochs,
              loss: progressData.loss,
              val_loss: progressData.val_loss
            });
          } else if (progressData.stage === 'saved' && progressData.history) {
            setTrainingStats({
              ...trainingStats,
              history: progressData.history,
              ...progressData.modelInfo
            });
            setProgressText(`${progressData.message || 'Model saved'}...`);
            
            if (progressData.modelId) {
              setModelId(progressData.modelId);
            }
          } else {
            setProgressText(`${progressData.message || progressData.stage || 'Processing'}...`);
          }
          
          if (progressData.dataPoints) {
            setDataPoints(progressData.dataPoints);
          }
          
          if (progressData.modelId) {
            setModelId(progressData.modelId);
          }
        },
        newAbortController.signal,
        undefined, // No special model ID
        predictPastDays // Pass the past days prediction parameter
      );
      
      setModelData(result.modelData);
      onPredictionComplete(result.predictions);
      
      if (result.modelData.isExistingModel) {
        toast.success(`${predictionTab === 'past' ? 'Past' : 'Future'} prediction completed using saved model`);
      } else {
        toast.success(`${predictionTab === 'past' ? 'Past' : 'Future'} prediction completed and model saved for future use`);
        // Update the saved models list
        fetchSavedModels();
      }
      
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

  // Filter saved models to show only models for the current stock
  const stockSpecificModels = savedModels.filter(model => 
    model.modelId.startsWith(stockData.symbol)
  );

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-xl flex items-center gap-2">
              <BrainCircuit className="h-5 w-5 text-primary" />
              ML Prediction
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
        {!isLoading && (
          <Tabs 
            value={predictionTab} 
            onValueChange={(v) => setPredictionTab(v as 'future' | 'past')} 
            className="mb-4"
          >
            <TabsList className="w-full">
              <TabsTrigger value="future" className="flex-1">Future Prediction</TabsTrigger>
              <TabsTrigger value="past" className="flex-1">Past Validation</TabsTrigger>
            </TabsList>
            <TabsContent value="future">
              <div className="text-sm">
                Predict future stock prices based on historical data
              </div>
            </TabsContent>
            <TabsContent value="past">
              <div className="space-y-4">
                <div className="text-sm">
                  Predict past {settings.daysToPredict} days to validate model accuracy
                </div>
                
                {stockSpecificModels.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="model-select">Select model for validation:</Label>
                    <Select
                      value={selectedModelId}
                      onValueChange={setSelectedModelId}
                    >
                      <SelectTrigger id="model-select" className="w-full">
                        <SelectValue placeholder="Select a model" />
                      </SelectTrigger>
                      <SelectContent>
                        {stockSpecificModels.map(model => (
                          <SelectItem key={model.modelId} value={model.modelId}>
                            {model.modelId.split('_').slice(1).join('_')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}
        
        {isLoading ? (
          <>
            <Progress value={progress} className="w-full h-2" />
            <p className="text-sm text-muted-foreground mt-2">{progressText}</p>
            
            {dataPoints && (
              <p className="text-xs text-muted-foreground mt-1">
                Using {dataPoints} data points for analysis
              </p>
            )}
            
            {usingSavedModel ? (
              <p className="text-xs text-muted-foreground mt-2">
                Using previously trained model. This will be much faster!
              </p>
            ) : trainingStats && (
              <div className="mt-3 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span>Training progress:</span>
                  <span className="font-medium">
                    {trainingStats.currentEpoch || 0}/{trainingStats.totalEpochs || settings.epochs} epochs
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Training loss:</span>
                  <span className="font-medium">{trainingStats.loss?.toFixed(6) || 'N/A'}</span>
                </div>
                {trainingStats.val_loss && (
                  <div className="flex justify-between">
                    <span>Validation loss:</span>
                    <span className="font-medium">{trainingStats.val_loss?.toFixed(6) || 'N/A'}</span>
                  </div>
                )}
              </div>
            )}
            
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
            {modelData.isExistingModel ? (
              <div className="text-sm text-muted-foreground mb-3 bg-muted/50 p-2 rounded">
                Used saved model from previous training {modelData.modelId && `(${modelData.modelId})`}
              </div>
            ) : (
              <>
                {trainingStats?.history && (
                  <div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Final training loss:</span>
                      <span className="font-medium">
                        {trainingStats.history.loss[trainingStats.history.loss.length - 1]?.toFixed(6) || 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Final validation loss:</span>
                      <span className="font-medium">
                        {trainingStats.history.val_loss[trainingStats.history.val_loss.length - 1]?.toFixed(6) || 'N/A'}
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}
            
            <div className="mt-4 text-sm font-medium">Model Parameters:</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Data Points:</span>
                <span className="font-medium">{modelData.dataPoints || 'Unknown'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Sequence Length:</span>
                <span className="font-medium">{settings.sequenceLength}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Output Days:</span>
                <span className="font-medium">{modelData.params?.outputSize || settings.daysToPredict}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Epochs:</span>
                <span className="font-medium">{modelData.params?.totalEpochs || modelData.params?.epochs || settings.epochs}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Batch Size:</span>
                <span className="font-medium">{modelData.params?.batchSize || settings.batchSize}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Window Size:</span>
                <span className="font-medium">{modelData.params?.inputSize || 'Unknown'}</span>
              </div>
            </div>
            
            {modelId && (
              <div className="text-xs text-muted-foreground mt-2 pt-2 border-t">
                Model ID: {modelId}
              </div>
            )}
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
          <div className="space-y-4">
            {modelExists && predictionTab === 'future' && (
              <div className="bg-muted/50 p-3 rounded-md flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">This model configuration already exists</p>
                  <p className="text-xs text-muted-foreground">
                    You can use the existing trained model or train a new one
                  </p>
                </div>
              </div>
            )}
            
            <div className="text-sm font-medium">Current Parameters:</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Data Points:</span>
                <span className="font-medium">{stockData?.timeSeries?.length || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Sequence Length:</span>
                <span className="font-medium">{settings.sequenceLength}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Prediction Days:</span>
                <span className="font-medium">{settings.daysToPredict}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Epochs:</span>
                <span className="font-medium">{settings.epochs}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Batch Size:</span>
                <span className="font-medium">{settings.batchSize}</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Settings className="h-3 w-3" />
              <span>Click the gear icon in the top-right to adjust parameters</span>
            </div>
            
            {modelId && predictionTab === 'future' && (
              <div className="text-xs text-muted-foreground border-t pt-2 mt-2">
                Model ID: {modelId}
              </div>
            )}
            
            {predictionTab === 'past' && selectedModelId && (
              <div className="text-xs text-muted-foreground border-t pt-2 mt-2">
                Selected Model: {selectedModelId}
              </div>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter>
        {!isLoading && modelExists && predictionTab === 'future' ? (
          <div className="grid grid-cols-2 gap-2 w-full">
            <Button
              variant="outline"
              onClick={() => handleLoadExistingModel()}
              disabled={isLoading || !!serverError}
            >
              Use Existing Model
            </Button>
            <Button
              onClick={() => handleRunPrediction(true)}
              disabled={isLoading || !!serverError}
            >
              Train New Model
            </Button>
          </div>
        ) : (
          <Button 
            onClick={() => handleRunPrediction()}
            className="w-full"
            disabled={isLoading || !!serverError || (predictionTab === 'past' && !selectedModelId && stockSpecificModels.length > 0)}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : modelData ? (
              <>
                {predictionTab === 'past' ? (
                  <>
                    <History className="mr-2 h-4 w-4" />
                    Validate Past Data
                  </>
                ) : (
                  <>
                    <LineChart className="mr-2 h-4 w-4" />
                    Train New Model
                  </>
                )}
              </>
            ) : (
              <>
                {predictionTab === 'past' ? (
                  <>
                    <History className="mr-2 h-4 w-4" />
                    Validate Past {settings.daysToPredict} Days
                  </>
                ) : (
                  <>
                    <LineChart className="mr-2 h-4 w-4" />
                    Train & Predict
                  </>
                )}
              </>
            )}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
};

export default PredictionButton;
