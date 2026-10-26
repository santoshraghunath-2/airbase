import { useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, Platform,
} from "react-native";
import SignatureCanvas, { SignatureViewRef } from "react-native-signature-canvas";
import { supabase } from "../../lib/supabase";
import type { AppUser } from "../../hooks/useAuth";

interface Props {
  jobId: string;
  tenantId: string;
  appUser: AppUser;
  customerName: string;
  onSaved: () => void;
  onCancel: () => void;
}

export default function SignatureScreen({
  jobId, tenantId, appUser, customerName, onSaved, onCancel,
}: Props) {
  const sigRef   = useRef<SignatureViewRef>(null);
  const [saving, setSaving] = useState(false);
  const [signed, setSigned] = useState(false);

  async function handleSave(dataUri: string) {
    if (!dataUri || dataUri === "data:image/png;base64,") {
      Alert.alert("Empty signature", "Please draw your signature before saving.");
      return;
    }
    setSaving(true);
    try {
      // Convert data URI to ArrayBuffer for Supabase Storage upload
      const base64 = dataUri.replace(/^data:image\/\w+;base64,/, "");
      const binary  = atob(base64);
      const buffer  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);

      const storagePath = `${tenantId}/jobs/${jobId}/signature_${Date.now()}.png`;

      const { error: uploadError } = await supabase.storage
        .from("job-media")
        .upload(storagePath, buffer, { contentType: "image/png", upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("job-media").getPublicUrl(storagePath);

      await supabase
        .from("jobs")
        .update({
          customer_signature_url: urlData.publicUrl,
          customer_signed_at:     new Date().toISOString(),
        })
        .eq("id", jobId);

      onSaved();
    } catch (err) {
      Alert.alert("Upload failed", err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function handleClear() {
    sigRef.current?.clearSignature();
    setSigned(false);
  }

  function handleConfirm() {
    sigRef.current?.readSignature();
  }

  const webStyle = `
    .m-signature-pad { box-shadow: none; border: none; }
    .m-signature-pad--body { border: none; }
    body { margin: 0; padding: 0; background: #fff; }
  `;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onCancel} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Customer Signature</Text>
        <View style={{ width: 56 }} />
      </View>

      <Text style={styles.prompt}>
        {customerName}, please sign below to confirm job completion.
      </Text>

      {/* Signature canvas */}
      <View style={styles.canvasWrapper}>
        <SignatureCanvas
          ref={sigRef}
          onOK={handleSave}
          onBegin={() => setSigned(true)}
          webStyle={webStyle}
          backgroundColor="#fff"
          penColor="#1a1a2e"
          descriptionText=""
          clearText=""
          confirmText=""
          autoClear={false}
          style={styles.canvas}
        />
        <Text style={styles.signHere}>Sign here</Text>
      </View>

      {/* Actions */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.clearBtn} onPress={handleClear} disabled={saving}>
          <Text style={styles.clearBtnText}>Clear</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.saveBtn, (!signed || saving) && styles.saveBtnDisabled]}
          onPress={handleConfirm}
          disabled={!signed || saving}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.saveBtnText}>Save Signature</Text>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: "#f8fafc" },
  header:        {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop:     Platform.OS === "ios" ? 56 : 20,
    paddingBottom:  16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  cancelText:    { fontSize: 16, color: "#2563eb" },
  title:         { fontSize: 17, fontWeight: "700", color: "#1a1a2e" },
  prompt:        {
    fontSize: 14, color: "#6b7280", textAlign: "center",
    paddingHorizontal: 32, paddingVertical: 16,
  },
  canvasWrapper: {
    flex: 1,
    marginHorizontal: 16,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    overflow: "hidden",
    position: "relative",
  },
  canvas:        { flex: 1 },
  signHere:      {
    position:  "absolute",
    bottom:    20,
    alignSelf: "center",
    fontSize:  13,
    color:     "#d1d5db",
    pointerEvents: "none",
  } as never,
  footer:        {
    flexDirection:  "row",
    gap:            12,
    padding:        20,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
  },
  clearBtn:      {
    flex: 1, borderRadius: 10, paddingVertical: 14,
    alignItems: "center", borderWidth: 1, borderColor: "#e5e7eb",
    backgroundColor: "#fff",
  },
  clearBtnText:  { fontSize: 15, fontWeight: "600", color: "#374151" },
  saveBtn:       { flex: 2, borderRadius: 10, paddingVertical: 14, alignItems: "center", backgroundColor: "#2563eb" },
  saveBtnDisabled: { backgroundColor: "#93c5fd" },
  saveBtnText:   { fontSize: 15, fontWeight: "600", color: "#fff" },
});
