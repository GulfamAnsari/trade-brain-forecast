
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X, Loader2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StockSearchResult } from "@/types/stock";
import { searchStocks } from "@/utils/api";
import { cn } from "@/lib/utils";
import { isInFavorites, addToFavorites, removeFromFavorites } from "@/utils/storage";
import { toast } from "sonner";

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SearchModal = ({ isOpen, onClose }: SearchModalProps) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [favoriteStates, setFavoriteStates] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();

  useEffect(() => {
    const handleSearch = async () => {
      if (query.trim().length < 1) {
        setResults([]);
        return;
      }

      setIsLoading(true);
      try {
        const searchResults = await searchStocks(query);
        setResults(searchResults);
        
        // Initialize favorite states
        const newFavoriteStates: Record<string, boolean> = {};
        searchResults.forEach(stock => {
          newFavoriteStates[stock.symbol] = isInFavorites(stock.symbol);
        });
        setFavoriteStates(newFavoriteStates);
      } catch (error) {
        console.error("Search error:", error);
      } finally {
        setIsLoading(false);
      }
    };

    const delayDebounce = setTimeout(handleSearch, 300);
    return () => clearTimeout(delayDebounce);
  }, [query]);

  const handleStockSelect = (symbol: string) => {
    navigate(`/stock/${symbol}`);
    onClose();
    setQuery("");
    setResults([]);
  };

  const handleToggleFavorite = (e: React.MouseEvent, stock: StockSearchResult) => {
    e.stopPropagation(); // Prevent triggering the parent button click
    
    const isFavorite = favoriteStates[stock.symbol];
    
    if (isFavorite) {
      removeFromFavorites(stock.symbol);
      toast.success(`Removed ${stock.name} from favorites`);
    } else {
      addToFavorites(stock.symbol);
      toast.success(`Added ${stock.name} to favorites`);
    }
    
    // Update state
    setFavoriteStates(prev => ({
      ...prev,
      [stock.symbol]: !isFavorite
    }));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    }
  };

  // Close modal when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (isOpen && target.id === "search-modal-backdrop") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      id="search-modal-backdrop"
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-start justify-center p-4 md:p-8"
    >
      <div
        className={cn(
          "w-full max-w-lg rounded-lg border bg-card shadow-lg animate-scale-in",
          "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
        )}
      >
        <div className="flex items-center p-3 border-b">
          <Search className="h-5 w-5 mr-2 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Search stocks by name or symbol..."
            className="flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <Button
            variant="ghost"
            size="icon"
            className="ml-2"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="max-h-80 overflow-y-auto custom-scroll">
          {isLoading ? (
            <div className="py-6 flex justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : results.length > 0 ? (
            <ul className="py-2">
              {results.map((stock) => (
                <li key={stock.symbol}>
                  <button
                    onClick={() => handleStockSelect(stock.symbol)}
                    className="w-full text-left px-4 py-3 hover:bg-accent transition-colors flex items-start justify-between group"
                  >
                    <div>
                      <div className="font-medium">{stock.symbol}</div>
                      <div className="text-sm text-muted-foreground">
                        {stock.name}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-xs text-muted-foreground mt-1">{stock.region}</div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                          "h-8 w-8 transition-all hover:scale-110",
                          favoriteStates[stock.symbol] ? "text-yellow-500 hover:text-yellow-600" : "text-muted-foreground"
                        )}
                        onClick={(e) => handleToggleFavorite(e, stock)}
                      >
                        <Star 
                          className={cn(
                            "h-4 w-4",
                            favoriteStates[stock.symbol] ? "fill-yellow-500" : "fill-none"
                          )} 
                        />
                      </Button>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : query.length > 0 ? (
            <div className="px-4 py-8 text-center text-muted-foreground">
              No results found for "{query}"
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-muted-foreground">
              Search for stocks by name or symbol
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SearchModal;
