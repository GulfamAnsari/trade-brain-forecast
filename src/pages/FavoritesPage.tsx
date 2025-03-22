
import CustomNavbar from "@/components/CustomNavbar";
import { Card } from "@/components/ui/card";
import FavoritesList from "@/components/FavoritesList";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

const FavoritesPage = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <CustomNavbar />
      
      <main className="flex-1 container py-8">
        <div className="max-w-4xl mx-auto">
          <Button variant="ghost" asChild className="mb-6">
            <Link to="/" className="flex items-center text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Link>
          </Button>
          
          <h1 className="text-3xl font-bold mb-6">Your Favorite Stocks</h1>
          
          <Card className="p-6">
            <FavoritesList fullWidth />
          </Card>
        </div>
      </main>
    </div>
  );
};

export default FavoritesPage;
