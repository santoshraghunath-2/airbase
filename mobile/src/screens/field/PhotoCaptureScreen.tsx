import { useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Image, Alert, ActivityIndicator, Platform,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "../../lib/supabase";
import type { AppUser } from "../../hooks/useAuth";

interface Photo {
  uri: string;
  uploading: boolean;
  storagePath?: string;
  dbId?: string;
}

interface SavedPhoto {
  id: string;
  storage_path: string;
  public_url: string | null;
  taken_at: string;
}

interface Props {
  jobId: string;
  tenantId: string;
  appUser: AppUser;
  onDone: () => void;
}

export default function PhotoCaptureScreen({ jobId, tenantId, appUser, onDone }: Props) {
  const [photos, setPhotos]   = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { void loadExisting(); }, []);

  async function loadExisting() {
    const { data } = await supabase
      .from("job_photos")
      .select("id, storage_path, public_url, taken_at")
      .eq("job_id", jobId)
      .order("taken_at", { ascending: true });

    const existing = (data ?? []) as SavedPhoto[];
    setPhotos(
      existing.map((p) => ({
        uri:         p.public_url ?? "",
        uploading:   false,
        storagePath: p.storage_path,
        dbId:        p.id,
      })).filter((p) => p.uri),
    );
    setLoading(false);
  }

  async function requestPermission(type: "camera" | "library"): Promise<boolean> {
    if (type === "camera") {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Camera access needed", "Enable camera access in Settings to take photos.");
        return false;
      }
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Photos access needed", "Enable photo library access in Settings.");
        return false;
      }
    }
    return true;
  }

  async function takePhoto() {
    if (!await requestPermission("camera")) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: "images",
      quality: 0.75,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      await uploadPhoto(result.assets[0].uri);
    }
  }

  async function pickPhoto() {
    if (!await requestPermission("library")) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      quality: 0.75,
      allowsMultipleSelection: true,
      selectionLimit: 10,
    });
    if (!result.canceled) {
      for (const asset of result.assets) {
        await uploadPhoto(asset.uri);
      }
    }
  }

  async function uploadPhoto(uri: string) {
    const placeholder: Photo = { uri, uploading: true };
    setPhotos((prev) => [...prev, placeholder]);

    try {
      // Read as blob via fetch — works in React Native
      const res    = await fetch(uri);
      const blob   = await res.blob();
      const ext    = uri.split(".").pop()?.toLowerCase() ?? "jpg";
      const path   = `${tenantId}/jobs/${jobId}/photo_${Date.now()}.${ext}`;
      const mime   = ext === "png" ? "image/png" : "image/jpeg";

      const { error: uploadErr } = await supabase.storage
        .from("job-media")
        .upload(path, blob, { contentType: mime });

      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage.from("job-media").getPublicUrl(path);
      const publicUrl = urlData.publicUrl;

      const { data: row, error: dbErr } = await supabase
        .from("job_photos")
        .insert({
          tenant_id:    tenantId,
          job_id:       jobId,
          storage_path: path,
          public_url:   publicUrl,
          taken_by:     appUser.id,
        })
        .select("id")
        .single();

      if (dbErr) throw dbErr;

      setPhotos((prev) =>
        prev.map((p) =>
          p === placeholder
            ? { uri: publicUrl, uploading: false, storagePath: path, dbId: (row as { id: string }).id }
            : p,
        ),
      );
    } catch (err) {
      Alert.alert("Upload failed", err instanceof Error ? err.message : String(err));
      setPhotos((prev) => prev.filter((p) => p !== placeholder));
    }
  }

  async function deletePhoto(photo: Photo) {
    if (!photo.dbId) return;
    Alert.alert("Delete photo?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          if (photo.storagePath) {
            await supabase.storage.from("job-media").remove([photo.storagePath]);
          }
          await supabase.from("job_photos").delete().eq("id", photo.dbId!);
          setPhotos((prev) => prev.filter((p) => p.dbId !== photo.dbId));
        },
      },
    ]);
  }

  const uploading = photos.some((p) => p.uploading);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Job Photos</Text>
        <TouchableOpacity onPress={onDone} disabled={uploading}>
          <Text style={[styles.doneText, uploading && { color: "#93c5fd" }]}>Done</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.countText}>
        {photos.length} {photos.length === 1 ? "photo" : "photos"}
        {uploading ? " — uploading…" : ""}
      </Text>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#2563eb" /></View>
      ) : (
        <FlatList
          data={photos}
          numColumns={2}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.row}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No photos yet</Text>
              <Text style={styles.emptySubText}>Tap a button below to add photos</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.thumb}
              onLongPress={() => { if (!item.uploading && item.dbId) deletePhoto(item); }}
              activeOpacity={0.8}
            >
              <Image source={{ uri: item.uri }} style={styles.thumbImage} />
              {item.uploading && (
                <View style={styles.uploadOverlay}>
                  <ActivityIndicator color="#fff" />
                </View>
              )}
            </TouchableOpacity>
          )}
        />
      )}

      {/* Action buttons */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.footerBtn} onPress={takePhoto} disabled={uploading}>
          <Text style={styles.footerBtnIcon}>📷</Text>
          <Text style={styles.footerBtnText}>Take Photo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.footerBtn} onPress={pickPhoto} disabled={uploading}>
          <Text style={styles.footerBtnIcon}>🖼</Text>
          <Text style={styles.footerBtnText}>Choose from Library</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.hint}>Hold a photo to delete it</Text>
    </View>
  );
}

const THUMB_SIZE = "48%" as never;

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: "#f8fafc" },
  center:       { flex: 1, justifyContent: "center", alignItems: "center" },
  header:       {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 56 : 20,
    paddingBottom: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  title:        { fontSize: 17, fontWeight: "700", color: "#1a1a2e" },
  doneText:     { fontSize: 16, color: "#2563eb", fontWeight: "600" },
  countText:    { fontSize: 13, color: "#9ca3af", paddingHorizontal: 20, paddingVertical: 10 },
  grid:         { paddingHorizontal: 12, paddingBottom: 20 },
  row:          { justifyContent: "space-between", marginBottom: 8 },
  thumb:        {
    width: THUMB_SIZE,
    aspectRatio: 1,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#e5e7eb",
  },
  thumbImage:   { width: "100%", height: "100%" },
  uploadOverlay:{
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  empty:        { alignItems: "center", paddingTop: 60 },
  emptyText:    { fontSize: 16, fontWeight: "600", color: "#374151", marginBottom: 6 },
  emptySubText: { fontSize: 14, color: "#9ca3af" },
  footer:       {
    flexDirection: "row",
    gap: 12,
    padding: 16,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
  },
  footerBtn:    {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "#eff6ff", borderRadius: 10,
    paddingVertical: 14, borderWidth: 1, borderColor: "#bfdbfe",
  },
  footerBtnIcon:  { fontSize: 18 },
  footerBtnText:  { fontSize: 14, fontWeight: "600", color: "#2563eb" },
  hint:         { textAlign: "center", fontSize: 12, color: "#d1d5db", paddingBottom: 12 },
});
