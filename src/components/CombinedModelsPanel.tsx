
import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardFooter, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { StockData, PredictionResult } from "@/types/stock";
import { Wand2, Loader2, BarChart3, Calculator } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { combinePredictions } from "@/utils/ml";
import { toast } from "sonner";
import { Checkbox } from "./ui/checkbox";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import { Alert, AlertDescription } from "./ui/alert";
import { SERVER_URL } from "@/config";

interface CombinedModelsPanelProps {
  stockData: StockData;
  savedModels: any[];
  onPredictionComplete: (predictions: PredictionResult[]) => void;
}

type CombineMethod = 'average' | 'weighted' | 'stacking' | 'bayesian';

const methodDescriptions = {
  average: "Simple average of all model predictions",
  weighted: "Weighted average based on model training parameters",
  stacking: "Meta-model that learns from other models' predictions",
  bayesian: "Probabilistic combination giving more weight to confident models"
};

const CombinedModelsPanel = ({ stockData, savedModels, onPredictionComplete }: CombinedModelsPanelProps) => {
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [combineMethod, setCombineMethod] = useState<CombineMethod>('average');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Automatically select all models when the component mounts or when savedModels changes
  useEffect(() => {
    if (savedModels.length > 0) {
      setSelectedModels(savedModels.map(model => model.modelId));
    }
  }, [savedModels]);
  
  const handleToggleModel = (modelId: string) => {
    setSelectedModels(prev => {
      if (prev.includes(modelId)) {
        return prev.filter(id => id !== modelId);
      } else {
        return [...prev, modelId];
      }
    });
  };
  
  const handleCombineModels = async () => {
    if (selectedModels.length < 2) {
      toast.error("Please select at least 2 models to combine");
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Create a clean copy of the stock data to avoid circular references
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
      
      console.log(`Combining ${selectedModels.length} models using ${combineMethod} method`);
      
      const response = await fetch(`${SERVER_URL}/api/combine-models`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          stockData: cleanStockData,
          modelIds: selectedModels,
          method: combineMethod
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to combine models");
      }
      
      const result = await response.json();
      
      console.log(`Combined models result:`, result);
      
      if (!result.predictions || result.predictions.length === 0) {
        throw new Error("No predictions returned from combined models");
      }
      
      onPredictionComplete(result.predictions);
      
      toast.success(
        `Combined ${result.usedModels.length} models using ${result.method} method`
      );
      
      if (result.modelErrors && result.modelErrors.length > 0) {
        toast.warning(
          `Some models had errors: ${result.modelErrors.length} of ${selectedModels.length}`
        );
      }
    } catch (error) {
      console.error("Error combining models:", error);
      setError(error instanceof Error ? error.message : "Failed to combine models");
      toast.error("Failed to combine models");
    } finally {
      setIsLoading(false);
    }
  };
  
  const getModelDetails = (modelId: string) => {
    const model = savedModels.find(m => m.modelId === modelId);
    if (!model) return null;
    
    return {
      epochs: model.totalEpochs || model.epochs || 0,
      sequenceLength: model.inputSize || 0,
      dataPoints: model.dataPoints || 0,
      outputSize: model.outputSize || 0
    };
  };
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-primary" />
          Combined Models Prediction
        </CardTitle>
        <CardDescription>
          Combine multiple models for improved prediction accuracy
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-medium">Combination Method</h3>
            <Badge variant="outline" className="font-normal">
              {selectedModels.length} models selected
            </Badge>
          </div>
          
          <Select 
            value={combineMethod} 
            onValueChange={(value) => setCombineMethod(value as CombineMethod)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select method" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="average">Simple Average</SelectItem>
              <SelectItem value="weighted">Weighted Fusion</SelectItem>
              <SelectItem value="stacking">Stacking</SelectItem>
              <SelectItem value="bayesian">Bayesian Method</SelectItem>
            </SelectContent>
          </Select>
          
          <p className="text-xs text-muted-foreground">
            {methodDescriptions[combineMethod]}
          </p>
        </div>
        
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Available Models</h3>
          
          {savedModels.length === 0 ? (
            <div className="text-sm text-muted-foreground py-2">
              No saved models available. Train some models first.
            </div>
          ) : (
            <ScrollArea className="h-[180px] pr-4">
              <div className="space-y-2">
                {savedModels.map((model) => (
                  <div 
                    key={model.modelId}
                    className="flex items-start space-x-2 border p-2 rounded-md"
                  >
                    <Checkbox 
                      id={`model-${model.modelId}`}
                      checked={selectedModels.includes(model.modelId)}
                      onCheckedChange={() => handleToggleModel(model.modelId)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <label
                        htmlFor={`model-${model.modelId}`}
                        className="text-sm font-medium cursor-pointer"
                      >
                        {model.modelId.split('_')[0]} 
                      </label>
                      <div className="text-xs text-muted-foreground truncate">
                        {model.modelId}
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-1 text-xs">
                        <div>Epochs: {model.totalEpochs || model.epochs || 0}</div>
                        <div>Window: {model.inputSize || 0}</div>
                        <div>Data: {model.dataPoints || 0} points</div>
                        <div>Pred: {model.outputSize || 0} days</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
        
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      
      <CardFooter>
        <Button 
          onClick={handleCombineModels} 
          className="w-full" 
          disabled={isLoading || selectedModels.length < 2 || savedModels.length < 2}
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Combining Models...
            </>
          ) : (
            <>
              <Calculator className="mr-2 h-4 w-4" />
              Combine Models
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default CombinedModelsPanel;
