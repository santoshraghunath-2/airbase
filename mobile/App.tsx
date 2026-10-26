import { useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Text } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useAuth } from "./src/hooks/useAuth";
import { usePushNotifications } from "./src/hooks/usePushNotifications";
import LoginScreen from "./src/screens/LoginScreen";
import JobsScreen from "./src/screens/field/JobsScreen";
import JobDetailScreen from "./src/screens/field/JobDetailScreen";
import ApprovalQueueScreen from "./src/screens/command/ApprovalQueueScreen";

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

function FieldTabs({ appUser }: { appUser: NonNullable<ReturnType<typeof useAuth>["appUser"]> }) {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  if (selectedJobId) {
    return (
      <JobDetailScreen
        jobId={selectedJobId}
        appUser={appUser}
        onBack={() => setSelectedJobId(null)}
      />
    );
  }

  return (
    <JobsScreen
      appUser={appUser}
      onSelectJob={(id) => setSelectedJobId(id)}
    />
  );
}

function CommandTabs({ appUser }: { appUser: NonNullable<ReturnType<typeof useAuth>["appUser"]> }) {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: () => {
          const icons: Record<string, string> = { Queue: "✓", Schedule: "📅", Chat: "💬" };
          return <Text style={{ fontSize: 18 }}>{icons[route.name] ?? "•"}</Text>;
        },
        tabBarActiveTintColor: "#2563eb",
        tabBarInactiveTintColor: "#9ca3af",
        headerStyle:     { backgroundColor: "#fff" },
        headerTitleStyle:{ fontWeight: "700", color: "#1a1a2e" },
      })}
    >
      <Tab.Screen name="Queue" options={{ title: "Approvals" }}>
        {() => <ApprovalQueueScreen appUser={appUser} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export default function App() {
  const { session, appUser, loading } = useAuth();
  usePushNotifications(appUser?.id ?? null, appUser?.tenant_id ?? null);

  if (loading) return null; // SecureStore hydration — blank frame is fine

  const isField   = appUser?.role === "technician";
  const isCommand = appUser?.role === "admin" || appUser?.role === "dispatcher";

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {!session || !appUser ? (
            <Stack.Screen name="Login" component={LoginScreen} />
          ) : isField ? (
            <Stack.Screen name="Field" options={{ title: "Today's Jobs" }}>
              {() => <FieldTabs appUser={appUser} />}
            </Stack.Screen>
          ) : isCommand ? (
            <Stack.Screen name="Command" options={{ title: "Command" }}>
              {() => <CommandTabs appUser={appUser} />}
            </Stack.Screen>
          ) : (
            <Stack.Screen name="Login" component={LoginScreen} />
          )}
        </Stack.Navigator>
      </NavigationContainer>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}
