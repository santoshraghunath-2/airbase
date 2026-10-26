import { useEffect, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Linking, Alert, ActivityIndicator,
} from "react-native";
import { supabase } from "../../lib/supabase";

interface JobDetail {
  id: string;
  status: string;
  job_type: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  internal_notes: string | null;
  customers: { name: string; phone: string | null; email: string | null } | null;
  service_locations: { address: string; city: string; state: string; zip: string } | null;
  technicians: { name: string } | null;
}

const STATUS_FLOW: Record<string, string> = {
  dispatched:  "en_route",
  en_route:    "on_site",
  on_site:     "completed",
};

const NEXT_LABEL: Record<string, string> = {
  dispatched: "Start Drive →",
  en_route:   "Arrived On Site →",
  on_site:    "Complete Job →",
};

interface Props {
  jobId: string;
  onBack: () => void;
}

export default function JobDetailScreen({ jobId, onBack }: Props) {
  const [job, setJob]       = useState<JobDetail | null>(null);
  const [loading, setLoading]     = useState(true);
  const [advancing, setAdvancing] = useState(false);

  useEffect(() => { void loadJob(); }, [jobId]);

  async function loadJob() {
    const { data } = await supabase
      .from("jobs")
      .select("id, status, job_type, scheduled_start, scheduled_end, actual_start, actual_end, internal_notes, customers(name, phone, email), service_locations(address, city, state, zip), technicians(name)")
      .eq("id", jobId)
      .single();
    setJob(data as unknown as JobDetail);
    setLoading(false);
  }

  async function advanceStatus() {
    if (!job) return;
    const next = STATUS_FLOW[job.status];
    if (!next) return;

    if (next === "completed") {
      Alert.alert(
        "Complete Job",
        "Mark this job as completed?",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Complete", style: "destructive", onPress: () => void doAdvance(next) },
        ],
      );
      return;
    }
    void doAdvance(next);
  }

  async function doAdvance(next: string) {
    setAdvancing(true);
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { status: next };
    if (next === "on_site") updates.actual_start = now;
    if (next === "completed") updates.actual_end = now;

    const { error } = await supabase.from("jobs").update(updates).eq("id", jobId);
    if (error) {
      Alert.alert("Error", error.message);
    } else {
      await loadJob();
    }
    setAdvancing(false);
  }

  function openMaps() {
    const loc = job?.service_locations as JobDetail["service_locations"];
    if (!loc) return;
    const addr = encodeURIComponent(`${loc.address}, ${loc.city}, ${loc.state} ${loc.zip}`);
    Linking.openURL(`https://maps.apple.com/?daddr=${addr}`);
  }

  function callCustomer() {
    const phone = (job?.customers as JobDetail["customers"])?.phone;
    if (phone) Linking.openURL(`tel:${phone}`);
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#2563eb" /></View>;
  }

  if (!job) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Job not found</Text>
        <TouchableOpacity onPress={onBack}><Text style={styles.link}>Go back</Text></TouchableOpacity>
      </View>
    );
  }

  const customer = job.customers as JobDetail["customers"];
  const location = job.service_locations as JobDetail["service_locations"];
  const nextStatus = STATUS_FLOW[job.status];

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <TouchableOpacity onPress={onBack} style={styles.backRow}>
          <Text style={styles.backText}>← Today's Jobs</Text>
        </TouchableOpacity>

        <Text style={styles.jobType}>{job.job_type?.replace(/_/g, " ")}</Text>
        <Text style={styles.statusText}>{job.status?.replace(/_/g, " ")}</Text>

        {/* Customer */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Customer</Text>
          <Text style={styles.sectionValue}>{customer?.name ?? "—"}</Text>
          {customer?.phone && (
            <TouchableOpacity onPress={callCustomer} style={styles.actionBtn}>
              <Text style={styles.actionBtnText}>📞 Call {customer.phone}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Location */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Location</Text>
          <Text style={styles.sectionValue}>
            {location ? `${location.address}\n${location.city}, ${location.state} ${location.zip}` : "—"}
          </Text>
          {location && (
            <TouchableOpacity onPress={openMaps} style={styles.actionBtn}>
              <Text style={styles.actionBtnText}>🗺  Open in Maps</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Schedule */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Schedule</Text>
          <Text style={styles.sectionValue}>
            {job.scheduled_start
              ? new Date(job.scheduled_start).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
              : "Not scheduled"}
          </Text>
        </View>

        {/* Notes */}
        {job.internal_notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.sectionValue}>{job.internal_notes}</Text>
          </View>
        )}
      </ScrollView>

      {/* Status advance CTA */}
      {nextStatus && (
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.ctaBtn, advancing && styles.ctaBtnDisabled]}
            onPress={advanceStatus}
            disabled={advancing}
          >
            {advancing
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.ctaBtnText}>{NEXT_LABEL[job.status]}</Text>
            }
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: "#f8fafc" },
  center:         { flex: 1, justifyContent: "center", alignItems: "center" },
  scroll:         { padding: 20, paddingBottom: 32 },
  backRow:        { marginBottom: 16 },
  backText:       { fontSize: 14, color: "#2563eb", fontWeight: "500" },
  jobType:        { fontSize: 22, fontWeight: "700", color: "#1a1a2e", textTransform: "capitalize", marginBottom: 4 },
  statusText:     { fontSize: 14, color: "#6b7280", textTransform: "capitalize", marginBottom: 24 },
  section:        { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1 },
  sectionTitle:   { fontSize: 12, fontWeight: "600", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  sectionValue:   { fontSize: 15, color: "#1a1a2e", lineHeight: 22 },
  actionBtn:      { marginTop: 10, borderTopWidth: 1, borderTopColor: "#f3f4f6", paddingTop: 10 },
  actionBtnText:  { fontSize: 14, color: "#2563eb", fontWeight: "500" },
  footer:         { padding: 20, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#f3f4f6" },
  ctaBtn:         { backgroundColor: "#2563eb", borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  ctaBtnDisabled: { backgroundColor: "#93c5fd" },
  ctaBtnText:     { color: "#fff", fontSize: 16, fontWeight: "700" },
  errorText:      { fontSize: 16, color: "#6b7280", marginBottom: 12 },
  link:           { fontSize: 14, color: "#2563eb" },
});
