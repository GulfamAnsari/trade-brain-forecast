
// Config storage key
const CONFIG_KEY = "app-config";

// Default config
const DEFAULT_CONFIG = {
  theme: "light" as const,
};

// Interface for the config
interface AppConfig {
  theme: "light" | "dark";
}

// Load config from localStorage
export const loadConfig = (): AppConfig => {
  try {
    const configStr = localStorage.getItem(CONFIG_KEY);
    const parsedConfig = configStr ? JSON.parse(configStr) : DEFAULT_CONFIG;
    
    // Ensure theme is either "light" or "dark"
    if (parsedConfig.theme !== "light" && parsedConfig.theme !== "dark") {
      parsedConfig.theme = "light";
    }
    
    return parsedConfig as AppConfig;
  } catch (error) {
    console.error("Error loading config:", error);
    return DEFAULT_CONFIG;
  }
};

// Save config to localStorage
export const saveConfig = (config: AppConfig): void => {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch (error) {
    console.error("Error saving config:", error);
  }
};

// Get current theme
export const getTheme = (): "light" | "dark" => {
  return loadConfig().theme;
};

// Set theme
export const setTheme = (theme: "light" | "dark"): void => {
  const config = loadConfig();
  config.theme = theme;
  saveConfig(config);
  
  // Apply theme to document
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
};

// Toggle theme
export const toggleTheme = (): "light" | "dark" => {
  const currentTheme = getTheme();
  const newTheme = currentTheme === "light" ? "dark" : "light";
  setTheme(newTheme);
  return newTheme;
};

// Initialize config when the application starts
export const initializeConfig = (): void => {
  const config = loadConfig();
  
  // Apply theme
  if (config.theme === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
};
