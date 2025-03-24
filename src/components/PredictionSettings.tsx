
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Settings } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

// Define the form schema
const PredictionSettingsSchema = z.object({
  daysToPredict: z.number().min(1).max(30),
  sequenceLength: z.number().min(5).max(365 * 3),
  epochs: z.number().min(10).max(1000),
  batchSize: z.number().min(8).max(128),
});

type PredictionSettingsType = z.infer<typeof PredictionSettingsSchema>;

interface PredictionSettingsProps {
  onSettingsChange: (settings: PredictionSettingsType) => void;
  defaultSettings: PredictionSettingsType;
}

const PredictionSettings = ({ onSettingsChange, defaultSettings }: PredictionSettingsProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const form = useForm<PredictionSettingsType>({
    resolver: zodResolver(PredictionSettingsSchema),
    defaultValues: defaultSettings,
  });

  const onSubmit = (data: PredictionSettingsType) => {
    onSettingsChange(data);
    setIsOpen(false);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1">
          <Settings className="h-4 w-4" />
          <span>Settings</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="space-y-4">
          <h4 className="font-medium">Prediction Settings</h4>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="daysToPredict"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <div className="flex justify-between">
                      <FormLabel>Days to Predict</FormLabel>
                      <span className="text-sm text-muted-foreground">{field.value}</span>
                    </div>
                    <FormControl>
                      <Slider
                        min={1}
                        max={30}
                        step={1}
                        defaultValue={[field.value]}
                        onValueChange={(vals) => field.onChange(vals[0])}
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Number of days to predict in the future
                    </FormDescription>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sequenceLength"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <div className="flex justify-between">
                      <FormLabel>Sequence Length</FormLabel>
                      <span className="text-sm text-muted-foreground">{field.value}</span>
                    </div>
                    <FormControl>
                      <Slider
                        min={5}
                        max={365 * 3}
                        step={1}
                        defaultValue={[field.value]}
                        onValueChange={(vals) => field.onChange(vals[0])}
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Number of days used as input for prediction
                    </FormDescription>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="epochs"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <div className="flex justify-between">
                      <FormLabel>Epochs</FormLabel>
                      <span className="text-sm text-muted-foreground">{field.value}</span>
                    </div>
                    <FormControl>
                      <Slider
                        min={10}
                        max={1000}
                        step={10}
                        defaultValue={[field.value]}
                        onValueChange={(vals) => field.onChange(vals[0])}
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Number of training iterations
                    </FormDescription>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="batchSize"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <div className="flex justify-between">
                      <FormLabel>Batch Size</FormLabel>
                      <span className="text-sm text-muted-foreground">{field.value}</span>
                    </div>
                    <FormControl>
                      <Slider
                        min={8}
                        max={128}
                        step={8}
                        defaultValue={[field.value]}
                        onValueChange={(vals) => field.onChange(vals[0])}
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Number of samples per training batch
                    </FormDescription>
                  </FormItem>
                )}
              />

              <div className="flex justify-end">
                <Button type="submit" size="sm">Apply</Button>
              </div>
            </form>
          </Form>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default PredictionSettings;
