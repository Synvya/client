import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OpeningHoursSpec } from "@/types/profile";

interface OpeningHoursDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openingHours: OpeningHoursSpec[];
  onSave: (hours: OpeningHoursSpec[]) => void;
}

const DAYS = [
  { label: "Monday", value: "Mo", index: 0 },
  { label: "Tuesday", value: "Tu", index: 1 },
  { label: "Wednesday", value: "We", index: 2 },
  { label: "Thursday", value: "Th", index: 3 },
  { label: "Friday", value: "Fr", index: 4 },
  { label: "Saturday", value: "Sa", index: 5 },
  { label: "Sunday", value: "Su", index: 6 },
];

interface DayHours {
  enabled: boolean;
  startTime: string;
  endTime: string;
  secondStartTime?: string;
  secondEndTime?: string;
}

function openingHoursToDayHours(specs: OpeningHoursSpec[]): DayHours[] {
  const hours: DayHours[] = DAYS.map(() => ({
    enabled: false,
    startTime: "09:00",
    endTime: "17:00",
  }));
  for (const spec of specs) {
    for (const day of spec.days) {
      const dayIndex = DAYS.findIndex((d) => d.value === day);
      if (dayIndex >= 0) {
        hours[dayIndex] = {
          enabled: true,
          startTime: spec.startTime,
          endTime: spec.endTime,
        };
      }
    }
  }
  return hours;
}

export function OpeningHoursDialog({
  open,
  onOpenChange,
  openingHours,
  onSave,
}: OpeningHoursDialogProps) {
  const [dayHours, setDayHours] = useState<DayHours[]>(() =>
    openingHoursToDayHours(openingHours)
  );
  const prevOpen = useRef(false);

  // Sync from prop when dialog opens so existing hours load on reopen
  useEffect(() => {
    if (open && !prevOpen.current) {
      setDayHours(openingHoursToDayHours(openingHours));
    }
    prevOpen.current = open;
  }, [open, openingHours]);

  const handleDayToggle = (index: number) => {
    setDayHours((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], enabled: !next[index].enabled };
      return next;
    });
  };

  const handleTimeChange = (
    index: number,
    field: "startTime" | "endTime" | "secondStartTime" | "secondEndTime",
    value: string
  ) => {
    setDayHours((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleCopyToAll = () => {
    const firstEnabled = dayHours.find((h) => h.enabled);
    if (firstEnabled) {
      setDayHours((prev) =>
        prev.map((h) => ({
          ...h,
          enabled: true,
          startTime: firstEnabled.startTime,
          endTime: firstEnabled.endTime,
        }))
      );
    }
  };

  const handleClearAll = () => {
    setDayHours((prev) =>
      prev.map((h) => ({
        ...h,
        enabled: false,
        startTime: "09:00",
        endTime: "17:00",
      }))
    );
  };

  const handleSave = () => {
    // Group consecutive days with same hours
    const specs: OpeningHoursSpec[] = [];
    let currentGroup: { days: string[]; startTime: string; endTime: string } | null = null;

    for (let i = 0; i < dayHours.length; i++) {
      const day = dayHours[i];
      if (day.enabled) {
        if (
          currentGroup &&
          currentGroup.startTime === day.startTime &&
          currentGroup.endTime === day.endTime
        ) {
          // Extend current group
          currentGroup.days.push(DAYS[i].value);
        } else {
          // Start new group
          if (currentGroup) {
            specs.push({
              days: currentGroup.days,
              startTime: currentGroup.startTime,
              endTime: currentGroup.endTime,
            });
          }
          currentGroup = {
            days: [DAYS[i].value],
            startTime: day.startTime,
            endTime: day.endTime,
          };
        }
      } else {
        // Day is disabled, close current group if any
        if (currentGroup) {
          specs.push({
            days: currentGroup.days,
            startTime: currentGroup.startTime,
            endTime: currentGroup.endTime,
          });
          currentGroup = null;
        }
      }
    }

    // Add final group if any
    if (currentGroup) {
      specs.push({
        days: currentGroup.days,
        startTime: currentGroup.startTime,
        endTime: currentGroup.endTime,
      });
    }

    onSave(specs);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Opening Hours</DialogTitle>
          <DialogDescription>
            Set your business opening hours for each day of the week.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={handleCopyToAll} size="sm">
              Copy to All
            </Button>
            <Button type="button" variant="outline" onClick={handleClearAll} size="sm">
              Clear All
            </Button>
          </div>

          <div className="space-y-2">
            {DAYS.map((day, index) => (
              <div key={day.value} className="flex items-center gap-4">
                <div className="flex items-center gap-2 w-24">
                  <input
                    type="checkbox"
                    id={`day-${day.value}`}
                    className="h-4 w-4 rounded border-gray-300"
                    checked={dayHours[index].enabled}
                    onChange={() => handleDayToggle(index)}
                  />
                  <Label htmlFor={`day-${day.value}`} className="cursor-pointer text-sm">
                    {day.label}
                  </Label>
                </div>
                {dayHours[index].enabled && (
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      type="time"
                      value={dayHours[index].startTime}
                      onChange={(e) => handleTimeChange(index, "startTime", e.target.value)}
                      className="w-32"
                    />
                    <span className="text-sm text-muted-foreground">to</span>
                    <Input
                      type="time"
                      value={dayHours[index].endTime}
                      onChange={(e) => handleTimeChange(index, "endTime", e.target.value)}
                      className="w-32"
                    />
                  </div>
                )}
                {!dayHours[index].enabled && (
                  <span className="text-sm text-muted-foreground">Closed</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

