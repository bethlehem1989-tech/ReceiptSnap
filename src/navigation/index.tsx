import { Ionicons } from '@expo/vector-icons';
import { BottomTabBarProps, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/theme';
import CameraScreen from '../screens/CameraScreen';
import EditReceiptScreen from '../screens/EditReceiptScreen';
import ExportScreen from '../screens/ExportScreen';
import MonthlyStatsScreen from '../screens/MonthlyStatsScreen';
import ReceiptDetailScreen from '../screens/ReceiptDetailScreen';
import ReceiptsListScreen from '../screens/ReceiptsListScreen';

// ─── Param Lists ──────────────────────────────────────────────────────────

export type ReceiptsStackParamList = {
  ReceiptsList: undefined;
  ReceiptDetail: { receiptId: string };
  EditReceipt: { receiptId: string };
};

export type RootTabParamList = {
  拍照: undefined;
  收据: undefined;
  统计: undefined;
  导出: undefined;
};

// ─── Tab icon config ──────────────────────────────────────────────────────

const TAB_CONFIG: {
  name: keyof RootTabParamList;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
}[] = [
  { name: '拍照', label: '拍照', icon: 'camera-outline',    iconActive: 'camera' },
  { name: '收据', label: '收据', icon: 'documents-outline', iconActive: 'documents' },
  { name: '统计', label: '月度', icon: 'bar-chart-outline', iconActive: 'bar-chart' },
  { name: '导出', label: '导出', icon: 'share-outline',     iconActive: 'share' },
];

// ─── Custom Tab Bar ───────────────────────────────────────────────────────

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[tb.container, { paddingBottom: insets.bottom + 10 }]}>
      {state.routes.map((route, index) => {
        const isFocused = state.index === index;
        const cfg = TAB_CONFIG[index];

        return (
          <TouchableOpacity
            key={route.key}
            style={tb.tab}
            onPress={() => navigation.navigate(route.name)}
            activeOpacity={0.7}
          >
            <View style={tb.iconWrap}>
              <Ionicons
                name={isFocused ? cfg.iconActive : cfg.icon}
                size={22}
                color={isFocused ? Colors.black : Colors.textTertiary}
              />
            </View>
            <Text style={[tb.label, isFocused && tb.labelActive]}>
              {cfg.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const tb = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: Colors.white,
    paddingTop: 8,
    paddingHorizontal: 8,
    // No fixed height — grows naturally with safe area padding.
    // On iPhone (insets.bottom=34): paddingBottom=44, total ~96px.
    // On other devices (insets.bottom=0): paddingBottom=10, total ~62px.
    borderTopWidth: 1,
    borderTopColor: '#E4E8ED',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.04,
        shadowRadius: 8,
      },
      android: { elevation: 8 },
    }),
  },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 2 },
  iconWrap: {
    width: 44,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 11, color: Colors.textTertiary, fontWeight: '500' },
  labelActive: { color: Colors.black, fontWeight: '700' },
});

// ─── Navigators ───────────────────────────────────────────────────────────

const Tab = createBottomTabNavigator<RootTabParamList>();
const ReceiptsStack = createNativeStackNavigator<ReceiptsStackParamList>();

function ReceiptsNavigator() {
  return (
    <ReceiptsStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTintColor: Colors.textPrimary,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
      }}
    >
      <ReceiptsStack.Screen
        name="ReceiptsList"
        component={ReceiptsListScreen}
        options={{ title: '我的收据' }}
      />
      <ReceiptsStack.Screen
        name="ReceiptDetail"
        component={ReceiptDetailScreen}
        options={{ title: '收据详情' }}
      />
      <ReceiptsStack.Screen
        name="EditReceipt"
        component={EditReceiptScreen}
        options={{ title: '编辑收据' }}
      />
    </ReceiptsStack.Navigator>
  );
}

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        tabBar={(props) => <CustomTabBar {...props} />}
        screenOptions={{
          headerStyle: { backgroundColor: Colors.surface },
          headerTitleStyle: { fontWeight: '700', color: Colors.textPrimary, fontSize: 17 },
          headerShadowVisible: false,
        }}
      >
        <Tab.Screen name="拍照" component={CameraScreen}       options={{ headerShown: false }} />
        <Tab.Screen name="收据" component={ReceiptsNavigator}  options={{ headerShown: false }} />
        <Tab.Screen name="统计" component={MonthlyStatsScreen} options={{ title: '月度统计' }} />
        <Tab.Screen name="导出" component={ExportScreen}       options={{ title: '导出报表' }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
