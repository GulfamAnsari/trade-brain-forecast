
import { useState } from "react";
import { Settings, Check, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { toggleMockData, toggleTheme, getMockEnabled, getTheme } from "@/utils/config";
import { toast } from "sonner";

const SettingsMenu = () => {
  const [mockEnabled, setMockEnabled] = useState(getMockEnabled());
  const [currentTheme, setCurrentTheme] = useState(getTheme());

  const handleToggleMock = () => {
    const newState = toggleMockData();
    setMockEnabled(newState);
    toast.success(`Mock data ${newState ? 'enabled' : 'disabled'}`);
  };

  const handleToggleTheme = () => {
    const newTheme = toggleTheme();
    setCurrentTheme(newTheme);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Settings">
          <Settings className="h-[1.2rem] w-[1.2rem]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="grid gap-4">
          <div className="space-y-2">
            <h4 className="font-medium leading-none">Settings</h4>
            <p className="text-sm text-muted-foreground">
              Configure application preferences
            </p>
          </div>
          <Separator />
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="mock-toggle"
                  className="text-sm font-medium leading-none"
                >
                  Use Mock Data
                </label>
                <span className="text-xs text-muted-foreground">
                  Use predefined mock data instead of API calls
                </span>
              </div>
              <Switch
                id="mock-toggle"
                checked={mockEnabled}
                onCheckedChange={handleToggleMock}
              />
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="theme-toggle"
                  className="text-sm font-medium leading-none"
                >
                  Dark Theme
                </label>
                <span className="text-xs text-muted-foreground">
                  Switch between light and dark theme
                </span>
              </div>
              <Switch
                id="theme-toggle"
                checked={currentTheme === "dark"}
                onCheckedChange={handleToggleTheme}
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default SettingsMenu;
