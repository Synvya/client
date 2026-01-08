import { FormEvent, useState } from "react";
import type { Offer, OfferType } from "@/types/loyalty";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface OfferFormProps {
  /** Offer to edit (undefined for new offer) */
  offer?: Offer;
  /** Callback when offer is saved */
  onSave: (offer: Omit<Offer, "eventId" | "createdAt" | "status">) => Promise<void>;
  /** Callback when form is cancelled */
  onCancel: () => void;
  /** Restaurant's IANA timezone for display */
  timezone: string;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
}

interface FormErrors {
  type?: string;
  description?: string;
  validFrom?: string;
  validUntil?: string;
}

/**
 * Detect the user's preferred hour format from browser/OS settings
 * Uses multiple detection methods for maximum reliability
 */
function getUserHourCycle(): '12h' | '24h' {
  try {
    const locale = navigator.language || 'en-US';
    const formatter = new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
    });
    const options = formatter.resolvedOptions() as any;
    
    // Method 1: Check hourCycle property (most reliable)
    // hourCycle can be: h11, h12 (12-hour) or h23, h24 (24-hour)
    // Note: hourCycle is not in all TypeScript definitions but exists in modern browsers
    if (options.hourCycle && typeof options.hourCycle === 'string') {
      return options.hourCycle.startsWith('h1') ? '12h' : '24h';
    }
    
    // Method 2: Check hour12 property
    if (options.hour12 !== undefined) {
      return options.hour12 ? '12h' : '24h';
    }
    
    // Method 3: Format a test time and check for AM/PM markers
    const testDate = new Date(2000, 0, 1, 13, 0);
    const formatted = formatter.format(testDate);
    const hasAmPm = /am|pm|AM|PM|a\.m\.|p\.m\./i.test(formatted);
    return hasAmPm ? '12h' : '24h';
  } catch (e) {
    // Fallback: Default to 12h for US/CA locales, 24h otherwise
    const locale = navigator.language || 'en-US';
    return locale.startsWith('en-US') || locale.startsWith('en-CA') ? '12h' : '24h';
  }
}

/**
 * Format date and time for display using user's preferred format
 * Respects browser/OS settings for 12h vs 24h time
 */
function formatDateTime(date: Date | undefined): string {
  if (!date) return "Pick a date and time";
  
  const hourCycle = getUserHourCycle();
  const use24Hour = hourCycle === '24h';
  
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: use24Hour ? "2-digit" : "numeric",
    minute: "2-digit",
    hour12: !use24Hour,
  });
}

/**
 * Format date and time for datetime-local input
 */
function formatDateTimeLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Parse datetime-local input to Date
 */
function parseDateTimeLocal(value: string): Date {
  return new Date(value);
}

