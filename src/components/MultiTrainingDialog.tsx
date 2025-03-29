
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
import { BrainCircuit, Plus, Minus, Loader2, RefreshCw, X, Sparkles, Zap } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { 
  analyzeStock, 
  addWebSocketHandler, 
  getActiveTrainingModels, 
  isModelTraining,
  cancelTraining,
  generateModelId,
  startComboTraining
} from "@/utils/ml";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "./ui/card";
import { Badge } from "./ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "./ui/checkbox";
import { Alert, AlertDescription } from "./ui/alert";
import { ScrollArea } from "./ui/scroll-area";

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
  status: "pending" | "training" | "complete" | "error" | "cancelled";
  progress: number;
  message: string;
  abortController?: AbortController;
}

interface ComboConfig {
  sequenceLengths: string[];
  epochs: number[];
  batchSizes: number[];
  daysToPredict: number;
  selectedSequenceLengths: string[];
  selectedEpochs: number[];
  selectedBatchSizes: number[];
}

const defaultModelConfig: Omit<ModelConfig, "id" | "status" | "progress" | "message"> = {
  sequenceLength: 360,
  epochs: 100,
  batchSize: 32,
  daysToPredict: 30,
};

const defaultComboConfig: ComboConfig = {
  sequenceLengths: ["360", "720", "1800", "Full data"],
  epochs: [1000, 2000, 5000, 10000],
  batchSizes: [2, 4, 8, 16, 32, 64],
  daysToPredict: 30,
  selectedSequenceLengths: ["360", "720"],
  selectedEpochs: [1000, 2000],
  selectedBatchSizes: [16, 32],
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
  const [comboConfig, setComboConfig] = useState<ComboConfig>(defaultComboConfig);
  const [comboJobs, setComboJobs] = useState<any[]>([]);
  const [comboTrainingActive, setComboTrainingActive] = useState(false);
  
  // Listen for global WebSocket messages about training status
  useEffect(() => {
    const removeHandler = addWebSocketHandler((message) => {
      // Handle combo training started event
      if (message.type === 'comboTrainingStarted') {
        setComboJobs(message.data.jobs);
        setComboTrainingActive(true);
        
        toast.info(`Started combo training with ${message.data.totalJobs} configurations`);
        setActiveTab("comboStatus");
      }
      
      // Handle status updates for models
      if (message.type === 'status' && message.modelId) {
        const modelId = message.modelId;
        
        // Check if this is a combo training job
        const isComboJob = comboJobs.some(job => job.modelId === modelId);
        
        if (isComboJob) {
          // Update combo job status
          setComboJobs(prevJobs => {
            return prevJobs.map(job => {
              if (job.modelId === modelId) {
                return {
                  ...job,
                  status: message.data.stage === 'error' ? 'error' : 
                          message.data.stage === 'complete' ? 'complete' :
                          message.data.stage === 'cancelled' ? 'cancelled' : 'training',
                  progress: message.data.percent || 0,
                  message: message.data.message || '',
                  error: message.data.error,
                  totalJobs: message.data.totalJobs,
                  jobIndex: message.data.jobIndex
                };
              }
              return job;
            });
          });
          
          // Check if all combo jobs are done
          if (message.data.stage === 'complete' || message.data.stage === 'error' || message.data.stage === 'cancelled') {
            setTimeout(() => {
              setComboJobs(prevJobs => {
                const allDone = prevJobs.every(job => 
                  job.status === 'complete' || job.status === 'error' || job.status === 'cancelled');
                
                if (allDone) {
                  setComboTrainingActive(false);
                  toast.success("All combo training jobs completed");
                }
                
                return prevJobs;
              });
            }, 1000);
          }
        }
        
        // Check if this is one of our regular models
        const modelIndex = models.findIndex(m => generateModelId(
          stockData,
          m.sequenceLength,
          m.epochs,
          m.batchSize,
          m.daysToPredict
        ) === modelId);
        
        if (modelIndex >= 0) {
          // Update model status
          setModels(prevModels => {
            const updatedModels = [...prevModels];
            updatedModels[modelIndex] = {
              ...updatedModels[modelIndex],
              status: message.data.stage === 'error' ? 'error' : 
                      message.data.stage === 'complete' ? 'complete' :
                      message.data.stage === 'cancelled' ? 'cancelled' : 'training',
              progress: message.data.percent || 0,
              message: message.data.message || ''
            };
            return updatedModels;
          });
          
          // Update currently training list
          if (message.data.stage === 'complete' || message.data.stage === 'error' || message.data.stage === 'cancelled') {
            setCurrentlyTraining(prev => prev.filter(id => id !== modelId));
          }
        }
      }
      
      // Handle progress updates for models
      if (message.type === 'progress' && message.modelId) {
        const modelId = message.modelId;
        
        // Check if this is a combo training job
        const isComboJob = comboJobs.some(job => job.modelId === modelId);
        
        if (isComboJob) {
          // Update combo job progress
          setComboJobs(prevJobs => {
            return prevJobs.map(job => {
              if (job.modelId === modelId) {
                return {
                  ...job,
                  progress: message.data.percent || 0,
                  message: message.data.message || ''
                };
              }
              return job;
            });
          });
        }
        
        // Check if this is one of our regular models
        const modelIndex = models.findIndex(m => generateModelId(
          stockData,
          m.sequenceLength,
          m.epochs,
          m.batchSize,
          m.daysToPredict
        ) === modelId);
        
        if (modelIndex >= 0) {
          // Update model progress
          setModels(prevModels => {
            const updatedModels = [...prevModels];
            updatedModels[modelIndex] = {
              ...updatedModels[modelIndex],
              progress: message.data.percent || 0,
              message: message.data.message || ''
            };
            return updatedModels;
          });
        }
      }
    }, 'global');
    
    return () => {
      removeHandler();
    };
  }, [models, comboJobs, stockData]);
  
  // Auto-switch to status tab when training starts
  useEffect(() => {
    if (currentlyTraining.length > 0) {
      setActiveTab("status");
    }
  }, [currentlyTraining.length]);
  
  // Check for active training models on component mount
  useEffect(() => {
    const activeModels = getActiveTrainingModels();
    
    if (activeModels.length > 0) {
      // Check if any of our models are currently training
      models.forEach((model, index) => {
        const modelId = generateModelId(
          stockData,
          model.sequenceLength,
          model.epochs,
          model.batchSize,
          model.daysToPredict
        );
        
        if (activeModels.includes(modelId)) {
          // Update model status
          setModels(prevModels => {
            const updatedModels = [...prevModels];
            updatedModels[index] = {
              ...updatedModels[index],
              status: 'training',
              progress: 0,
              message: 'Training in progress...'
            };
            return updatedModels;
          });
          
          // Add to currently training list
          setCurrentlyTraining(prev => [...prev, modelId]);
        }
      });
    }
  }, []);
  
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
      if (modelToRemove) {
        const modelId = generateModelId(
          stockData,
          modelToRemove.sequenceLength,
          modelToRemove.epochs,
          modelToRemove.batchSize,
          modelToRemove.daysToPredict
        );
        
        // Check if the model is training
        if (isModelTraining(modelId)) {
          // Cancel the training
          cancelTraining(modelId);
        }
        
        // Remove from currently training list
        setCurrentlyTraining(prev => prev.filter(id => id !== modelId));
      }
      
      setModels(models.filter(model => model.id !== id));
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
    
    // Start training all models
    const trainPromises = modelQueue.map(model => {
      const modelId = generateModelId(
        stockData,
        model.sequenceLength,
        model.epochs,
        model.batchSize,
        model.daysToPredict
      );
      
      // Add to currently training state
      setCurrentlyTraining(prev => [...prev, modelId]);
      
      // Start training the model
      return trainModel(model.id);
    });
    
    try {
      await Promise.all(trainPromises);
      
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
      
      // Generate a unique server-side model ID using the model settings
      const serverModelId = generateModelId(
        stockData,
        model.sequenceLength,
        model.epochs,
        model.batchSize,
        model.daysToPredict
      );
      
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
      setCurrentlyTraining(prev => prev.filter(id => id !== serverModelId));
      
    } catch (error) {
      console.error(`Training error for model ${model.id}:`, error);
      
      if (error instanceof Error && error.name === "AbortError") {
        updateModelConfig(model.id, { 
          status: "cancelled", 
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
      const serverModelId = generateModelId(
        stockData,
        model.sequenceLength,
        model.epochs,
        model.batchSize,
        model.daysToPredict
      );
      setCurrentlyTraining(prev => prev.filter(id => id !== serverModelId));
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
    
    // Generate server model ID
    const serverModelId = generateModelId(
      stockData,
      model.sequenceLength,
      model.epochs,
      model.batchSize,
      model.daysToPredict
    );
    
    // Add to currently training state
    setCurrentlyTraining(prev => [...prev, serverModelId]);
    
    // Start training the model
    await trainModel(modelId);
  };

  const handleCancelModel = (modelId: string) => {
    const model = models.find(m => m.id === modelId);
    if (!model || model.status !== "training") return;
    
    // Generate server model ID
    const serverModelId = generateModelId(
      stockData,
      model.sequenceLength,
      model.epochs,
      model.batchSize,
      model.daysToPredict
    );
    
    // Cancel training on the server
    cancelTraining(serverModelId);
    
    // Update model status
    updateModelConfig(modelId, {
      status: "cancelled",
      progress: 0,
      message: "Training cancelled"
    });
    
    // Remove from currently training list
    setCurrentlyTraining(prev => prev.filter(id => id !== serverModelId));
  };

  const handleCancelComboJob = (modelId: string) => {
    // Cancel training on the server
    cancelTraining(modelId);
    
    // Update combo job status
    setComboJobs(prevJobs => {
      return prevJobs.map(job => {
        if (job.modelId === modelId) {
          return {
            ...job,
            status: 'cancelled',
            progress: 0,
            message: 'Training cancelled'
          };
        }
        return job;
      });
    });
  };
  
  const handleRetryComboJob = (modelId: string) => {
    const job = comboJobs.find(job => job.modelId === modelId);
    if (!job) return;
    
    // Create a new model with the same settings
    const newModel: ModelConfig = {
      id: `model-${models.length + 1}`,
      sequenceLength: parseInt(job.config.sequenceLength),
      epochs: job.config.epochs,
      batchSize: job.config.batchSize,
      daysToPredict: job.config.daysToPredict,
      status: "pending",
      progress: 0,
      message: "Waiting to start..."
    };
    
    // Add the new model
    setModels(prevModels => [...prevModels, newModel]);
    
    // Switch to configure tab
    setActiveTab("configure");
    
    toast.info("Created a new model with the same settings. You can train it from the Configure tab.");
  };
  
  const handleStartComboTraining = async () => {
    try {
      // Calculate total number of configurations
      const { selectedSequenceLengths, selectedEpochs, selectedBatchSizes } = comboConfig;
      
      if (selectedSequenceLengths.length === 0 || selectedEpochs.length === 0 || selectedBatchSizes.length === 0) {
        toast.error("Please select at least one option from each category");
        return;
      }
      
      const totalConfigurations = selectedSequenceLengths.length * selectedEpochs.length * selectedBatchSizes.length;
      
      if (totalConfigurations === 0) {
        toast.error("No configurations selected");
        return;
      }
      
      if (totalConfigurations > 50) {
        const confirm = window.confirm(`You're about to start ${totalConfigurations} training jobs. This could take a long time and use substantial resources. Are you sure you want to continue?`);
        if (!confirm) return;
      }
      
      // Generate all combinations
      const configurations = [];
      
      for (const seqLength of selectedSequenceLengths) {
        for (const epoch of selectedEpochs) {
          for (const batchSize of selectedBatchSizes) {
            const sequenceLength = seqLength === "Full data" 
              ? stockData.timeSeries.length
              : parseInt(seqLength);
              
            configurations.push({
              sequenceLength,
              epochs: epoch,
              batchSize,
              daysToPredict: comboConfig.daysToPredict
            });
          }
        }
      }
      
      // Start combo training
      const result = await startComboTraining(stockData, configurations);
      
      // Update combo jobs
      setComboJobs(result.jobs.map(job => ({
        ...job,
        status: 'training',
        progress: 0,
        message: 'Starting training...'
      })));
      
      setComboTrainingActive(true);
      setActiveTab("comboStatus");
      
      toast.success(`Started ${result.totalJobs} training jobs`);
    } catch (error) {
      console.error("Error starting combo training:", error);
      toast.error("Failed to start combo training");
    }
  };
  
  const updateComboConfig = (key: keyof ComboConfig, value: any) => {
    setComboConfig(prev => ({
      ...prev,
      [key]: value
    }));
  };
  
  const toggleComboOption = (category: 'selectedSequenceLengths' | 'selectedEpochs' | 'selectedBatchSizes', value: string | number) => {
    setComboConfig(prev => {
      const current = [...prev[category]];
      const valueStr = value.toString();
      
      if (current.includes(valueStr)) {
        return {
          ...prev,
          [category]: current.filter(v => v.toString() !== valueStr)
        };
      } else {
        return {
          ...prev,
          [category]: [...current, valueStr]
        };
      }
    });
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
          <TabsList className="grid grid-cols-4 mb-4">
            <TabsTrigger value="configure">Configure</TabsTrigger>
            <TabsTrigger value="status">Status</TabsTrigger>
            <TabsTrigger value="combo">Combo Training</TabsTrigger>
            <TabsTrigger value="comboStatus">Combo Status</TabsTrigger>
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
                    disabled={models.length <= 1 || isModelTraining(generateModelId(
                      stockData,
                      model.sequenceLength,
                      model.epochs,
                      model.batchSize,
                      model.daysToPredict
                    ))}
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
                      disabled={isModelTraining(generateModelId(
                        stockData,
                        model.sequenceLength,
                        model.epochs,
                        model.batchSize,
                        model.daysToPredict
                      ))}
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
                      disabled={isModelTraining(generateModelId(
                        stockData,
                        model.sequenceLength,
                        model.epochs,
                        model.batchSize,
                        model.daysToPredict
                      ))}
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
                      disabled={isModelTraining(generateModelId(
                        stockData,
                        model.sequenceLength,
                        model.epochs,
                        model.batchSize,
                        model.daysToPredict
                      ))}
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
                      disabled={isModelTraining(generateModelId(
                        stockData,
                        model.sequenceLength,
                        model.epochs,
                        model.batchSize,
                        model.daysToPredict
                      ))}
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
                        model.status === "error" ? "destructive" : 
                        model.status === "cancelled" ? "outline" : "outline"
                      }>
                        {model.status === "pending" ? "Waiting" :
                         model.status === "training" ? "Training" :
                         model.status === "complete" ? "Complete" : 
                         model.status === "cancelled" ? "Cancelled" : "Error"}
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
                          disabled={currentlyTraining.includes(generateModelId(
                            stockData,
                            model.sequenceLength,
                            model.epochs,
                            model.batchSize,
                            model.daysToPredict
                          ))}
                        >
                          {currentlyTraining.includes(generateModelId(
                            stockData,
                            model.sequenceLength,
                            model.epochs,
                            model.batchSize,
                            model.daysToPredict
                          )) ? (
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
                      
                      {model.status === "training" && (
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="mt-2 w-full"
                          onClick={() => handleCancelModel(model.id)}
                        >
                          <X className="mr-2 h-4 w-4" />
                          Cancel Training
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
          
          <TabsContent value="combo" className="space-y-4">
            <Card className="p-4">
              <CardHeader className="p-0 pb-4">
                <CardTitle className="text-lg">Combo Training Configuration</CardTitle>
                <CardDescription>
                  Create multiple models with different configurations in one go.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 space-y-4">
                <div className="space-y-2">
                  <FormLabel>Days to Predict</FormLabel>
                  <Input
                    type="number"
                    value={comboConfig.daysToPredict}
                    onChange={(e) => updateComboConfig('daysToPredict', parseInt(e.target.value) || 30)}
                    min={1}
                    max={365}
                  />
                </div>
                
                <div className="space-y-2">
                  <FormLabel>Sequence Lengths</FormLabel>
                  <div className="flex flex-wrap gap-2">
                    {comboConfig.sequenceLengths.map((seqLength) => (
                      <Badge
                        key={seqLength}
                        variant={comboConfig.selectedSequenceLengths.includes(seqLength) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => toggleComboOption('selectedSequenceLengths', seqLength)}
                      >
                        {seqLength}
                      </Badge>
                    ))}
                  </div>
                </div>
                
                <div className="space-y-2">
                  <FormLabel>Epochs</FormLabel>
                  <div className="flex flex-wrap gap-2">
                    {comboConfig.epochs.map((epoch) => (
                      <Badge
                        key={epoch}
                        variant={comboConfig.selectedEpochs.includes(epoch) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => toggleComboOption('selectedEpochs', epoch)}
                      >
                        {epoch}
                      </Badge>
                    ))}
                  </div>
                </div>
                
                <div className="space-y-2">
                  <FormLabel>Batch Sizes</FormLabel>
                  <div className="flex flex-wrap gap-2">
                    {comboConfig.batchSizes.map((batchSize) => (
                      <Badge
                        key={batchSize}
                        variant={comboConfig.selectedBatchSizes.includes(batchSize) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => toggleComboOption('selectedBatchSizes', batchSize)}
                      >
                        {batchSize}
                      </Badge>
                    ))}
                  </div>
                </div>
                
                <Alert>
                  <AlertDescription>
                    This will create {
                      comboConfig.selectedSequenceLengths.length * 
                      comboConfig.selectedEpochs.length * 
                      comboConfig.selectedBatchSizes.length
                    } model configurations and train them in sequence.
                  </AlertDescription>
                </Alert>
              </CardContent>
              <CardFooter className="p-0 pt-4">
                <Button 
                  className="w-full"
                  onClick={handleStartComboTraining}
                  disabled={comboTrainingActive}
                >
                  {comboTrainingActive ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Combo Training in Progress...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Start Combo Training
                    </>
                  )}
                </Button>
              </CardFooter>
            </Card>
          </TabsContent>
          
          <TabsContent value="comboStatus">
            <ScrollArea className="h-[400px] pr-3">
              <div className="space-y-4">
                {comboJobs.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    No combo training jobs in progress. Create some from the Combo Training tab.
                  </div>
                ) : (
                  comboJobs.map((job, index) => (
                    <Card key={job.modelId} className="overflow-hidden">
                      <CardHeader className="p-4 pb-2">
                        <div className="flex justify-between items-center">
                          <CardTitle className="text-base">
                            Job {job.jobIndex !== undefined ? `${job.jobIndex + 1}/${job.totalJobs}` : index + 1}
                          </CardTitle>
                          <Badge variant={
                            job.status === "complete" ? "default" :
                            job.status === "training" ? "secondary" :
                            job.status === "error" ? "destructive" : 
                            job.status === "cancelled" ? "outline" : "outline"
                          }>
                            {job.status || "Waiting"}
                          </Badge>
                        </div>
                        <CardDescription>
                          Seq: {job.config.sequenceLength}, 
                          Epochs: {job.config.epochs}, 
                          Batch: {job.config.batchSize}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="p-4 pt-0">
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs">
                            <span>Progress:</span>
                            <span>{job.progress || 0}%</span>
                          </div>
                          <Progress value={job.progress || 0} className="h-2" />
                          <p className="text-xs text-muted-foreground">{job.message || "Waiting to start..."}</p>
                          
                          {job.status === "training" && (
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="mt-2 w-full"
                              onClick={() => handleCancelComboJob(job.modelId)}
                            >
                              <X className="mr-2 h-4 w-4" />
                              Cancel Training
                            </Button>
                          )}
                          
                          {(job.status === "error" || job.status === "cancelled") && (
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="mt-2 w-full"
                              onClick={() => handleRetryComboJob(job.modelId)}
                            >
                              <RefreshCw className="mr-2 h-4 w-4" />
                              Create Similar Model
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
        
        <DialogFooter>
          {activeTab === "configure" && (
            <>
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
            </>
          )}
          
          {(activeTab === "status" || activeTab === "comboStatus" || activeTab === "combo") && (
            <Button onClick={() => setOpen(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MultiTrainingDialog;
