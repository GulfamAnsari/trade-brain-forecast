
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import CustomNavbar from "@/components/CustomNavbar";
import StockChart from "@/components/StockChart";
import StockDetails from "@/components/StockDetails";
import PredictionButton from "@/components/PredictionButton";
import PredictionInsight from "@/components/PredictionInsight"; 
import SavedModels from "@/components/SavedModels";
import CombinedModelsPanel from "@/components/CombinedModelsPanel";
import { StockData, PredictionResult } from "@/types/stock";
import { getStockData } from "@/utils/api";
import { ArrowLeft, BrainCircuit, History, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import MultiTrainingDialog from "@/components/MultiTrainingDialog";
import { useQuery } from "@tanstack/react-query";
import { SERVER_URL } from "@/config";

interface PredictionModel {
  modelId: string;
  predictions: PredictionResult[];
}

const StockView = () => {
  const { symbol } = useParams<{ symbol: string }>();
  const [stockData, setStockData] = useState<StockData | null>(null);
  const [currentPredictions, setCurrentPredictions] = useState<PredictionResult[]>([]);
  const [savedPredictions, setSavedPredictions] = useState<PredictionModel[]>([]);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedModels, setSavedModels] = useState<any[]>([]);
  const [showHistorical, setShowHistorical] = useState(false);

  // Fetch stock data
  const { data: stockDataResponse, isLoading: stockLoading, error: stockError } = useQuery({
    queryKey: ['stock', symbol],
    queryFn: () => getStockData(symbol || ''),
    enabled: !!symbol,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
  
  // Fetch saved models
  const { data: savedModelsResponse, isLoading: modelsLoading } = useQuery({
    queryKey: ['models'],
    queryFn: async () => {
      const response = await fetch(`${SERVER_URL}/api/models`);
      if (!response.ok) {
        throw new Error('Failed to fetch models');
      }
      return response.json();
    },
    refetchInterval: 10000, // Refetch every 10 seconds to get updates on training
  });

  useEffect(() => {
    if (stockDataResponse) {
      setStockData(stockDataResponse);
      setIsLoading(false);
    }
    
    if (stockError) {
      setError("Failed to fetch stock data");
      setIsLoading(false);
    }
  }, [stockDataResponse, stockError]);
  
  useEffect(() => {
    if (savedModelsResponse) {
      // Filter models for this stock
      const stockModels = savedModelsResponse.models.filter((model: any) => 
        model.modelId.startsWith(symbol || '')
      );
      
      setSavedModels(stockModels);
    }
  }, [savedModelsResponse, symbol]);

  const handlePredictionComplete = (newPredictions: PredictionResult[]) => {
    setCurrentPredictions(newPredictions);
    setActiveModelId('current');
  };

  const handleModelSelect = (modelId: string, predictions: PredictionResult[]) => {
    const existingModelIndex = savedPredictions.findIndex(m => m.modelId === modelId);
    
    if (existingModelIndex >= 0) {
      const updatedModels = [...savedPredictions];
      updatedModels[existingModelIndex] = { modelId, predictions };
      setSavedPredictions(updatedModels);
    } else {
      setSavedPredictions([...savedPredictions, { modelId, predictions }]);
    }
    
    setActiveModelId(modelId);
  };

  const getCurrentPrice = () => {
    if (!stockData || !stockData.timeSeries || stockData.timeSeries.length === 0) {
      return 0;
    }
    return stockData.timeSeries[stockData.timeSeries.length - 1].close;
  };

  const getActivePredictions = () => {
    if (activeModelId === 'current') {
      return currentPredictions;
    } else if (activeModelId) {
      const model = savedPredictions.find(m => m.modelId === activeModelId);
      return model ? model.predictions : [];
    }
    return currentPredictions.length > 0 ? currentPredictions : (savedPredictions[0]?.predictions || []);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <CustomNavbar />
      
      <main className="flex-1 container py-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <Button variant="ghost" asChild className="mb-4">
              <Link to="/" className="flex items-center text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Link>
            </Button>
            
            {error ? (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-2/3 mb-2" />
                <Skeleton className="h-6 w-1/3 mb-8" />
                
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                  <Skeleton className="h-[320px] lg:col-span-2" />
                  <Skeleton className="h-[320px]" />
                </div>
                
                <Skeleton className="h-[300px] mb-8" />
              </div>
            ) : stockData ? (
              <>
                <StockDetails stockData={stockData} className="mb-8" />
                
                <Tabs defaultValue="prediction" className="mb-8">
                  <div className="flex justify-between items-center mb-4">
                    <TabsList>
                      <TabsTrigger value="prediction" className="flex items-center gap-2">
                        <BrainCircuit className="h-4 w-4" />
                        ML Prediction
                      </TabsTrigger>
                      <TabsTrigger value="models" className="flex items-center gap-2">
                        <History className="h-4 w-4" />
                        Saved Models
                      </TabsTrigger>
                      <TabsTrigger value="overview" className="flex items-center gap-2">
                        <BarChart3 className="h-4 w-4" />
                        Overview
                      </TabsTrigger>
                    </TabsList>
                    
                    {stockData && (
                      <MultiTrainingDialog 
                        stockData={stockData} 
                        onPredictionComplete={handlePredictionComplete} 
                      />
                    )}
                  </div>
                  
                  <TabsContent value="prediction" className="space-y-4">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      <div className="lg:col-span-2 space-y-4">
                        <div className="flex justify-between items-center">
                          <h3 className="text-lg font-medium">Price Prediction Chart</h3>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => setShowHistorical(!showHistorical)}
                          >
                            {showHistorical ? "Hide Historical" : "Show Historical"}
                          </Button>
                        </div>
                        <StockChart 
                          stockData={stockData} 
                          predictions={getActivePredictions()} 
                          showPredictions={true}
                          showHistorical={showHistorical}
                          title="Price Prediction Chart"
                        />
                      </div>
                      <div className="space-y-6">
                        <PredictionButton
                          stockData={stockData}
                          onPredictionComplete={handlePredictionComplete}
                        />
                        <PredictionInsight 
                          predictions={getActivePredictions()}
                          currentPrice={getCurrentPrice()}
                        />
                      </div>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="models">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      <div className="lg:col-span-2 space-y-4">
                        <StockChart 
                          stockData={stockData} 
                          predictions={getActivePredictions()} 
                          showPredictions={true}
                          showHistorical={showHistorical}
                          title={`Model Predictions: ${activeModelId || 'Current'}`}
                        />
                      </div>
                      <div className="space-y-6">
                        <SavedModels 
                          stockData={stockData}
                          onModelSelect={handleModelSelect}
                        />
                        <CombinedModelsPanel
                          stockData={stockData}
                          savedModels={savedModels}
                          onPredictionComplete={handlePredictionComplete}
                        />
                      </div>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="overview" className="space-y-4">
                    <Card className="p-6">
                      <h3 className="text-xl font-semibold mb-4">Company Overview</h3>
                      <p className="text-muted-foreground mb-4">
                        {stockData.name} is a publicly traded company on the Indian stock exchange.
                        This section would typically contain a company description, sector information,
                        and other relevant details about the company's business and operations.
                      </p>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <h4 className="font-medium mb-2">Key Statistics</h4>
                          <ul className="space-y-2 text-sm">
                            <li className="flex justify-between">
                              <span className="text-muted-foreground">Market Cap</span>
                              <span>₹ --</span>
                            </li>
                            <li className="flex justify-between">
                              <span className="text-muted-foreground">P/E Ratio</span>
                              <span>-- x</span>
                            </li>
                            <li className="flex justify-between">
                              <span className="text-muted-foreground">Dividend Yield</span>
                              <span>--%</span>
                            </li>
                            <li className="flex justify-between">
                              <span className="text-muted-foreground">52 Week Range</span>
                              <span>₹ -- - ₹ --</span>
                            </li>
                          </ul>
                        </div>
                        
                        <div>
                          <h4 className="font-medium mb-2">Trading Information</h4>
                          <ul className="space-y-2 text-sm">
                            <li className="flex justify-between">
                              <span className="text-muted-foreground">Exchange</span>
                              <span>BSE/NSE</span>
                            </li>
                            <li className="flex justify-between">
                              <span className="text-muted-foreground">Currency</span>
                              <span>INR (₹)</span>
                            </li>
                            <li className="flex justify-between">
                              <span className="text-muted-foreground">Trading Hours</span>
                              <span>9:15 AM - 3:30 PM IST</span>
                            </li>
                            <li className="flex justify-between">
                              <span className="text-muted-foreground">ISIN</span>
                              <span>--</span>
                            </li>
                          </ul>
                        </div>
                      </div>
                    </Card>
                  </TabsContent>
                </Tabs>
              </>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
};

export default StockView;
