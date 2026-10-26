import { useEffect, useState, useCallback } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, RefreshControl,
} from "react-native";
import { supabase } from "../../lib/supabase";
import type { AppUser } from "../../hooks/useAuth";

interface AgentAction {
  id: string;
  agent_type: string;
  trigger_event: string;
  proposed_action: Record<string, unknown>;
  reasoning: string;
  confidence: number;
  status: string;
  created_at: string;
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)   return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface Props { appUser: AppUser }

export default function ApprovalQueueScreen({ appUser }: Props) {
  const [actions, setActions]       = useState<AgentAction[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing]         = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    const { data } = await supabase
      .from("agent_actions")
      .select("id, agent_type, trigger_event, proposed_action, reasoning, confidence, status, created_at")
      .eq("tenant_id", appUser.tenant_id)
      .eq("status", "proposed")
      .order("created_at", { ascending: false })
      .limit(30);
    setActions((data ?? []) as AgentAction[]);
    setLoading(false);
    setRefreshing(false);
  }, [appUser.tenant_id]);

  useEffect(() => { void load(); }, [load]);

  // Live subscription — new proposed actions appear instantly
  useEffect(() => {
    const channel = supabase
      .channel(`agent-actions-${appUser.tenant_id}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "agent_actions",
        filter: `tenant_id=eq.${appUser.tenant_id}`,
      }, () => { void load(true); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [appUser.tenant_id, load]);

  async function respond(actionId: string, approve: boolean) {
    setActing(actionId);
    const { error } = await supabase
      .from("agent_actions")
      .update({ status: approve ? "approved" : "rejected" })
      .eq("id", actionId);

    if (error) {
      Alert.alert("Error", error.message);
    } else {
      setActions((prev) => prev.filter((a) => a.id !== actionId));
    }
    setActing(null);
  }

  function describeAction(action: AgentAction): string {
    const pa = action.proposed_action;
    if (action.agent_type === "dispatch") {
      return `Assign ${pa.tech_name ?? "a tech"} to job`;
    }
    if (action.agent_type === "invoice") {
      return `Send invoice — ${pa.notes ?? "review required"}`;
    }
    return action.agent_type.replace(/_/g, " ");
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#2563eb" /></View>;
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={actions}
        keyExtractor={(a) => a.id}
        contentContainerStyle={actions.length === 0 ? styles.emptyList : styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); void load(true); }}
            tintColor="#2563eb"
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>All clear</Text>
            <Text style={styles.emptySubtitle}>No pending approvals</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.agentBadge}>
                <Text style={styles.agentBadgeText}>{item.agent_type.replace(/_/g, " ")}</Text>
              </View>
              <Text style={styles.timeAgo}>{timeAgo(item.created_at)}</Text>
            </View>

            <Text style={styles.actionDesc}>{describeAction(item)}</Text>
            <Text style={styles.reasoning} numberOfLines={3}>{item.reasoning}</Text>

            <View style={styles.confidenceRow}>
              <Text style={styles.confidenceLabel}>Confidence</Text>
              <Text style={styles.confidenceValue}>{Math.round(item.confidence * 100)}%</Text>
            </View>

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.btn, styles.rejectBtn, acting === item.id && styles.btnDisabled]}
                onPress={() => respond(item.id, false)}
                disabled={acting === item.id}
              >
                <Text style={[styles.btnText, styles.rejectBtnText]}>Reject</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.approveBtn, acting === item.id && styles.btnDisabled]}
                onPress={() => respond(item.id, true)}
                disabled={acting === item.id}
              >
                {acting === item.id
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={[styles.btnText, styles.approveBtnText]}>Approve</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: "#f8fafc" },
  center:          { flex: 1, justifyContent: "center", alignItems: "center" },
  list:            { padding: 16, gap: 12 },
  emptyList:       { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  empty:           { alignItems: "center" },
  emptyTitle:      { fontSize: 18, fontWeight: "600", color: "#1a1a2e", marginBottom: 6 },
  emptySubtitle:   { fontSize: 14, color: "#9ca3af" },
  card:            { backgroundColor: "#fff", borderRadius: 12, padding: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  cardHeader:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  agentBadge:      { backgroundColor: "#eff6ff", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  agentBadgeText:  { fontSize: 12, fontWeight: "600", color: "#2563eb", textTransform: "capitalize" },
  timeAgo:         { fontSize: 12, color: "#9ca3af" },
  actionDesc:      { fontSize: 15, fontWeight: "600", color: "#1a1a2e", marginBottom: 6 },
  reasoning:       { fontSize: 13, color: "#6b7280", lineHeight: 19, marginBottom: 12 },
  confidenceRow:   { flexDirection: "row", justifyContent: "space-between", marginBottom: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#f3f4f6" },
  confidenceLabel: { fontSize: 13, color: "#6b7280" },
  confidenceValue: { fontSize: 13, fontWeight: "600", color: "#1a1a2e" },
  buttonRow:       { flexDirection: "row", gap: 10 },
  btn:             { flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  btnDisabled:     { opacity: 0.5 },
  btnText:         { fontSize: 15, fontWeight: "600" },
  rejectBtn:       { backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca" },
  rejectBtnText:   { color: "#ef4444" },
  approveBtn:      { backgroundColor: "#2563eb" },
  approveBtnText:  { color: "#fff" },
});
