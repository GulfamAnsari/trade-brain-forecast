
import Navbar from "@/components/Navbar";
import FavoritesList from "@/components/FavoritesList";
import { Button } from "@/components/ui/button";
import { Home, Search } from "lucide-react";
import { useState } from "react";
import SearchModal from "@/components/SearchModal";

const FavoritesPage = () => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      
      <main className="flex-1 container py-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold mb-2">Favorite Stocks</h1>
              <p className="text-muted-foreground">
                Manage and track your favorite stocks
              </p>
            </div>
            
            <div className="flex gap-2">
              <Button variant="outline" asChild size="sm">
                <a href="/">
                  <Home className="h-4 w-4 mr-2" />
                  Dashboard
                </a>
              </Button>
              
              <Button size="sm" onClick={() => setIsSearchOpen(true)}>
                <Search className="h-4 w-4 mr-2" />
                Add Stocks
              </Button>
            </div>
          </div>
          
          <FavoritesList />
        </div>
      </main>
      
      <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
    </div>
  );
};

export default FavoritesPage;
