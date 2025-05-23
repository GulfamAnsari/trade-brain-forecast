
import { StockSearchResult } from "@/types/stock";

// Comprehensive list of major Indian stocks
export const indianStocks: StockSearchResult[] = [
  {
    symbol: "RELIANCE.BSE",
    name: "Reliance Industries Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "TCS.BSE",
    name: "Tata Consultancy Services Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "HDFCBANK.BSE",
    name: "HDFC Bank Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "INFY.BSE",
    name: "Infosys Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "HINDUNILVR.BSE",
    name: "Hindustan Unilever Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "ICICIBANK.BSE",
    name: "ICICI Bank Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "BHARTIARTL.BSE",
    name: "Bharti Airtel Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "ITC.BSE",
    name: "ITC Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "SBIN.BSE",
    name: "State Bank of India",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "KOTAKBANK.BSE",
    name: "Kotak Mahindra Bank Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "TATAMOTORS.BSE",
    name: "Tata Motors Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "WIPRO.BSE",
    name: "Wipro Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "AXISBANK.BSE",
    name: "Axis Bank Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "ASIANPAINT.BSE",
    name: "Asian Paints Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "MARUTI.BSE",
    name: "Maruti Suzuki India Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "NTPC.BSE",
    name: "NTPC Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "BAJAJFINSV.BSE",
    name: "Bajaj Finserv Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "HCLTECH.BSE",
    name: "HCL Technologies Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "ULTRACEMCO.BSE",
    name: "UltraTech Cement Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
  {
    symbol: "SUNPHARMA.BSE",
    name: "Sun Pharmaceutical Industries Limited",
    type: "Equity",
    region: "India",
    marketOpen: "9:15",
    marketClose: "15:30",
    timezone: "UTC+5:30",
    currency: "INR",
  },
];

// Function to search stocks based on query
export const searchIndianStocks = (query: string): StockSearchResult[] => {
  if (!query) return [];
  
  const lowerQuery = query.toLowerCase();
  return indianStocks.filter(
    stock => 
      stock.symbol.toLowerCase().includes(lowerQuery) || 
      stock.name.toLowerCase().includes(lowerQuery)
  );
};