export function OfferForm({
  offer,
  onSave,
  onCancel,
  timezone,
  isSubmitting = false,
}: OfferFormProps): JSX.Element {
  const [type, setType] = useState<OfferType>(offer?.type ?? "coupon");
  const [code] = useState(offer?.code ?? ""); // Read-only, no setter needed
  const [description, setDescription] = useState(offer?.description ?? "");
  const [validFrom, setValidFrom] = useState<Date | undefined>(
    offer?.validFrom ?? undefined
  );
  const [validUntil, setValidUntil] = useState<Date | undefined>(
    offer?.validUntil ?? undefined
  );
  const [errors, setErrors] = useState<FormErrors>({});

  /**
   * Validate form fields
   */
  function validateForm(): boolean {
    const newErrors: FormErrors = {};

    // Validate type
    if (!type) {
      newErrors.type = "Offer type is required";
    }

    // Validate description
    if (!description.trim()) {
      newErrors.description = "Description is required";
    }

    // Validate dates
    if (!validFrom) {
      newErrors.validFrom = "Start date is required";
    }

    if (!validUntil) {
      newErrors.validUntil = "End date is required";
    }

    if (validFrom && validUntil && validUntil <= validFrom) {
      newErrors.validUntil = "End date must be after start date";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  /**
   * Handle form submission
   */
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    if (!validFrom || !validUntil) {
      return;
    }

    try {
      await onSave({
        code: code.trim().toUpperCase(),
        type,
        description: description.trim(),
        validFrom,
        validUntil,
      });
    } catch (error) {
      console.error("Error saving offer:", error);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        {/* Offer Type */}
        <div className="space-y-2">
          <Label htmlFor="type">
            Offer Type <span className="text-destructive">*</span>
          </Label>
          <Select
            value={type}
            onValueChange={(value) => {
              setType(value as OfferType);
              if (errors.type) {
                setErrors({ ...errors, type: undefined });
              }
            }}
            disabled={isSubmitting}
          >
            <SelectTrigger id="type" className={errors.type ? "border-destructive" : ""}>
              <SelectValue placeholder="Select offer type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="coupon">Coupon ($ off)</SelectItem>
              <SelectItem value="discount">Discount (% off)</SelectItem>
              <SelectItem value="bogo">Buy One Get One</SelectItem>
              <SelectItem value="free-item">Free Item</SelectItem>
              <SelectItem value="happy-hour">Happy Hour</SelectItem>
            </SelectContent>
          </Select>
          {errors.type && (
            <p className="text-sm text-destructive">{errors.type}</p>
          )}
          <p className="text-sm text-muted-foreground">
            Choose the type of promotional offer
          </p>
        </div>

        {/* Offer Code (Read-only) */}
        <div className="space-y-2">
          <Label htmlFor="code">Offer Code</Label>
          <Input
            id="code"
            type="text"
            value={code}
            disabled
            className="bg-muted"
          />
          <p className="text-sm text-muted-foreground">
            Auto-generated unique identifier (8 characters)
          </p>
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="description">
            Description <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              if (errors.description) {
                setErrors({ ...errors, description: undefined });
              }
            }}
            placeholder="Get $5 off your next visit! Valid for dine-in only."
            rows={4}
            disabled={isSubmitting}
            className={errors.description ? "border-destructive" : ""}
          />
          {errors.description && (
            <p className="text-sm text-destructive">{errors.description}</p>
          )}
          <p className="text-sm text-muted-foreground">
            Describe your offer in natural language. This will be visible to customers.
          </p>
        </div>

        {/* Valid From */}
        <div className="space-y-2">
          <Label htmlFor="validFrom">
            Valid From <span className="text-destructive">*</span>
          </Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !validFrom && "text-muted-foreground",
                  errors.validFrom && "border-destructive"
                )}
                disabled={isSubmitting}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {formatDateTime(validFrom)}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={validFrom}
                onSelect={(date) => {
                  if (date) {
                    // Preserve time if editing, otherwise set to current time
                    const newDate = validFrom ? new Date(date) : new Date();
                    if (validFrom) {
                      newDate.setHours(validFrom.getHours());
                      newDate.setMinutes(validFrom.getMinutes());
                    }
                    setValidFrom(newDate);
                    if (errors.validFrom) {
                      setErrors({ ...errors, validFrom: undefined });
                    }
                  }
                }}
                disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                initialFocus
              />
              <div className="p-3 border-t">
                <Label htmlFor="validFromTime" className="text-xs">Time</Label>
                <Input
                  id="validFromTime"
                  type="time"
                  value={
                    validFrom
                      ? `${String(validFrom.getHours()).padStart(2, "0")}:${String(validFrom.getMinutes()).padStart(2, "0")}`
                      : "09:00"
                  }
                  onChange={(e) => {
                    const [hours, minutes] = e.target.value.split(":").map(Number);
                    const newDate = validFrom ? new Date(validFrom) : new Date();
                    newDate.setHours(hours, minutes, 0, 0);
                    setValidFrom(newDate);
                  }}
                  className="mt-1"
                />
              </div>
            </PopoverContent>
          </Popover>
          {errors.validFrom && (
            <p className="text-sm text-destructive">{errors.validFrom}</p>
          )}
          <p className="text-sm text-muted-foreground">
            Offer start date and time ({timezone})
          </p>
        </div>

        {/* Valid Until */}
        <div className="space-y-2">
          <Label htmlFor="validUntil">
            Valid Until <span className="text-destructive">*</span>
          </Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !validUntil && "text-muted-foreground",
                  errors.validUntil && "border-destructive"
                )}
                disabled={isSubmitting}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {formatDateTime(validUntil)}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={validUntil}
                onSelect={(date) => {
                  if (date) {
                    // Preserve time if editing, otherwise set to end of day
                    const newDate = validUntil ? new Date(date) : new Date();
                    if (validUntil) {
                      newDate.setHours(validUntil.getHours());
                      newDate.setMinutes(validUntil.getMinutes());
                    } else {
                      newDate.setHours(23, 59, 0, 0);
                    }
                    setValidUntil(newDate);
                    if (errors.validUntil) {
                      setErrors({ ...errors, validUntil: undefined });
                    }
                  }
                }}
                disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                initialFocus
              />
              <div className="p-3 border-t">
                <Label htmlFor="validUntilTime" className="text-xs">Time</Label>
                <Input
                  id="validUntilTime"
                  type="time"
                  value={
                    validUntil
                      ? `${String(validUntil.getHours()).padStart(2, "0")}:${String(validUntil.getMinutes()).padStart(2, "0")}`
                      : "23:59"
                  }
                  onChange={(e) => {
                    const [hours, minutes] = e.target.value.split(":").map(Number);
                    const newDate = validUntil ? new Date(validUntil) : new Date();
                    newDate.setHours(hours, minutes, 0, 0);
                    setValidUntil(newDate);
                  }}
                  className="mt-1"
                />
              </div>
            </PopoverContent>
          </Popover>
          {errors.validUntil && (
            <p className="text-sm text-destructive">{errors.validUntil}</p>
          )}
          <p className="text-sm text-muted-foreground">
            Offer end date and time ({timezone})
          </p>
        </div>
      </div>

      {/* Form Actions */}
      <div className="flex gap-4">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : offer ? "Update Offer" : "Create Offer"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
