import { useEffect, useState, useCallback } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator,
} from "react-native";
import { supabase } from "../../lib/supabase";
import type { AppUser } from "../../hooks/useAuth";

interface Job {
  id: string;
  status: string;
  job_type: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  customers: { name: string; phone: string | null } | null;
  service_locations: { address: string; city: string } | null;
}

const STATUS_COLOR: Record<string, string> = {
  dispatched:  "#2563eb",
  en_route:    "#f59e0b",
  on_site:     "#10b981",
  completed:   "#6b7280",
  unassigned:  "#ef4444",
};

const STATUS_LABEL: Record<string, string> = {
  dispatched:  "Dispatched",
  en_route:    "En Route",
  on_site:     "On Site",
  completed:   "Completed",
  unassigned:  "Unassigned",
};

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

interface Props {
  appUser: AppUser;
  onSelectJob: (jobId: string) => void;
}

export default function JobsScreen({ appUser, onSelectJob }: Props) {
  const [jobs, setJobs]           = useState<Job[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Techs see only their assigned jobs; admins/dispatchers see all tenant jobs
    let query = supabase
      .from("jobs")
      .select("id, status, job_type, scheduled_start, scheduled_end, customers(name, phone), service_locations(address, city)")
      .eq("tenant_id", appUser.tenant_id)
      .gte("scheduled_start", today.toISOString())
      .is("deleted_at", null)
      .order("scheduled_start", { ascending: true });

    if (appUser.role === "technician") {
      // Find the technician record for this user
      const { data: tech } = await supabase
        .from("technicians")
        .select("id")
        .eq("user_id", appUser.id)
        .single();
      if (tech) query = query.eq("tech_id", tech.id);
    }

    const { data } = await query;
    setJobs((data ?? []) as unknown as Job[]);
    setLoading(false);
    setRefreshing(false);
  }, [appUser]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={jobs.length === 0 ? styles.emptyList : styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); void load(true); }}
            tintColor="#2563eb"
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No jobs today</Text>
            <Text style={styles.emptySubtitle}>Pull down to refresh</Text>
          </View>
        }
        renderItem={({ item }) => {
          const color = STATUS_COLOR[item.status] ?? "#6b7280";
          const customer = item.customers as Job["customers"];
          const location = item.service_locations as Job["service_locations"];
          return (
            <TouchableOpacity style={styles.card} onPress={() => onSelectJob(item.id)} activeOpacity={0.7}>
              <View style={styles.cardHeader}>
                <Text style={styles.jobType}>{item.job_type?.replace(/_/g, " ")}</Text>
                <View style={[styles.badge, { backgroundColor: color + "20" }]}>
                  <Text style={[styles.badgeText, { color }]}>{STATUS_LABEL[item.status] ?? item.status}</Text>
                </View>
              </View>
              <Text style={styles.customerName}>{customer?.name ?? "Unknown customer"}</Text>
              <Text style={styles.address}>
                {location ? `${location.address}, ${location.city}` : "No address"}
              </Text>
              <Text style={styles.time}>
                {formatTime(item.scheduled_start)} – {formatTime(item.scheduled_end)}
              </Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: "#f8fafc" },
  center:      { flex: 1, justifyContent: "center", alignItems: "center" },
  list:        { padding: 16, gap: 12 },
  emptyList:   { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  empty:       { alignItems: "center" },
  emptyTitle:  { fontSize: 18, fontWeight: "600", color: "#1a1a2e", marginBottom: 6 },
  emptySubtitle: { fontSize: 14, color: "#9ca3af" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  jobType:     { fontSize: 15, fontWeight: "600", color: "#1a1a2e", textTransform: "capitalize" },
  badge:       { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText:   { fontSize: 12, fontWeight: "600" },
  customerName:{ fontSize: 14, color: "#374151", marginBottom: 2 },
  address:     { fontSize: 13, color: "#6b7280", marginBottom: 4 },
  time:        { fontSize: 13, color: "#9ca3af" },
});
