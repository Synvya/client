/**
 * Reservations Page
 * 
 * Displays inbox of reservation requests and responses
 */

import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/state/useAuth";
import { useRelays } from "@/state/useRelays";
import { useReservations } from "@/state/useReservations";
import { useReservationActions } from "@/hooks/useReservationActions";
import { loadAndDecryptSecret } from "@/lib/secureStore";
import { skFromNsec } from "@/lib/nostrKeys";
import { markReservationArrived, isReservationArrived } from "@/lib/arrivedStorage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Inbox, Users, Calendar, Clock, MessageSquare, AlertCircle, Check, X, CalendarDays, RefreshCw } from "lucide-react";
import type { ReservationRequest, ReservationResponse, ReservationModificationRequest, ReservationModificationResponse } from "@/types/reservation";
import type { ReservationMessage } from "@/services/reservationService";
import type { ConversationThread } from "@/state/useReservations";
import { UserLink } from "@/components/UserLink";
import { unixAndTzidToIso8601, iso8601ToUnixAndTzid } from "@/lib/reservationTimeUtils";

/**
 * Formats a Unix timestamp and timezone for display in restaurant UI
 * Shows the time without timezone offset (restaurant knows their own timezone)
 */
function formatDateTimeWithTimezone(time: number, tzid: string): string {
  const isoTime = unixAndTzidToIso8601(time, tzid);
  // Parse ISO8601 string to extract components
  // Format: YYYY-MM-DDTHH:mm:ss±HH:MM
  const isoMatch = isoTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{2}):(\d{2})$/);
  
  if (!isoMatch) {
    // Fallback: try parsing as Date and show without timezone
    const date = new Date(isoTime);
    return date.toLocaleString(undefined, { 
      dateStyle: 'medium', 
      timeStyle: 'short'
    });
  }
  
  const [, year, month, day, hour, minute] = isoMatch;
  
  // Format the date
  const dateStr = new Date(parseInt(year), parseInt(month) - 1, parseInt(day)).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
  
  // Format the time (keep in 12-hour format)
  let hourNum = parseInt(hour);
  const minuteNum = parseInt(minute);
  const amPm = hourNum >= 12 ? 'PM' : 'AM';
  hourNum = hourNum % 12;
  if (hourNum === 0) hourNum = 12;
  const timeStr = `${hourNum}:${minute.toString().padStart(2, '0')} ${amPm}`;
  
  // Show just the date and time (restaurant knows their own timezone)
  return `${dateStr} at ${timeStr}`;
}

