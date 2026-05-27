import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { GlassTabBar } from '../components/GlassTabBar';
import { Colors } from '../constants/theme';
import CameraScreen from '../screens/CameraScreen';
import EditReceiptScreen from '../screens/EditReceiptScreen';
import ExportScreen from '../screens/ExportScreen';
import HomeScreen from '../screens/HomeScreen';
import ProfileScreen from '../screens/ProfileScreen';
import ReceiptDetailScreen from '../screens/ReceiptDetailScreen';
import ReceiptsListScreen from '../screens/ReceiptsListScreen';

// ─── Param Lists ──────────────────────────────────────────────────────────

export type ReceiptsStackParamList = {
  ReceiptsList: { initialFilter?: 'all' | 'pending' | 'matched' } | undefined;
  ReceiptDetail: { receiptId: string };
  EditReceipt: { receiptId: string };
};

export type RootTabParamList = {
  首页: undefined;
  票据: { params?: { initialFilter?: 'all' | 'pending' | 'matched' } } | undefined;
  报销包: undefined;
  我的: undefined;
};

export type RootStackParamList = {
  Tabs: undefined;
  Camera: { manualEntry?: boolean } | undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();
const ReceiptsStack = createNativeStackNavigator<ReceiptsStackParamList>();
const RootStack = createNativeStackNavigator<RootStackParamList>();

function ReceiptsNavigator() {
  return (
    <ReceiptsStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: 'transparent' },
        headerTransparent: true,
        headerTintColor: Colors.textPrimary,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
      }}
    >
      <ReceiptsStack.Screen
        name="ReceiptsList"
        component={ReceiptsListScreen}
        options={{ title: '票据列表', headerShown: false }}
      />
      <ReceiptsStack.Screen
        name="ReceiptDetail"
        component={ReceiptDetailScreen}
        // v1.2 #3: hide the floating title so it doesn't overlap the hero image
        options={{ title: '', headerBackTitle: '' }}
      />
      <ReceiptsStack.Screen
        name="EditReceipt"
        component={EditReceiptScreen}
        options={{ title: '', headerBackTitle: '' }}
      />
    </ReceiptsStack.Navigator>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: Colors.background },
      }}
    >
      <Tab.Screen name="首页" component={HomeScreen} />
      <Tab.Screen name="票据" component={ReceiptsNavigator} />
      <Tab.Screen name="报销包" component={ExportScreen} />
      <Tab.Screen name="我的" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <RootStack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.background },
        }}
      >
        <RootStack.Screen name="Tabs" component={MainTabs} />
        <RootStack.Screen
          name="Camera"
          component={CameraScreen}
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
