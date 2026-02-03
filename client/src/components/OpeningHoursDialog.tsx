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

interface DaySegment {
  startTime: string;
  endTime: string;
}

interface DayHours {
  enabled: boolean;
  segments: DaySegment[];
}

const DEFAULT_SEGMENT: DaySegment = { startTime: "09:00", endTime: "17:00" };

function segmentKey(segments: DaySegment[]): string {
  const sorted = [...segments].sort(
    (a, b) => a.startTime.localeCompare(b.startTime)
  );
  return sorted.map((s) => `${s.startTime}-${s.endTime}`).join(",");
}

function openingHoursToDayHours(specs: OpeningHoursSpec[]): DayHours[] {
  const hours: DayHours[] = DAYS.map(() => ({
    enabled: false,
    segments: [],
  }));

  for (const spec of specs) {
    const segment: DaySegment = {
      startTime: spec.startTime,
      endTime: spec.endTime,
    };
    for (const day of spec.days) {
      const dayIndex = DAYS.findIndex((d) => d.value === day);
      if (dayIndex >= 0) {
        if (!hours[dayIndex].segments.some(
          (s) => s.startTime === segment.startTime && s.endTime === segment.endTime
        )) {
          hours[dayIndex].segments.push({ ...segment });
        }
        hours[dayIndex].enabled = true;
      }
    }
  }

  // Sort segments by startTime per day and ensure enabled days have at least one segment
  for (let i = 0; i < hours.length; i++) {
    const day = hours[i];
    if (day.segments.length > 0) {
      day.segments.sort((a, b) => a.startTime.localeCompare(b.startTime));
    } else if (day.enabled) {
      hours[i] = { enabled: true, segments: [{ ...DEFAULT_SEGMENT }] };
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
      const next = prev.map((h) => ({ ...h, segments: [...h.segments] }));
      const current = next[index];
      if (!current.enabled) {
        next[index] = {
          enabled: true,
          segments: current.segments.length > 0 ? current.segments : [{ ...DEFAULT_SEGMENT }],
        };
      } else {
        next[index] = { enabled: false, segments: [] };
      }
      return next;
    });
  };

  const handleSegmentChange = (
    dayIndex: number,
    segmentIndex: number,
    field: "startTime" | "endTime",
    value: string
  ) => {
    setDayHours((prev) => {
      const next = prev.map((h) => ({ ...h, segments: h.segments.map((s) => ({ ...s })) }));
      next[dayIndex].segments[segmentIndex][field] = value;
      return next;
    });
  };

  const handleAddSegment = (dayIndex: number) => {
    setDayHours((prev) => {
      const next = prev.map((h) => ({ ...h, segments: h.segments.map((s) => ({ ...s })) }));
      const last = next[dayIndex].segments[next[dayIndex].segments.length - 1];
      const newSegment: DaySegment = last
        ? { startTime: last.endTime, endTime: last.endTime === "23:59" ? "23:59" : "18:00" }
        : { ...DEFAULT_SEGMENT };
      next[dayIndex].segments.push(newSegment);
      return next;
    });
  };

  const handleRemoveSegment = (dayIndex: number, segmentIndex: number) => {
    setDayHours((prev) => {
      const next = prev.map((h) => ({ ...h, segments: h.segments.map((s) => ({ ...s })) }));
      next[dayIndex].segments.splice(segmentIndex, 1);
      return next;
    });
  };

  const handleCopyToAll = () => {
    const firstEnabled = dayHours.find((h) => h.enabled && h.segments.length > 0);
    if (firstEnabled) {
      const template = firstEnabled.segments.map((s) => ({ ...s }));
      setDayHours((prev) =>
        prev.map((h) => ({
          ...h,
          enabled: true,
          segments: template.map((s) => ({ ...s })),
        }))
      );
    }
  };

  const handleClearAll = () => {
    setDayHours(
      DAYS.map(() => ({
        enabled: false,
        segments: [],
      }))
    );
  };

  const handleSave = () => {
    const specs: OpeningHoursSpec[] = [];
    let currentGroup: { dayIndices: number[]; segments: DaySegment[] } | null = null;

    for (let i = 0; i < dayHours.length; i++) {
      const day = dayHours[i];
      if (day.enabled && day.segments.length > 0) {
        const key = segmentKey(day.segments);
        const segments = [...day.segments].sort((a, b) =>
          a.startTime.localeCompare(b.startTime)
        );

        if (
          currentGroup &&
          segmentKey(currentGroup.segments) === key
        ) {
          currentGroup.dayIndices.push(i);
        } else {
          if (currentGroup) {
            for (const seg of currentGroup.segments) {
              specs.push({
                days: currentGroup.dayIndices.map((idx) => DAYS[idx].value),
                startTime: seg.startTime,
                endTime: seg.endTime,
              });
            }
          }
          currentGroup = { dayIndices: [i], segments };
        }
      } else {
        if (currentGroup) {
          for (const seg of currentGroup.segments) {
            specs.push({
              days: currentGroup.dayIndices.map((idx) => DAYS[idx].value),
              startTime: seg.startTime,
              endTime: seg.endTime,
            });
          }
          currentGroup = null;
        }
      }
    }

    if (currentGroup) {
      for (const seg of currentGroup.segments) {
        specs.push({
          days: currentGroup.dayIndices.map((idx) => DAYS[idx].value),
          startTime: seg.startTime,
          endTime: seg.endTime,
        });
      }
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
            Set your business opening hours for each day. You can add multiple
            segments per day (e.g. 9am–11am and 1pm–5pm).
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

          <div className="space-y-3">
            {DAYS.map((day, index) => (
              <div key={day.value} className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <div className="flex items-center gap-2 w-24 shrink-0">
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
                {dayHours[index].enabled ? (
                  <div className="flex flex-col gap-2 flex-1 min-w-0">
                    {dayHours[index].segments.map((segment, segIdx) => (
                      <div
                        key={segIdx}
                        className="flex items-center gap-2 flex-wrap"
                      >
                        <Input
                          type="time"
                          value={segment.startTime}
                          onChange={(e) =>
                            handleSegmentChange(index, segIdx, "startTime", e.target.value)
                          }
                          className="w-32"
                          aria-label={`${day.label} segment ${segIdx + 1} start`}
                        />
                        <span className="text-sm text-muted-foreground">to</span>
                        <Input
                          type="time"
                          value={segment.endTime}
                          onChange={(e) =>
                            handleSegmentChange(index, segIdx, "endTime", e.target.value)
                          }
                          className="w-32"
                          aria-label={`${day.label} segment ${segIdx + 1} end`}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => handleRemoveSegment(index, segIdx)}
                          aria-label={`Remove segment ${segIdx + 1} for ${day.label}`}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-fit"
                      onClick={() => handleAddSegment(index)}
                    >
                      Add segment
                    </Button>
                  </div>
                ) : (
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
