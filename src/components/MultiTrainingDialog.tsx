
import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { StockData, PredictionResult } from "@/types/stock";
import { BrainCircuit, Plus, Minus, Loader2, RefreshCw } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { analyzeStock } from "@/utils/ml";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";

interface MultiTrainingDialogProps {
  stockData: StockData;
  onPredictionComplete: (predictions: PredictionResult[]) => void;
}

interface ModelConfig {
  id: string;
  sequenceLength: number;
  epochs: number;
  batchSize: number;
  daysToPredict: number;
  status: "pending" | "training" | "complete" | "error";
  progress: number;
  message: string;
  abortController?: AbortController;
}

const defaultModelConfig: Omit<ModelConfig, "id" | "status" | "progress" | "message"> = {
  sequenceLength: 360,
  epochs: 100,
  batchSize: 32,
  daysToPredict: 30,
};

const MultiTrainingDialog = ({ stockData, onPredictionComplete }: MultiTrainingDialogProps) => {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelConfig[]>([
    { 
      ...defaultModelConfig, 
      id: "model-1", 
      status: "pending", 
      progress: 0, 
      message: "Waiting to start..." 
    }
  ]);
  const [currentlyTraining, setCurrentlyTraining] = useState<string[]>([]);
  const [trainingComplete, setTrainingComplete] = useState(false);
  const [lastCompletedModelPredictions, setLastCompletedModelPredictions] = useState<PredictionResult[] | null>(null);
  const [activeTab, setActiveTab] = useState("configure");
  
  // Auto-switch to status tab when training starts
  useEffect(() => {
    if (currentlyTraining.length > 0) {
      setActiveTab("status");
    }
  }, [currentlyTraining.length]);
  
  const handleAddModel = () => {
    setModels([
      ...models,
      {
        ...defaultModelConfig,
        id: `model-${models.length + 1}`,
        status: "pending",
        progress: 0,
        message: "Waiting to start..."
      }
    ]);
  };

  const handleRemoveModel = (id: string) => {
    if (models.length > 1) {
      const modelToRemove = models.find(m => m.id === id);
      if (modelToRemove?.abortController) {
        modelToRemove.abortController.abort();
      }
      
      setModels(models.filter(model => model.id !== id));
      setCurrentlyTraining(currentlyTraining.filter(modelId => modelId !== id));
    }
  };

  const updateModelConfig = (id: string, updates: Partial<ModelConfig>) => {
    setModels(prevModels => prevModels.map(model => 
      model.id === id ? { ...model, ...updates } : model
    ));
  };

  const handleTrainAll = async () => {
    setTrainingComplete(false);
    setLastCompletedModelPredictions(null);
    
    // Clone the models array to avoid mutating state directly
    const modelQueue = [...models];
    
    // Reset all models to pending state
    setModels(prevModels => prevModels.map(model => ({
      ...model,
      status: "pending",
      progress: 0,
      message: "Waiting to start..."
    })));
    
    // Start training all models in parallel with a small delay between each
    const startTrainingWithDelay = async () => {
      const trainingPromises = [];
      
      for (let i = 0; i < modelQueue.length; i++) {
        const model = modelQueue[i];
        // Add to currently training state
        setCurrentlyTraining(prev => [...prev, model.id]);
        
        // Start training the model and add the promise to the array
        const trainingPromise = trainModel(model.id);
        trainingPromises.push(trainingPromise);
        
        // Add a slight delay between starting each model to avoid overwhelming the server
        if (i < modelQueue.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      // Wait for all models to finish training
      return Promise.all(trainingPromises);
    };
    
    try {
      await startTrainingWithDelay();
      
      setCurrentlyTraining([]);
      setTrainingComplete(true);
      
      // If we have predictions from the last completed model, pass them up
      if (lastCompletedModelPredictions) {
        onPredictionComplete(lastCompletedModelPredictions);
      }
      
      toast.success("All model training complete!");
    } catch (error) {
      console.error("Training error:", error);
      toast.error("Some models failed to train. Check the status tab for details.");
    }
  };

  const trainModel = async (modelId: string): Promise<void> => {
    const model = models.find(m => m.id === modelId);
    if (!model) return;
    
    try {
      updateModelConfig(model.id, { 
        status: "training", 
        progress: 5,
        message: "Starting training..." 
      });
      
      const abortController = new AbortController();
      updateModelConfig(model.id, { abortController });
      
      // Generate a unique server-side model ID using the model.id
      const serverModelId = `${stockData.symbol}_${model.id}_${Date.now()}`;
      
      const result = await analyzeStock(
        stockData,
        model.sequenceLength,
        model.epochs,
        model.batchSize,
        model.daysToPredict,
        (progressData) => {
          // Only update this specific model's progress
          // Check if the received message is for this model
          if (progressData) {
            const newProgress = progressData.percent || 0;
            const message = progressData.message || progressData.stage || "Processing...";
            
            // Use the modelId to update only that specific model
            updateModelConfig(model.id, { 
              progress: newProgress,
              message: message
            });
          }
        },
        abortController.signal,
        serverModelId // Pass the model ID for server to track which model is being trained
      );
      
      updateModelConfig(model.id, { 
        status: "complete", 
        progress: 100,
        message: "Training complete"
      });
      
      // Save the most recently completed model's predictions
      setLastCompletedModelPredictions(result.predictions);
      
      // Remove from currently training list
      setCurrentlyTraining(prev => prev.filter(id => id !== model.id));
      
    } catch (error) {
      console.error(`Training error for model ${model.id}:`, error);
      
      if (error instanceof Error && error.name === "AbortError") {
        updateModelConfig(model.id, { 
          status: "pending", 
          progress: 0,
          message: "Training cancelled" 
        });
      } else {
        updateModelConfig(model.id, { 
          status: "error", 
          progress: 0,
          message: error instanceof Error ? error.message : "Training failed" 
        });
      }
      
      // Remove from currently training list
      setCurrentlyTraining(prev => prev.filter(id => id !== model.id));
    }
  };

  const handleRetryModel = async (modelId: string) => {
    const model = models.find(m => m.id === modelId);
    if (!model || model.status !== "error") return;
    
    // Reset the model's status
    updateModelConfig(modelId, {
      status: "pending",
      progress: 0,
      message: "Waiting to restart..."
    });
    
    // Add to currently training state
    setCurrentlyTraining(prev => [...prev, modelId]);
    
    // Start training the model
    await trainModel(modelId);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-1">
          <BrainCircuit className="h-4 w-4 mr-1" />
          Train Multiple Models
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Train Multiple Models</DialogTitle>
          <DialogDescription>
            Configure and train multiple models simultaneously for {stockData?.symbol}.
          </DialogDescription>
        </DialogHeader>
        
        <Tabs defaultValue="configure" value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid grid-cols-2 mb-4">
            <TabsTrigger value="configure">Configure Models</TabsTrigger>
            <TabsTrigger value="status">Training Status</TabsTrigger>
          </TabsList>
          
          <TabsContent value="configure" className="space-y-4">
            {models.map((model, index) => (
              <Card key={model.id} className="p-4 pt-2">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-sm font-medium">Model {index + 1}</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => handleRemoveModel(model.id)}
                    disabled={models.length <= 1 || currentlyTraining.includes(model.id)}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <FormLabel htmlFor={`${model.id}-sequence`}>Sequence Length (days)</FormLabel>
                    <Input
                      id={`${model.id}-sequence`}
                      type="number"
                      value={model.sequenceLength}
                      onChange={(e) => updateModelConfig(model.id, { sequenceLength: parseInt(e.target.value) || 0 })}
                      disabled={currentlyTraining.includes(model.id)}
                      min={1}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <FormLabel htmlFor={`${model.id}-days`}>Days to Predict</FormLabel>
                    <Input
                      id={`${model.id}-days`}
                      type="number"
                      value={model.daysToPredict}
                      onChange={(e) => updateModelConfig(model.id, { daysToPredict: parseInt(e.target.value) || 0 })}
                      min={1}
                      max={365}
                      disabled={currentlyTraining.includes(model.id)}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <FormLabel htmlFor={`${model.id}-epochs`}>Epochs</FormLabel>
                    <Input
                      id={`${model.id}-epochs`}
                      type="number"
                      value={model.epochs}
                      onChange={(e) => updateModelConfig(model.id, { epochs: parseInt(e.target.value) || 0 })}
                      min={1}
                      disabled={currentlyTraining.includes(model.id)}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <FormLabel htmlFor={`${model.id}-batch`}>Batch Size</FormLabel>
                    <Input
                      id={`${model.id}-batch`}
                      type="number"
                      value={model.batchSize}
                      onChange={(e) => updateModelConfig(model.id, { batchSize: parseInt(e.target.value) || 0 })}
                      min={1}
                      disabled={currentlyTraining.includes(model.id)}
                    />
                  </div>
                </div>
                
                {model.status === "error" && (
                  <div className="mt-2 text-sm text-destructive">
                    {model.message}
                  </div>
                )}
              </Card>
            ))}
            
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={handleAddModel}
                disabled={currentlyTraining.length > 0}
              >
                <Plus className="h-4 w-4" />
                Add Model
              </Button>
            </div>
          </TabsContent>
          
          <TabsContent value="status">
            <div className="space-y-4">
              {models.map((model, index) => (
                <Card key={model.id} className="overflow-hidden">
                  <CardHeader className="p-4 pb-2">
                    <div className="flex justify-between items-center">
                      <CardTitle className="text-base">Model {index + 1}</CardTitle>
                      <Badge variant={
                        model.status === "complete" ? "default" :
                        model.status === "training" ? "secondary" :
                        model.status === "error" ? "destructive" : "outline"
                      }>
                        {model.status === "pending" ? "Waiting" :
                         model.status === "training" ? "Training" :
                         model.status === "complete" ? "Complete" : "Error"}
                      </Badge>
                    </div>
                    <CardDescription>
                      {model.daysToPredict} days forecast, {model.epochs} epochs
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span>Progress:</span>
                        <span>{model.progress}%</span>
                      </div>
                      <Progress value={model.progress} className="h-2" />
                      <p className="text-xs text-muted-foreground">{model.message}</p>
                      
                      {model.status === "error" && (
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="mt-2 w-full"
                          onClick={() => handleRetryModel(model.id)}
                          disabled={currentlyTraining.includes(model.id)}
                        >
                          {currentlyTraining.includes(model.id) ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Retrying...
                            </>
                          ) : (
                            <>
                              <RefreshCw className="mr-2 h-4 w-4" />
                              Retry Training
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
        
        <DialogFooter>
          {currentlyTraining.length > 0 ? (
            <Button disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Training in progress... ({currentlyTraining.length} models)
            </Button>
          ) : trainingComplete ? (
            <Button onClick={() => setOpen(false)}>
              Close
            </Button>
          ) : (
            <Button onClick={handleTrainAll}>
              <BrainCircuit className="mr-2 h-4 w-4" />
              Start Training
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MultiTrainingDialog;
