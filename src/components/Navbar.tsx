
import { useState } from "react";
import { Link } from "react-router-dom";
import { Moon, Search, Sun, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toggleTheme, getTheme } from "@/utils/config";
import SearchModal from "./SearchModal";

const Navbar = () => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [theme, setTheme] = useState(getTheme());

  const handleThemeToggle = () => {
    const newTheme = toggleTheme();
    setTheme(newTheme);
  };

  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-lg bg-background/70 border-b border-border/40">
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </Button>
          
          <Link to="/" className="flex items-center gap-2">
            <span className="font-bold text-xl bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
              StockML
            </span>
          </Link>
        </div>

        {/* Desktop Navigation */}
        <nav 
          className={cn(
            "hidden md:flex items-center gap-6"
          )}
        >
          <Link
            to="/"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Dashboard
          </Link>
          <Link
            to="/favorites"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Favorites
          </Link>
        </nav>

        {/* Mobile Navigation */}
        <div
          className={cn(
            "absolute top-16 left-0 w-full bg-background border-b border-border/40 md:hidden transform transition-transform duration-300 ease-in-out",
            isMobileMenuOpen ? "translate-y-0" : "-translate-y-full"
          )}
        >
          <nav className="flex flex-col p-4 gap-4">
            <Link
              to="/"
              className="text-foreground hover:text-primary transition-colors py-2"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Dashboard
            </Link>
            <Link
              to="/favorites"
              className="text-foreground hover:text-primary transition-colors py-2"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Favorites
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => setIsSearchOpen(true)}
          >
            <Search size={20} />
          </Button>
          
          <Button 
            variant="ghost" 
            size="icon"
            onClick={handleThemeToggle}
          >
            {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
          </Button>
        </div>
      </div>

      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
      />
    </header>
  );
};

export default Navbar;
