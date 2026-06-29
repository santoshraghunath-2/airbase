import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10)
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === "1")
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return phone;
}

export function initials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

export function jobStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    unassigned:  "Unassigned",
    scheduled:   "Scheduled",
    dispatched:  "Dispatched",
    en_route:    "En Route",
    arrived:     "Arrived",
    in_progress: "In Progress",
    completed:   "Completed",
    invoiced:    "Invoiced",
    cancelled:   "Cancelled",
    no_show:     "No Show",
  };
  return labels[status] ?? status;
}

// Warm-palette badge classes — replaces the old blue/amber/green defaults
export function jobStatusColor(status: string): string {
  const colors: Record<string, string> = {
    unassigned:  "bg-waiting-bg text-waiting-text border-waiting-border",
    scheduled:   "bg-[#FEFCF9] text-[#6F6658] border-[#E6DECF]",
    dispatched:  "bg-ai-chip-bg text-ai-ink border-ai-tint-border",
    en_route:    "bg-[#F0F4EC] text-[#4A6647] border-[#C8DFCA]",
    arrived:     "bg-confirmed-bg text-confirmed-text border-confirmed-border",
    in_progress: "bg-confirmed-bg text-confirmed-text border-confirmed-border",
    completed:   "bg-[#F0F4EC] text-[#292420] border-[#C8DFCA]",
    invoiced:    "bg-[#FEFCF9] text-[#9A9082] border-[#E6DECF]",
    cancelled:   "bg-[#F4EFE6] text-[#9A9082] border-[#E6DECF]",
    no_show:     "bg-blocked-bg text-blocked-text border-blocked-border",
  };
  return colors[status] ?? "bg-muted text-muted-foreground border-border";
}

export function priorityColor(priority: string): string {
  const colors: Record<string, string> = {
    emergency: "bg-blocked-dot",
    high:      "bg-waiting-dot",
    normal:    "bg-[#8A7F9E]",
    low:       "bg-line",
  };
  return colors[priority] ?? "bg-line";
}

export function priorityLabel(priority: string): string {
  const labels: Record<string, string> = {
    emergency: "Emergency",
    high:      "High",
    normal:    "Normal",
    low:       "Low",
  };
  return labels[priority] ?? priority;
}

export function jobTypeLabel(type: string): string {
  return type.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
