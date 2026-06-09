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
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits[0] === "1") {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function jobStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    unassigned: "Unassigned",
    scheduled: "Scheduled",
    dispatched: "Dispatched",
    en_route: "En Route",
    arrived: "Arrived",
    in_progress: "In Progress",
    completed: "Completed",
    invoiced: "Invoiced",
    cancelled: "Cancelled",
    no_show: "No Show",
  };
  return labels[status] ?? status;
}

export function jobStatusColor(status: string): string {
  const colors: Record<string, string> = {
    unassigned: "bg-amber-100 text-amber-800 border-amber-200",
    scheduled: "bg-blue-100 text-blue-800 border-blue-200",
    dispatched: "bg-indigo-100 text-indigo-800 border-indigo-200",
    en_route: "bg-violet-100 text-violet-800 border-violet-200",
    arrived: "bg-purple-100 text-purple-800 border-purple-200",
    in_progress: "bg-cyan-100 text-cyan-800 border-cyan-200",
    completed: "bg-green-100 text-green-800 border-green-200",
    invoiced: "bg-emerald-100 text-emerald-800 border-emerald-200",
    cancelled: "bg-gray-100 text-gray-500 border-gray-200",
    no_show: "bg-red-100 text-red-800 border-red-200",
  };
  return colors[status] ?? "bg-gray-100 text-gray-800";
}

export function priorityColor(priority: string): string {
  const colors: Record<string, string> = {
    emergency: "bg-red-500",
    high: "bg-orange-400",
    normal: "bg-blue-400",
    low: "bg-gray-300",
  };
  return colors[priority] ?? "bg-gray-300";
}

export function jobTypeLabel(type: string): string {
  return type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
