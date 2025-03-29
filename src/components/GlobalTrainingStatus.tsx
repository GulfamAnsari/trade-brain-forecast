
import React, { useState, useEffect } from 'react';
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { addWebSocketHandler, cancelTraining, getActiveTrainingModels } from "@/utils/ml";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";

interface TrainingStatus {
  modelId: string;
  symbol?: string;
  progress: number;
  message: string;
  stage?: string;
  startTime?: number;
}

const GlobalTrainingStatus = () => {
  const [trainingModels, setTrainingModels] = useState<Map<string, TrainingStatus>>(new Map());
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    // Initialize with any active models
    const activeModels = getActiveTrainingModels();
    const initialStatus = new Map<string, TrainingStatus>();
    
    activeModels.forEach(modelId => {
      initialStatus.set(modelId, {
        modelId,
        progress: 0,
        message: "Training in progress...",
        stage: "training",
        startTime: Date.now()
      });
    });
    
    if (activeModels.length > 0) {
      setTrainingModels(initialStatus);
    }
    
    // Listen for training updates
    const removeHandler = addWebSocketHandler((message) => {
      if ((message.type === 'status' || message.type === 'progress') && message.modelId) {
        setTrainingModels(current => {
          const updated = new Map(current);
          
          if (message.data.stage === 'complete' || message.data.stage === 'error' || message.data.stage === 'cancelled') {
            // After a brief delay, remove completed/error models
            setTimeout(() => {
              setTrainingModels(current => {
                const filtered = new Map(current);
                filtered.delete(message.modelId);
                return filtered;
              });
            }, 10000); // Show completed models for 10 seconds
          }
          
          // Update or add the model status
          if (message.data) {
            updated.set(message.modelId, {
              modelId: message.modelId,
              symbol: message.data.symbol || message.modelId.split('_')[0],
              progress: message.data.percent || 0,
              message: message.data.message || '',
              stage: message.data.stage || 'training',
              startTime: updated.get(message.modelId)?.startTime || Date.now()
            });
          }
          
          return updated;
        });
      }
    }, 'global');
    
    return () => removeHandler();
  }, []);
  
  const handleCancelTraining = async (modelId: string) => {
    try {
      await cancelTraining(modelId);
      toast.success(`Cancelled training for ${modelId}`);
    } catch (error) {
      toast.error(`Failed to cancel training: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };
  
  // If no models are training, don't show anything
  if (trainingModels.size === 0) return null;
  
  // Format time elapsed
  const formatTimeElapsed = (startTime?: number): string => {
    if (!startTime) return '';
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return `${minutes}m ${seconds}s`;
  };

  return (
    <Card className="fixed bottom-4 right-4 w-80 shadow-lg z-50">
      <CardHeader className="p-3 flex flex-row items-center space-y-0 justify-between bg-muted/50">
        <CardTitle className="text-sm flex gap-2 items-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Training Models ({trainingModels.size})
        </CardTitle>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setExpanded(!expanded)}>
          {expanded ? <X className="h-4 w-4" /> : <Badge className="h-5 w-5 p-0 flex items-center justify-center">{trainingModels.size}</Badge>}
        </Button>
      </CardHeader>
      
      {expanded && (
        <CardContent className="p-3">
          <ScrollArea className="h-[min(400px,_calc(100vh-300px))]">
            <div className="space-y-3">
              {Array.from(trainingModels.entries()).map(([modelId, status]) => (
                <div key={modelId} className="bg-card border rounded-md p-2">
                  <div className="flex justify-between items-start mb-1">
                    <div>
                      <div className="text-xs font-medium truncate max-w-[180px]" title={modelId}>
                        {status.symbol || modelId.split('_')[0]}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatTimeElapsed(status.startTime)}
                      </div>
                    </div>
                    
                    <Badge variant={
                      status.stage === 'complete' ? 'default' :
                      status.stage === 'error' ? 'destructive' :
                      status.stage === 'cancelled' ? 'outline' : 
                      'secondary'
                    } className="text-xs">
                      {status.stage === 'complete' ? (
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                      ) : status.stage === 'error' ? (
                        <AlertTriangle className="h-3 w-3 mr-1" />
                      ) : (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      )}
                      {status.stage || 'Training'}
                    </Badge>
                  </div>
                  
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span>{status.message}</span>
                      <span>{status.progress}%</span>
                    </div>
                    <Progress value={status.progress} className="h-1" />
                    
                    {status.stage !== 'complete' && status.stage !== 'error' && status.stage !== 'cancelled' && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="mt-1 text-xs h-7 w-full" 
                        onClick={() => handleCancelTraining(modelId)}
                      >
                        <X className="h-3 w-3 mr-1" /> Cancel
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      )}
    </Card>
  );
};

export default GlobalTrainingStatus;
