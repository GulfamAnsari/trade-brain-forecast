
import { useState } from "react";
import CustomNavbar from "@/components/CustomNavbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Search, Star, LineChart } from "lucide-react";
import FavoritesList from "@/components/FavoritesList";
import SearchModal from "@/components/SearchModal";

const Index = () => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <CustomNavbar />
      
      <main className="flex-1 container py-8">
        <div className="max-w-4xl mx-auto">
          <section className="mb-12">
            <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-primary to-primary/80 bg-clip-text text-transparent">
              Stock Market Prediction
            </h1>
            <p className="text-xl text-muted-foreground mb-8">
              Analyze and predict Indian stock market trends with machine learning
            </p>
            
            <Card className="mb-8">
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row gap-4 items-center">
                  <div className="flex-1">
                    <h2 className="text-2xl font-semibold mb-2">
                      Search for stocks
                    </h2>
                    <p className="text-muted-foreground mb-4">
                      Find and analyze any stock from the Indian market
                    </p>
                    <Button 
                      size="lg"
                      onClick={() => setIsSearchOpen(true)}
                      className="gap-2"
                    >
                      <Search className="h-5 w-5" />
                      Search Stocks
                    </Button>
                  </div>
                  <div className="flex-1 flex justify-center">
                    <LineChart className="h-32 w-32 text-primary opacity-80" />
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Star className="h-5 w-5 text-primary" />
                    Your Favorites
                  </CardTitle>
                  <CardDescription>
                    Quick access to your favorite stocks
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground mb-4">
                    Add stocks to your favorites for easy access and tracking.
                  </p>
                  <Button variant="outline" asChild>
                    <a href="/favorites">View All Favorites</a>
                  </Button>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <LineChart className="h-5 w-5 text-primary" />
                    ML Predictions
                  </CardTitle>
                  <CardDescription>
                    Advanced stock price predictions
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground mb-4">
                    Use machine learning to predict future stock prices based on historical data.
                  </p>
                  <Button variant="outline" onClick={() => setIsSearchOpen(true)}>
                    Search to Predict
                  </Button>
                </CardContent>
              </Card>
            </div>
          </section>
          
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">Your Favorites</h2>
              <Button variant="outline" asChild size="sm">
                <a href="/favorites">View All</a>
              </Button>
            </div>
            
            <FavoritesList />
          </section>
        </div>
      </main>
      
      <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
    </div>
  );
};

export default Index;
