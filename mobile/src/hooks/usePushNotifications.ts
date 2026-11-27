import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "../lib/supabase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function usePushNotifications(userId: string | null, tenantId: string | null) {
  useEffect(() => {
    if (!userId || !tenantId) return;
    void registerToken(userId, tenantId);
  }, [userId, tenantId]);
}

async function registerToken(userId: string, tenantId: string) {
  if (!Device.isDevice) return; // Push doesn't work in simulator

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") return;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name:      "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId
    ?? Constants.easConfig?.projectId;

  if (!projectId) {
    console.warn("usePushNotifications: no EAS project ID — token registration skipped");
    return;
  }

  const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
  const token    = tokenResponse.data;
  const platform = Platform.OS === "ios" ? "ios" : "android";
  const deviceId = Constants.deviceId ?? Constants.sessionId ?? "unknown";

  // Upsert — device_id unique index handles de-duplication
  await supabase.from("device_tokens").upsert(
    { user_id: userId, tenant_id: tenantId, token, platform, device_id: deviceId },
    { onConflict: "user_id,device_id" },
  );
}
