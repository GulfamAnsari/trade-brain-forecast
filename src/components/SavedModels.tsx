
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { StockData, PredictionResult } from "@/types/stock";
import { toast } from "sonner";
import { Activity, Database, LineChart, CalendarClock, Loader2, Info } from "lucide-react";
import { Skeleton } from "./ui/skeleton";
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel
} from "./ui/alert-dialog";

interface SavedModelsProps {
  stockData: StockData;
  onModelSelect: (modelId: string, predictions: PredictionResult[]) => void;
  className?: string;
}

interface SavedModel {
  modelId: string;
  inputSize: number;
  outputSize: number;
  epochs: number;
  batchSize: number;
  totalEpochs: number;
  trainingTime?: string;
  created?: string;
  dataPoints?: number;
  minPrice?: number;
  range?: number;
}

const SavedModels = ({ stockData, onModelSelect, className }: SavedModelsProps) => {
  const [isLoading, setIsLoading] = useState(true);
  const [models, setModels] = useState<SavedModel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [predicting, setPredicting] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<SavedModel | null>(null);
  const [infoDialogOpen, setInfoDialogOpen] = useState(false);

  useEffect(() => {
    fetchSavedModels();
  }, []);

  const fetchSavedModels = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await fetch('http://localhost:5000/api/models');
      if (!response.ok) {
        throw new Error('Failed to fetch models');
      }
      
      const data = await response.json();
      
      // Filter models for current stock
      const stockModels = data.models.filter((model: SavedModel) => 
        model.modelId.startsWith(`${stockData.symbol}_`)
      );
      
      setModels(stockModels);
    } catch (error) {
      console.error('Error fetching models:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePredict = async (modelId: string) => {
    try {
      setPredicting(modelId);
      
      const response = await fetch(`http://localhost:5000/api/models/${modelId}/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ stockData }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to make prediction');
      }
      
      const result = await response.json();
      onModelSelect(modelId, result.predictions);
      toast.success('Prediction completed successfully');
    } catch (error) {
      console.error('Error making prediction:', error);
      toast.error(error instanceof Error ? error.message : 'Error making prediction');
    } finally {
      setPredicting(null);
    }
  };

  const showModelInfo = (model: SavedModel) => {
    setSelectedModel(model);
    setInfoDialogOpen(true);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Unknown';
    
    try {
      const date = new Date(dateString);
      return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(date);
    } catch (e) {
      return 'Invalid date';
    }
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Saved Models</CardTitle>
          <CardDescription>Loading saved models...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Saved Models</CardTitle>
          <CardDescription className="text-destructive">Error loading models</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button 
            variant="outline" 
            size="sm" 
            className="mt-4" 
            onClick={fetchSavedModels}
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (models.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Saved Models</CardTitle>
          <CardDescription>No saved models found for this stock</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Train a model first to see it listed here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            Saved Models
          </CardTitle>
          <CardDescription>
            Previously trained models for {stockData.name}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {models.map((model) => (
              <Card key={model.modelId} className="overflow-hidden">
                <CardHeader className="p-4 pb-0">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-base">{model.outputSize} Day Forecast</CardTitle>
                      <CardDescription>
                        Trained on {model.dataPoints || model.inputSize} days of data
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => showModelInfo(model)}
                        className="h-7 w-7"
                      >
                        <Info className="h-4 w-4" />
                      </Button>
                      <Badge variant="outline" className="text-xs">
                        {model.epochs} epochs
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-2">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div className="flex items-center gap-1">
                      <Activity className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">Batch Size:</span>
                      <span className="ml-auto font-medium">{model.batchSize}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Activity className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">Input Size:</span>
                      <span className="ml-auto font-medium">{model.inputSize}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <CalendarClock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">Created:</span>
                      <span className="ml-auto font-medium">{formatDate(model.created || model.trainingTime)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <CalendarClock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">Total Epochs:</span>
                      <span className="ml-auto font-medium">{model.totalEpochs || model.epochs}</span>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="p-4 pt-0">
                  <Button 
                    className="w-full" 
                    size="sm"
                    disabled={predicting === model.modelId}
                    onClick={() => handlePredict(model.modelId)}
                  >
                    {predicting === model.modelId ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Predicting...
                      </>
                    ) : (
                      <>
                        <LineChart className="mr-2 h-4 w-4" />
                        Use Model for Prediction
                      </>
                    )}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </CardContent>
        <CardFooter>
          <Button variant="outline" className="w-full" onClick={fetchSavedModels}>
            Refresh Models
          </Button>
        </CardFooter>
      </Card>

      <AlertDialog open={infoDialogOpen} onOpenChange={setInfoDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Model Details: {selectedModel?.outputSize} Day Forecast
            </AlertDialogTitle>
            <AlertDialogDescription>
              Detailed information about this model.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          {selectedModel && (
            <div className="py-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="space-y-2">
                  <h4 className="font-medium text-sm">Training Parameters</h4>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Input Size:</span>
                      <span>{selectedModel.inputSize}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Output Size:</span>
                      <span>{selectedModel.outputSize} days</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Epochs:</span>
                      <span>{selectedModel.epochs}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Epochs:</span>
                      <span>{selectedModel.totalEpochs || selectedModel.epochs}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Batch Size:</span>
                      <span>{selectedModel.batchSize}</span>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <h4 className="font-medium text-sm">Data Information</h4>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Data Points:</span>
                      <span>{selectedModel.dataPoints || 'Unknown'}</span>
                    </div>
                    {selectedModel.minPrice !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Min Price:</span>
                        <span>₹{selectedModel.minPrice.toFixed(2)}</span>
                      </div>
                    )}
                    {selectedModel.range !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Price Range:</span>
                        <span>₹{selectedModel.range.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Model ID:</span>
                      <span className="truncate max-w-[150px]">{selectedModel.modelId}</span>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="mt-4 space-y-2">
                <h4 className="font-medium text-sm">Training Timeline</h4>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Training Date:</span>
                    <span>{formatDate(selectedModel.created || selectedModel.trainingTime)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">
                    <p>This model was trained on data up to {formatDate(stockData.lastUpdated)}.</p>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default SavedModels;