export function ReservationsPage(): JSX.Element {
  const pubkey = useAuth((state) => state.pubkey);
  const relays = useRelays((state) => state.relays);
  const {
    isConnected,
    error: subscriptionError,
    startListening,
    stopListening,
    getThreads,
    messages,
  } = useReservations();
  
  const { acceptReservation, declineReservation } = useReservationActions();
  const allThreads = getThreads();
  const loadPersistedMessages = useReservations((state) => state.loadPersistedMessages);
  const isInitialized = useReservations((state) => state.isInitialized);
  const merchantPubkey = useReservations((state) => state.merchantPubkey);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const processedModificationResponsesRef = useRef<Set<string>>(new Set());
  const [isProcessingAutoReply, setIsProcessingAutoReply] = useState(false);

  // Helper function to extract display time from thread
  const getDisplayTimeForThread = (thread: ConversationThread): string => {
    const request = thread.initialRequest.payload as ReservationRequest;
    // Search backwards through messages for the latest confirmed time
    for (let i = thread.messages.length - 1; i >= 0; i--) {
      const msg = thread.messages[i];
      if (msg.type === "response") {
        const response = msg.payload as ReservationResponse;
        if (response.status === "confirmed" && response.time !== null && response.time !== undefined && response.tzid) {
          return unixAndTzidToIso8601(response.time, response.tzid);
        }
      } else if (msg.type === "modification-response") {
        const response = msg.payload as ReservationModificationResponse;
        if (response.status === "confirmed" && response.time !== null && response.time !== undefined && response.tzid) {
          return unixAndTzidToIso8601(response.time, response.tzid);
        }
      } else if (msg.type === "modification-request") {
        const modRequest = msg.payload as ReservationModificationRequest;
        if (modRequest.time && modRequest.time !== null && modRequest.time !== undefined && modRequest.tzid) {
          return unixAndTzidToIso8601(modRequest.time, modRequest.tzid);
        }
      }
    }
    // Handle null/undefined time (e.g., declined/cancelled reservations)
    if (request.time === null || request.time === undefined) {
      return "No time set";
    }
    return unixAndTzidToIso8601(request.time, request.tzid);
  };

  // Helper function to get thread status
  const getThreadStatusForFilter = (thread: ConversationThread): string => {
    const latestMessage = thread.latestMessage;
    if (latestMessage.type === "response") {
      const response = latestMessage.payload as ReservationResponse;
      return response.status;
    }
    if (latestMessage.type === "modification-response") {
      const response = latestMessage.payload as ReservationModificationResponse;
      return response.status;
    }
    if (latestMessage.type === "modification-request") {
      return "pending";
    }
    if (latestMessage.type === "request") {
      return "pending";
    }
    return "pending";
  };

  // Filter reservations per Guidance.md line 116:
  // Only show reservations with date in future or current day
  // Only show statuses: Confirmed, Modification Requested, or Modification Confirmed
  const isReservationActive = (thread: ConversationThread): boolean => {
    // Get display time from thread
    const displayTime = getDisplayTimeForThread(thread);
    const reservationDate = new Date(displayTime);
    
    // Check if date is today or future
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (reservationDate < today) return false;
    
    // Check if status is active (confirmed or pending covers all active states)
    const status = getThreadStatusForFilter(thread);
    return status === "confirmed" || status === "pending";
  };

  // Apply filter to show only active reservations
  const threads = allThreads.filter(isReservationActive);

  // Auto-reply to modification responses (kind:9904)
  // When restaurant receives a modification response, automatically send a reservation response (kind:9902)
  useEffect(() => {
    if (!merchantPubkey || !messages.length || isProcessingAutoReply) return;

    const handleAutoReply = async () => {
      setIsProcessingAutoReply(true);
      
      try {
        for (const message of messages) {
          // Only process modification-response messages sent TO the merchant (not from the merchant)
          if (message.type === "modification-response" && message.senderPubkey !== merchantPubkey) {
            // Skip if already processed
            if (processedModificationResponsesRef.current.has(message.rumor.id)) {
              continue;
            }

            const modificationResponse = message.payload as ReservationModificationResponse;
            
            // Find the root e tag that points to the unsigned 9901 rumor ID
            const rootTag = message.rumor.tags.find(tag => tag[0] === "e" && tag[3] === "root");
            if (!rootTag) {
              continue;
            }
            
            const rootRumorId = rootTag[1];

            // Find the original 9901 request that started this thread
            const originalRequest = messages.find(m => 
              m.type === "request" && 
              m.rumor.kind === 9901 && 
              m.rumor.id === rootRumorId
            );
            
            if (!originalRequest) {
              continue;
            }

            // Verify the original request is the correct kind
            if (originalRequest.rumor.kind !== 9901) {
              continue;
            }

            // Check if we've already sent a response for this modification-response
            // by looking for a response message that references the same root
            const alreadyReplied = messages.some(m => {
              if (m.type !== "response") return false;
              if (m.rumor.kind !== 9902) return false;
              const responseRootTag = m.rumor.tags.find(tag => tag[0] === "e" && tag[3] === "root");
              return responseRootTag && responseRootTag[1] === rootRumorId && 
                     m.rumor.created_at >= message.rumor.created_at;
            });

            if (alreadyReplied) {
              processedModificationResponsesRef.current.add(message.rumor.id);
              continue;
            }

            try {
              // Mark as processed BEFORE sending to prevent duplicates
              processedModificationResponsesRef.current.add(message.rumor.id);

              // Send reservation response with same status as modification response
              // Per NIP-RR: when restaurant receives kind:9904, auto-reply with kind:9902
              // The response should use the iso_time from the modification response if confirmed
              if (modificationResponse.status === "confirmed") {
                await acceptReservation(originalRequest, {
                  message: modificationResponse.message,
                  time: modificationResponse.time || undefined,
                  tzid: modificationResponse.tzid,
                });
              } else if (modificationResponse.status === "declined") {
                await declineReservation(originalRequest, {
                  message: modificationResponse.message,
                });
              }
            } catch (error) {
              console.error("Failed to auto-reply to modification response:", error);
              // Remove from processed set on error so we can retry
              processedModificationResponsesRef.current.delete(message.rumor.id);
            }
          }
        }
      } finally {
        setIsProcessingAutoReply(false);
      }
    };

    handleAutoReply();
  }, [messages, merchantPubkey, acceptReservation, declineReservation, isProcessingAutoReply]);

  // Load persisted messages immediately on mount
  useEffect(() => {
    if (!isInitialized) {
      loadPersistedMessages();
    }
  }, [isInitialized, loadPersistedMessages]);

  useEffect(() => {
    if (!pubkey || !relays.length) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        // Load private key
        const nsec = await loadAndDecryptSecret();
        if (!nsec) {
          throw new Error("Unable to load private key");
        }

        if (cancelled) return;

        const privateKey = skFromNsec(nsec);
        startListening(privateKey, pubkey, relays);
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Failed to start listening";
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      stopListening();
    };
  }, [pubkey, relays, startListening, stopListening]);

  if (loading) {
    return (
      <div className="container flex min-h-[400px] items-center justify-center py-10">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Connecting to relays...</p>
        </div>
      </div>
    );
  }

  if (error || subscriptionError) {
    return (
      <div className="container py-10">
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div>
              <h3 className="font-semibold text-destructive">Connection Error</h3>
              <p className="mt-1 text-sm text-destructive/90">
                {error || subscriptionError}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reservations</h1>
        </div>
        <div className="flex items-center gap-2">
          {isConnected ? (
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <div className="h-2 w-2 rounded-full bg-emerald-600" />
              <span>Connected</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-2 w-2 rounded-full bg-muted-foreground" />
              <span>Disconnected</span>
            </div>
          )}
        </div>
      </div>

      {threads.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="rounded-full bg-muted p-4">
              <Inbox className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-semibold">No reservations yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Reservation requests from AI agents will appear here
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {threads.map((thread) => (
            <ConversationThreadCard
              key={thread.rootEventId}
              thread={thread}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ConversationThreadCardProps {
  thread: ConversationThread;
}

function ConversationThreadCard({ thread }: ConversationThreadCardProps): JSX.Element {
  const { initialRequest, latestMessage, messages, messageCount, partnerPubkey, rootEventId } = thread;
  const request = initialRequest.payload as ReservationRequest;
  const latestTimestamp = new Date(latestMessage.rumor.created_at * 1000);
  const [isArrived, setIsArrived] = useState(false);
  const [isCheckingArrived, setIsCheckingArrived] = useState(true);

  // Find the latest confirmed time to display in the top card
  // This should be the latest confirmed response's iso_time, or fall back to the original request time
  const getDisplayTime = (): string => {
    // Search backwards through messages for the latest confirmed time
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.type === "response") {
        const response = msg.payload as ReservationResponse;
        if (response.status === "confirmed" && response.time !== null && response.tzid) {
          return unixAndTzidToIso8601(response.time, response.tzid);
        }
      } else if (msg.type === "modification-response") {
        const response = msg.payload as ReservationModificationResponse;
        if (response.status === "confirmed" && response.time !== null && response.tzid) {
          return unixAndTzidToIso8601(response.time, response.tzid);
        }
      } else if (msg.type === "modification-request") {
        const modRequest = msg.payload as ReservationModificationRequest;
        if (modRequest.time && modRequest.tzid) {
          return unixAndTzidToIso8601(modRequest.time, modRequest.tzid);
        }
      }
    }
    // Fall back to original request time
    return unixAndTzidToIso8601(request.time, request.tzid);
  };

  const displayTime = getDisplayTime();

  // Determine thread status based on latest message
  const getThreadStatus = () => {
    // If marked as arrived, show arrived status
    if (isArrived) {
      return "arrived";
    }
    if (latestMessage.type === "response") {
      const response = latestMessage.payload as ReservationResponse;
      return response.status;
    }
    if (latestMessage.type === "modification-response") {
      const response = latestMessage.payload as ReservationModificationResponse;
      return response.status;
    }
    if (latestMessage.type === "modification-request") {
      // If modification request is from merchant (restaurant), it's pending customer response
      // If modification request is from customer, it's pending restaurant response
      return "pending";
    }
    if (latestMessage.type === "request") {
      return "pending"; // Awaiting restaurant's response
    }
    return "pending";
  };

  const status = getThreadStatus();

  const statusColors = {
    pending: "bg-amber-500/10 text-amber-600 border-amber-500/40",
    confirmed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/40",
    declined: "bg-red-500/10 text-red-600 border-red-500/40",
    cancelled: "bg-gray-500/10 text-gray-600 border-gray-500/40",
    arrived: "bg-blue-500/10 text-blue-600 border-blue-500/40",
  };

  // Format phone number to (xxx) xxx-xxxx
  const formatPhoneNumber = (phone: string): string => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone; // Return as-is if not 10 digits
  };

  // Collect only customer messages (not restaurant messages)
  let lastCustomerMessage = "";
  messages.forEach((message) => {
    // Only include messages from the customer (partnerPubkey)
    if (message.senderPubkey === partnerPubkey) {
      if (message.type === "request") {
        const req = message.payload as ReservationRequest;
        if (req.message) lastCustomerMessage = req.message;
      } else if (message.type === "modification-request") {
        const modReq = message.payload as ReservationModificationRequest;
        if (modReq.message) lastCustomerMessage = modReq.message;
      }
    }
  });

  // Check if reservation has been marked as arrived
  useEffect(() => {
    let mounted = true;
    setIsCheckingArrived(true);
    isReservationArrived(rootEventId)
      .then((arrived) => {
        if (mounted) {
          setIsArrived(arrived);
          setIsCheckingArrived(false);
        }
      })
      .catch((error) => {
        console.error("Failed to check arrived status:", error);
        if (mounted) {
          setIsCheckingArrived(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [rootEventId]);

  // Check if we should show "Arrived" button
  const reservationTime = new Date(displayTime);
  const now = new Date();
  const oneHourBefore = new Date(reservationTime.getTime() - 60 * 60 * 1000);
  const showArrivedButton = status === "confirmed" && !isArrived && now >= oneHourBefore;

  return (
    <div className="rounded-lg border bg-card">
      {/* Thread Summary - Always Visible */}
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-primary/10 p-2">
                  <Users className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">
                    {request.party_size} guests • {formatDateTimeWithTimezone(request.time, request.tzid)}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <UserLink pubkey={partnerPubkey} contactName={request.name} />
                    {request.telephone && (
                      <>
                        <span>•</span>
                        <a 
                          href={request.telephone.startsWith("tel:") ? request.telephone : `tel:${request.telephone}`}
                          className="text-primary hover:underline"
                        >
                          {request.telephone.replace(/^tel:/, "")}
                        </a>
                      </>
                    )}
                    {request.email && (
                      <>
                        <span>•</span>
                        <a 
                          href={request.email.startsWith("mailto:") ? request.email : `mailto:${request.email}`}
                          className="text-primary hover:underline"
                        >
                          {request.email.replace(/^mailto:/, "")}
                        </a>
                      </>
                    )}
                  </div>
                  {lastCustomerMessage && (
                    <div className="mt-2">
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium">Notes:</span> {lastCustomerMessage}
                      </p>
                    </div>
                  )}
                </div>
              </div>
              <div className={`rounded-full border px-3 py-1 text-xs font-medium ${statusColors[status]}`}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Action buttons for pending requests */}
      {latestMessage.type === "request" && status === "pending" && (
        <div className="border-t p-6">
          <ReservationMessageCard message={latestMessage} />
        </div>
      )}

      {/* Arrived button - show 1 hour before reservation time for confirmed reservations */}
      {showArrivedButton && (
        <div className="border-t p-4 bg-muted/10">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Mark customer as arrived
            </p>
            <Button 
              variant="default" 
              size="sm"
              onClick={async () => {
                try {
                  await markReservationArrived(rootEventId);
                  setIsArrived(true);
                } catch (error) {
                  console.error("Failed to mark reservation as arrived:", error);
                }
              }}
            >
              Arrived
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ConversationMessageItemProps {
  message: ReservationMessage;
  isLatest: boolean;
}

function ConversationMessageItem({ message, isLatest }: ConversationMessageItemProps): JSX.Element {
  const { type, payload, senderPubkey, rumor } = message;
  const timestamp = new Date(rumor.created_at * 1000);

  if (type === "request") {
    const request = payload as ReservationRequest;
    return (
      <div className={`rounded-lg border bg-card p-4 ${isLatest ? "ring-2 ring-primary/20" : ""}`}>
        <div className="flex items-start gap-3">
          <Users className="h-4 w-4 mt-1 text-primary" />
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Request from <UserLink pubkey={senderPubkey} contactName={request.name} /></span>
              <span className="text-xs text-muted-foreground">{timestamp.toLocaleString()}</span>
            </div>
            <div className="text-sm">
              <p>{request.party_size} guests on {formatDateTimeWithTimezone(request.time, request.tzid)}</p>
              {request.message && <p className="mt-1 text-muted-foreground">{request.message}</p>}
              {request.telephone && (
                <p className="mt-1">
                  <span className="text-muted-foreground">Phone: </span>
                  <a 
                    href={request.telephone.startsWith("tel:") ? request.telephone : `tel:${request.telephone}`}
                    className="text-primary hover:underline"
                  >
                    {request.telephone.replace(/^tel:/, "")}
                  </a>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (type === "modification-request") {
    const request = payload as ReservationModificationRequest;
    return (
      <div className={`rounded-lg border bg-card p-4 border-blue-200 ${isLatest ? "ring-2 ring-blue-300" : ""}`}>
        <div className="flex items-start gap-3">
          <RefreshCw className="h-4 w-4 mt-1 text-blue-600" />
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Modification Request from <UserLink pubkey={senderPubkey} contactName={request.name} /></span>
              <span className="text-xs text-muted-foreground">{timestamp.toLocaleString()}</span>
            </div>
            <div className="text-sm">
              <p>{request.party_size} guests on {formatDateTimeWithTimezone(request.time, request.tzid)}</p>
              {request.message && <p className="mt-1 text-muted-foreground">{request.message}</p>}
              {request.telephone && (
                <p className="mt-1">
                  <span className="text-muted-foreground">Phone: </span>
                  <a 
                    href={request.telephone.startsWith("tel:") ? request.telephone : `tel:${request.telephone}`}
                    className="text-primary hover:underline"
                  >
                    {request.telephone.replace(/^tel:/, "")}
                  </a>
                </p>
              )}
              {request.email && (
                <p className="mt-1">
                  <span className="text-muted-foreground">Email: </span>
                  <a 
                    href={request.email.startsWith("mailto:") ? request.email : `mailto:${request.email}`}
                    className="text-primary hover:underline"
                  >
                    {request.email.replace(/^mailto:/, "")}
                  </a>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (type === "modification-response") {
    const response = payload as ReservationModificationResponse;
    return (
      <div className={`rounded-lg border bg-card p-4 border-blue-200 ${isLatest ? "ring-2 ring-blue-300" : ""}`}>
        <div className="flex items-start gap-3">
          <RefreshCw className="h-4 w-4 mt-1 text-blue-600" />
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                Modification Response: {response.status.charAt(0).toUpperCase() + response.status.slice(1)}
              </span>
              <span className="text-xs text-muted-foreground">{timestamp.toLocaleString()}</span>
            </div>
            <div className="text-sm">
              {response.status === "confirmed" && response.time !== null && response.tzid && (
                <p>Confirmed for {formatDateTimeWithTimezone(response.time, response.tzid)}</p>
              )}
              {response.status === "declined" && <p className="text-destructive">Declined</p>}
              {response.message && <p className="mt-1 text-muted-foreground">{response.message}</p>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Regular response (type === "response")
  const response = payload as ReservationResponse;
  return (
    <div className={`rounded-lg border bg-card p-4 ${isLatest ? "ring-2 ring-primary/20" : ""}`}>
      <div className="flex items-start gap-3">
        <MessageSquare className="h-4 w-4 mt-1 text-muted-foreground" />
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              Response: {response.status.charAt(0).toUpperCase() + response.status.slice(1)}
            </span>
            <span className="text-xs text-muted-foreground">{timestamp.toLocaleString()}</span>
          </div>
          <div className="text-sm">
            {response.status === "confirmed" && response.time !== null && response.tzid && (
              <p>Confirmed for {formatDateTimeWithTimezone(response.time, response.tzid)}</p>
            )}
            {response.status === "declined" && <p className="text-destructive">Declined</p>}
            {response.message && <p className="mt-1 text-muted-foreground">{response.message}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

interface ReservationMessageCardProps {
  message: ReservationMessage;
  compact?: boolean;
}

function ReservationMessageCard({ message, compact = false }: ReservationMessageCardProps): JSX.Element {
  const { type, payload, senderPubkey, rumor } = message;
  const timestamp = new Date(rumor.created_at * 1000);

  const {
    state: actionState,
    resetState,
    acceptReservation,
    declineReservation,
    sendModificationRequest,
    acceptModification,
    declineModification,
  } = useReservationActions();

  const [acceptDialogOpen, setAcceptDialogOpen] = useState(false);
  const [declineDialogOpen, setDeclineDialogOpen] = useState(false);
  const [modifyDialogOpen, setModifyDialogOpen] = useState(false);

  const [tableNumber, setTableNumber] = useState("");
  const [acceptMessage, setAcceptMessage] = useState("");
  const [declineReason, setDeclineReason] = useState("");
  const [modifyTime, setModifyTime] = useState("");
  const [modifyPartySize, setModifyPartySize] = useState("");
  const [modifyNotes, setModifyNotes] = useState("");
  
  // Time picker state (for restaurant proposing new time)
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedHour, setSelectedHour] = useState<number>(12);
  const [selectedMinute, setSelectedMinute] = useState<number>(0);
  const [selectedAmPm, setSelectedAmPm] = useState<"AM" | "PM">("PM");

  const handleAccept = async () => {
    try {
      await acceptReservation(message, {
        message: acceptMessage || undefined,
      });
      setAcceptDialogOpen(false);
      setTableNumber("");
      setAcceptMessage("");
    } catch (error) {
      // Error is handled in the hook state
    }
  };

  const handleDecline = async () => {
    try {
      await declineReservation(message, {
        message: declineReason || undefined,
      });
      setDeclineDialogOpen(false);
      setDeclineReason("");
    } catch (error) {
      // Error is handled in the hook state
    }
  };


  const handleSendModificationRequest = async () => {
    if (!selectedDate || !modifyPartySize) return;
    try {
      // Convert selected date/time to ISO8601 format with timezone offset
      const [year, month, day] = selectedDate.split('-').map(Number);
      let hour24 = selectedHour;
      if (selectedAmPm === "PM" && hour24 !== 12) {
        hour24 += 12;
      } else if (selectedAmPm === "AM" && hour24 === 12) {
        hour24 = 0;
      }
      
      // Create date object in local timezone
      const localDate = new Date(year, month - 1, day, hour24, selectedMinute);
      
      // Format as ISO8601 with timezone offset (not UTC)
      // Get timezone offset in minutes and convert to +/-HH:MM format
      const offsetMinutes = -localDate.getTimezoneOffset(); // Note: getTimezoneOffset returns opposite sign
      const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
      const offsetMins = Math.abs(offsetMinutes) % 60;
      const offsetSign = offsetMinutes >= 0 ? '+' : '-';
      const offsetString = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMins).padStart(2, '0')}`;
      
      // Format date components
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const timeStr = `${String(hour24).padStart(2, '0')}:${String(selectedMinute).padStart(2, '0')}:00`;
      const isoTime = `${dateStr}T${timeStr}${offsetString}`;
      const { unixTimestamp, tzid } = iso8601ToUnixAndTzid(isoTime);
      
      await sendModificationRequest(message, {
        party_size: parseInt(modifyPartySize),
        time: unixTimestamp,
        tzid,
        message: modifyNotes || undefined,
      });
      setModifyDialogOpen(false);
      setSelectedDate("");
      setSelectedHour(12);
      setSelectedMinute(0);
      setSelectedAmPm("PM");
      setModifyPartySize("");
      setModifyNotes("");
    } catch (error) {
      // Error is handled in the hook state
    }
  };

  const handleAcceptModification = async () => {
    try {
      await acceptModification(message, {
        message: acceptMessage || undefined,
      });
      setAcceptDialogOpen(false);
      setTableNumber("");
      setAcceptMessage("");
    } catch (error) {
      // Error is handled in the hook state
    }
  };

  const handleDeclineModification = async () => {
    try {
      await declineModification(message, {
        message: declineReason || undefined,
      });
      setDeclineDialogOpen(false);
      setDeclineReason("");
    } catch (error) {
      // Error is handled in the hook state
    }
  };

  if (type === "request") {
    const request = payload as ReservationRequest;
    return (
      <>
        <div className="rounded-lg border bg-card p-6 transition-shadow hover:shadow-md">
          {actionState.success && (
            <div className="mb-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-600">
              Response sent successfully!
            </div>
          )}
          {actionState.error && (
            <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {actionState.error}
            </div>
          )}
          
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-3">
              {/* Header */}
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-primary/10 p-2">
                  <Users className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">New Reservation Request</h3>
                  <p className="text-xs text-muted-foreground">
                    From: <UserLink pubkey={senderPubkey} contactName={request.name} />
                  </p>
                </div>
              </div>

              {/* Details */}
              <div className="grid gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{request.party_size} guests</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>{formatDateTimeWithTimezone(request.time, request.tzid)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Time shown in restaurant's timezone</span>
                </div>
                {request.message && (
                  <div className="flex items-start gap-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">{request.message}</span>
                  </div>
                )}
                {request.telephone && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Phone:</span>
                    <a 
                      href={request.telephone.startsWith("tel:") ? request.telephone : `tel:${request.telephone}`}
                      className="text-primary hover:underline"
                    >
                      {request.telephone.replace(/^tel:/, "")}
                    </a>
                  </div>
                )}
                {request.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Email:</span>
                    <a 
                      href={request.email.startsWith("mailto:") ? request.email : `mailto:${request.email}`}
                      className="text-primary hover:underline"
                    >
                      {request.email.replace(/^mailto:/, "")}
                    </a>
                  </div>
                )}
              </div>

              {/* Timestamp */}
              <div className="text-xs text-muted-foreground">
                Received {timestamp.toLocaleString()}
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2">
              <Button
                size="sm"
                variant="default"
                onClick={() => setAcceptDialogOpen(true)}
                disabled={actionState.loading}
              >
                <Check className="mr-1 h-3 w-3" />
                Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  // Initialize time picker with original request time
                  const isoTime = unixAndTzidToIso8601(request.time, request.tzid);
                  const originalDate = new Date(isoTime);
                  const year = originalDate.getFullYear();
                  const month = String(originalDate.getMonth() + 1).padStart(2, '0');
                  const day = String(originalDate.getDate()).padStart(2, '0');
                  setSelectedDate(`${year}-${month}-${day}`);
                  
                  let hour = originalDate.getHours();
                  const minute = originalDate.getMinutes();
                  const amPm = hour >= 12 ? "PM" : "AM";
                  hour = hour % 12;
                  if (hour === 0) hour = 12;
                  
                  setSelectedHour(hour);
                  setSelectedMinute(Math.round(minute / 15) * 15); // Round to nearest 15 minutes
                  setSelectedAmPm(amPm);
                  setModifyPartySize(request.party_size.toString());
                  setModifyNotes(request.message || "");
                  setModifyDialogOpen(true);
                }}
                disabled={actionState.loading}
              >
                <CalendarDays className="mr-1 h-3 w-3" />
                Propose New Time
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDeclineDialogOpen(true)}
                disabled={actionState.loading}
              >
                <X className="mr-1 h-3 w-3" />
                Decline
              </Button>
            </div>
          </div>
        </div>

        {/* Accept Dialog */}
        <Dialog open={acceptDialogOpen} onOpenChange={setAcceptDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Accept Reservation</DialogTitle>
              <DialogDescription>
                Confirm the reservation for {request.party_size} guests on{" "}
                {formatDateTimeWithTimezone(request.time, request.tzid)}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="table">Table Number (optional)</Label>
                <Input
                  id="table"
                  placeholder="e.g., A4, 12, Patio 3"
                  value={tableNumber}
                  onChange={(e) => setTableNumber(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="accept-message">Message (optional)</Label>
                <Textarea
                  id="accept-message"
                  placeholder="Any additional notes for the guest..."
                  value={acceptMessage}
                  onChange={(e) => setAcceptMessage(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setAcceptDialogOpen(false)}
                disabled={actionState.loading}
              >
                Cancel
              </Button>
              <Button onClick={handleAccept} disabled={actionState.loading}>
                {actionState.loading ? "Sending..." : "Confirm Acceptance"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Decline Dialog */}
        <Dialog open={declineDialogOpen} onOpenChange={setDeclineDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Decline Reservation</DialogTitle>
              <DialogDescription>
                Decline the reservation request for {request.party_size} guests on{" "}
                {formatDateTimeWithTimezone(request.time, request.tzid)}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="decline-reason">Reason (optional)</Label>
                <Textarea
                  id="decline-reason"
                  placeholder="e.g., Fully booked, closed that day..."
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeclineDialogOpen(false)}
                disabled={actionState.loading}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDecline}
                disabled={actionState.loading}
              >
                {actionState.loading ? "Sending..." : "Decline Request"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Propose New Time Dialog */}
        <Dialog open={modifyDialogOpen} onOpenChange={setModifyDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Propose New Time</DialogTitle>
              <DialogDescription>
                Suggest an alternative time for this reservation request
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              {/* Date Picker */}
              <div className="grid gap-2">
                <Label htmlFor="modify-date">Date *</Label>
                <Input
                  id="modify-date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  required
                />
              </div>

              {/* Time Picker */}
              <div className="grid gap-2">
                <Label>Time *</Label>
                <div className="flex items-center gap-2">
                  {/* Hour Select */}
                  <select
                    value={selectedHour}
                    onChange={(e) => setSelectedHour(parseInt(e.target.value))}
                    className="flex h-10 w-20 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((hour) => (
                      <option key={hour} value={hour}>
                        {hour}
                      </option>
                    ))}
                  </select>

                  <span className="text-lg font-semibold">:</span>

                  {/* Minute Select */}
                  <select
                    value={selectedMinute}
                    onChange={(e) => setSelectedMinute(parseInt(e.target.value))}
                    className="flex h-10 w-20 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {[0, 15, 30, 45].map((minute) => (
                      <option key={minute} value={minute}>
                        {String(minute).padStart(2, '0')}
                      </option>
                    ))}
                  </select>

                  {/* AM/PM Select */}
                  <select
                    value={selectedAmPm}
                    onChange={(e) => setSelectedAmPm(e.target.value as "AM" | "PM")}
                    className="flex h-10 w-24 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </select>
                </div>
              </div>

              {/* Party Size */}
              <div className="grid gap-2">
                <Label htmlFor="modify-party-size">Party Size *</Label>
                <Input
                  id="modify-party-size"
                  type="number"
                  min="1"
                  max="20"
                  value={modifyPartySize}
                  onChange={(e) => setModifyPartySize(e.target.value)}
                  required
                />
              </div>

              {/* Notes */}
              <div className="grid gap-2">
                <Label htmlFor="modify-notes">Notes (optional)</Label>
                <Textarea
                  id="modify-notes"
                  placeholder="Any additional notes for the guest..."
                  value={modifyNotes}
                  onChange={(e) => setModifyNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setModifyDialogOpen(false);
                  setSelectedDate("");
                  setSelectedHour(12);
                  setSelectedMinute(0);
                  setSelectedAmPm("PM");
                  setModifyPartySize("");
                  setModifyNotes("");
                }}
                disabled={actionState.loading}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSendModificationRequest}
                disabled={actionState.loading || !selectedDate || !modifyPartySize}
              >
                {actionState.loading ? "Sending..." : "Send Proposal"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </>
    );
  }

  if (type === "modification-request") {
    const request = payload as ReservationModificationRequest;
    return (
      <>
        <div className="rounded-lg border bg-card p-6 border-blue-200 transition-shadow hover:shadow-md">
          {actionState.success && (
            <div className="mb-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-600">
              Modification response sent successfully!
            </div>
          )}
          {actionState.error && (
            <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {actionState.error}
            </div>
          )}
          
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-3">
              {/* Header */}
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-blue-100 p-2">
                  <RefreshCw className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold">Modification Request</h3>
                  <p className="text-xs text-muted-foreground">
                    From: <UserLink pubkey={senderPubkey} contactName={request.name} />
                  </p>
                </div>
              </div>

              {/* Details */}
              <div className="grid gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{request.party_size} guests</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>{formatDateTimeWithTimezone(request.time, request.tzid)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Time shown in restaurant's timezone</span>
                </div>
                {request.message && (
                  <div className="flex items-start gap-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">{request.message}</span>
                  </div>
                )}
                {request.telephone && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Phone:</span>
                    <a 
                      href={request.telephone.startsWith("tel:") ? request.telephone : `tel:${request.telephone}`}
                      className="text-primary hover:underline"
                    >
                      {request.telephone.replace(/^tel:/, "")}
                    </a>
                  </div>
                )}
              </div>

              {/* Timestamp */}
              <div className="text-xs text-muted-foreground">
                Received {timestamp.toLocaleString()}
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2">
              <Button
                size="sm"
                variant="default"
                onClick={() => setAcceptDialogOpen(true)}
                disabled={actionState.loading}
              >
                <Check className="mr-1 h-3 w-3" />
                Accept
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setDeclineDialogOpen(true)}
                disabled={actionState.loading}
              >
                <X className="mr-1 h-3 w-3" />
                Decline
              </Button>
            </div>
          </div>
        </div>

        {/* Accept Dialog */}
        <Dialog open={acceptDialogOpen} onOpenChange={setAcceptDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Accept Modification</DialogTitle>
              <DialogDescription>
                Confirm the modification for {request.party_size} guests on{" "}
                {new Date(unixAndTzidToIso8601(request.time, request.tzid)).toLocaleString()}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="table-mod">Table Number (optional)</Label>
                <Input
                  id="table-mod"
                  placeholder="e.g., A4, 12, Patio 3"
                  value={tableNumber}
                  onChange={(e) => setTableNumber(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="accept-message-mod">Message (optional)</Label>
                <Textarea
                  id="accept-message-mod"
                  placeholder="Any additional notes for the guest..."
                  value={acceptMessage}
                  onChange={(e) => setAcceptMessage(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setAcceptDialogOpen(false)}
                disabled={actionState.loading}
              >
                Cancel
              </Button>
              <Button onClick={handleAcceptModification} disabled={actionState.loading}>
                {actionState.loading ? "Sending..." : "Confirm Acceptance"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Decline Dialog */}
        <Dialog open={declineDialogOpen} onOpenChange={setDeclineDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Decline Modification</DialogTitle>
              <DialogDescription>
                Decline the modification request for {request.party_size} guests on{" "}
                {new Date(unixAndTzidToIso8601(request.time, request.tzid)).toLocaleString()}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="decline-reason-mod">Reason (optional)</Label>
                <Textarea
                  id="decline-reason-mod"
                  placeholder="e.g., Time not available..."
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeclineDialogOpen(false)}
                disabled={actionState.loading}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeclineModification}
                disabled={actionState.loading}
              >
                {actionState.loading ? "Sending..." : "Decline Modification"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Response message
  if (type === "modification-response") {
    const response = payload as ReservationModificationResponse;
    return (
      <div className="rounded-lg border bg-card p-6 border-blue-200">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-blue-100 p-2">
            <RefreshCw className="h-4 w-4 text-blue-600" />
          </div>
          <div className="flex-1 space-y-2">
            <div>
              <h3 className="font-semibold">
                Modification Response: {response.status.charAt(0).toUpperCase() + response.status.slice(1)}
              </h3>
              <p className="text-xs text-muted-foreground">
                To: <UserLink pubkey={senderPubkey} />
              </p>
            </div>
            
            {response.status === "confirmed" && response.time !== null && response.tzid && (
            <div className="text-sm">
              <p>Confirmed for {formatDateTimeWithTimezone(response.time, response.tzid)}</p>
            </div>
            )}
            
            {response.status === "declined" && (
              <div className="text-sm">
                <p className="text-destructive">Declined</p>
                {response.message && <p className="text-muted-foreground">{response.message}</p>}
              </div>
            )}
            
            {response.message && response.status !== "declined" && (
              <p className="text-sm text-muted-foreground">{response.message}</p>
            )}
            
            <div className="text-xs text-muted-foreground">
              Sent {timestamp.toLocaleString()}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Regular response (type === "response")
  const response = payload as ReservationResponse;
  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-muted p-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 space-y-2">
          <div>
            <h3 className="font-semibold">
              Response: {response.status.charAt(0).toUpperCase() + response.status.slice(1)}
            </h3>
            <p className="text-xs text-muted-foreground">
              To: <UserLink pubkey={senderPubkey} />
            </p>
          </div>
          
          {response.status === "confirmed" && response.time !== null && response.tzid && (
            <div className="text-sm">
              <p>Confirmed for {formatDateTimeWithTimezone(response.time, response.tzid)}</p>
            </div>
          )}
          
          {response.status === "declined" && (
            <div className="text-sm">
              <p className="text-destructive">Declined</p>
              {response.message && <p className="text-muted-foreground">{response.message}</p>}
            </div>
          )}
          
          {response.status === "cancelled" && (
            <div className="text-sm text-muted-foreground">
              <p>Reservation cancelled</p>
              {response.message && <p>{response.message}</p>}
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            Sent {timestamp.toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}

