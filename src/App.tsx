
import { useEffect, useState } from 'react';
import { Route, Routes, BrowserRouter } from 'react-router-dom';
import Index from './pages/Index';
import StockView from './pages/StockView';
import FavoritesPage from './pages/FavoritesPage';
import NotFound from './pages/NotFound';
import { Toaster } from './components/ui/toaster';
import { initializeTensorFlow } from './utils/ml';
import GlobalTrainingStatus from './components/GlobalTrainingStatus';
import './App.css';

function App() {
  const [isMlInitialized, setIsMlInitialized] = useState(false);
  const [mlError, setMlError] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const success = await initializeTensorFlow();
        setIsMlInitialized(success);
      } catch (error) {
        console.error('Failed to initialize ML:', error);
        setMlError(error instanceof Error ? error.message : 'Unknown error');
      }
    };

    init();
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/stock/:symbol" element={<StockView />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toaster />
      <GlobalTrainingStatus />
    </BrowserRouter>
  );
}

export default App;
