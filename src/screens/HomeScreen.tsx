import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AmbientBackground } from '../components/AmbientBackground';
import { Colors, Radius, Shadows, Spacing } from '../constants/theme';
import { getReceipts } from '../services/receipts';
import { supabase } from '../services/supabase';
import { Receipt } from '../types';

type Trip = {
  nameZh: string;
  nameEn: string;
  startDate: string;   // YYYY-MM-DD
  endDate: string;     // YYYY-MM-DD
  status: '进行中' | '已结束' | '近期';
  count: number;
};

const QUOTA_TARGET = 100;

/**
 * Derive a "current trip" from the user's recent receipts (v1.2 fix #16).
 *
 * Old logic counted only receipts in the SAME calendar month as the latest
 * date, which had two bugs:
 *   - manually-entered receipts dated last month dropped the count
 *   - any new receipt dated in a different month "reset" the count
 *
 * New logic: count ALL non-draft receipts in the last 30 days, regardless
 * of how they were created. The displayed date range spans first→latest
 * within that window.
 */
function deriveTrip(receipts: Receipt[]): Trip | null {
  const completed = receipts.filter((r) => !(r.is_draft ?? false) && r.date);
  if (completed.length === 0) return null;

  const sorted = [...completed].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
  const latestDate = new Date(sorted[0].date);

  // Anchor the trip window: latest 30 days backwards from the most recent receipt
  const windowMs = 30 * 86400000;
  const windowStart = latestDate.getTime() - windowMs;
  const inWindow = sorted.filter((r) => {
    const t = new Date(r.date).getTime();
    return t >= windowStart && t <= latestDate.getTime();
  });

  const earliest = inWindow[inWindow.length - 1];
  const start = earliest ? earliest.date : sorted[0].date;
  const end = sorted[0].date;

  const daysSinceLatest = (Date.now() - latestDate.getTime()) / 86400000;
  const status: Trip['status'] = daysSinceLatest <= 7 ? '进行中' : '近期';

  const year = latestDate.getFullYear();
  const month = latestDate.getMonth();

  return {
    nameZh: `${year} 年 ${month + 1} 月报销`,
    nameEn: format(latestDate, 'MMMM yyyy') + ' Reimbursement',
    startDate: start,
    endDate: end,
    status,
    count: inWindow.length,
  };
}

export default function HomeScreen({ navigation }: any) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);

  const loadTrip = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    try {
      const all = await getReceipts(user.id);
      setTrip(deriveTrip(all));
    } catch {
      setTrip(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => loadTrip());
    loadTrip();
    return unsub;
  }, [navigation, loadTrip]);

  function goToCamera() {
    navigation.navigate('Camera');
  }

  function goToReceipts(tab?: 'all' | 'pending' | 'matched') {
    navigation.navigate('票据', tab ? { params: { initialFilter: tab } } : undefined);
  }

  function goToExport() {
    navigation.navigate('报销包');
  }

  return (
    <AmbientBackground>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={s.header}>
            <View>
              <Text style={s.brand}>ReceiptSnap</Text>
              <Text style={s.tagline}>海外差旅报销助手</Text>
            </View>
            {/* v1.2 #4: bell now responds to taps with a placeholder alert */}
            <Pressable
              onPress={() => Alert.alert(
                '消息中心',
                '通知功能即将上线，敬请期待。\n后续会在这里看到「凭证待补充」「报销周期临近」等提醒。',
                [{ text: '好的', style: 'cancel' }],
              )}
              style={({ pressed }) => [s.bell, pressed && { opacity: 0.65 }]}
              hitSlop={10}
            >
              <Ionicons name="notifications-outline" size={18} color={Colors.textPrimary} />
              <View style={s.bellDot} />
            </Pressable>
          </View>

          {/* Trip card */}
          <View style={s.tripCard}>
            <View style={s.tripWatermark} pointerEvents="none">
              <Ionicons name="airplane-outline" size={120} color="rgba(45, 60, 50, 0.05)" />
            </View>
            {trip ? (
              <>
                <Text style={s.tripNameZh}>{trip.nameZh}</Text>
                <Text style={s.tripNameEn}>{trip.nameEn}</Text>
                <Text style={s.tripDates}>
                  {trip.startDate.replace(/-/g, '.')} — {trip.endDate.replace(/-/g, '.')}
                </Text>
                <View style={s.tripStatusRow}>
                  <View style={s.tripStatusPill}>
                    <Text style={s.tripStatusText}>{trip.status}</Text>
                  </View>
                </View>
              </>
            ) : (
              <>
                <Text style={s.tripNameZh}>开始你的第一次出差</Text>
                <Text style={s.tripNameEn}>Start your first business trip</Text>
                <Text style={s.tripDates}>拍下第一张收据，自动归类到本月报销</Text>
                <View style={s.tripStatusRow}>
                  <View style={[s.tripStatusPill, { backgroundColor: Colors.surfaceSecondary }]}>
                    <Text style={[s.tripStatusText, { color: Colors.textSecondary }]}>等待开始</Text>
                  </View>
                </View>
              </>
            )}
          </View>

          {/* Recognition quota card */}
          <View style={s.quotaCard}>
            <Text style={s.quotaLabel}>本次出差已识别票据</Text>
            <View style={s.quotaRow}>
              {loading ? (
                <ActivityIndicator size="small" color={Colors.textPrimary} />
              ) : (
                <>
                  <Text style={s.quotaNum}>{trip?.count ?? 0}</Text>
                  <Text style={s.quotaTotal}>/ {QUOTA_TARGET} 张</Text>
                </>
              )}
            </View>
            <View style={s.quotaBarTrack}>
              <View
                style={[
                  s.quotaBarFill,
                  { width: `${Math.min(100, ((trip?.count ?? 0) / QUOTA_TARGET) * 100)}%` as any },
                ]}
              />
            </View>
            <Text style={s.quotaTag}>AI 智能识别 · 票据自动归类</Text>
          </View>

          {/* Big circular shutter button */}
          <View style={s.shutterWrap}>
            <Pressable
              onPress={goToCamera}
              style={({ pressed }) => [s.shutter, pressed && { opacity: 0.88, transform: [{ scale: 0.97 }] }]}
              hitSlop={8}
            >
              <Ionicons name="camera" size={42} color={Colors.textInverse} />
            </Pressable>
            <Text style={s.shutterLabel}>拍照识别</Text>
            <Pressable
              onPress={() => navigation.navigate('Camera', { manualEntry: true })}
              style={({ pressed }) => [{ marginTop: 4 }, pressed && { opacity: 0.6 }]}
              hitSlop={6}
            >
              <Text style={s.manualLink}>或手动录入</Text>
            </Pressable>
          </View>

          {/* Two action tiles */}
          <View style={s.actionRow}>
            <Pressable
              onPress={() => goToReceipts('pending')}
              style={({ pressed }) => [s.actionTile, pressed && { opacity: 0.85 }]}
            >
              <View style={s.actionIcon}>
                <Ionicons name="document-text-outline" size={18} color={Colors.textPrimary} />
              </View>
              <Text style={s.actionTitle}>支付凭证</Text>
              <Text style={s.actionSub}>补充支付证明</Text>
            </Pressable>

            <Pressable
              onPress={goToExport}
              style={({ pressed }) => [s.actionTile, pressed && { opacity: 0.85 }]}
            >
              <View style={s.actionIcon}>
                <Ionicons name="cube-outline" size={18} color={Colors.textPrimary} />
              </View>
              <Text style={s.actionTitle}>导出报销包</Text>
              <Text style={s.actionSub}>生成报销材料</Text>
            </Pressable>
          </View>

          <View style={{ height: 130 }} />
        </ScrollView>
      </SafeAreaView>
    </AmbientBackground>
  );
}

const s = StyleSheet.create({
  scroll: {
    paddingHorizontal: Spacing.md + 2,
    paddingTop: 4,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  brand: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  bell: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute',
    top: 6,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.danger,
    borderWidth: 1.5,
    borderColor: Colors.surface,
  },

  // Trip card
  tripCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    padding: Spacing.md + 2,
    overflow: 'hidden',
    position: 'relative',
    ...Shadows.sm,
  },
  tripWatermark: {
    position: 'absolute',
    top: -10,
    right: -16,
    transform: [{ rotate: '-22deg' }],
  },
  tripNameZh: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.4,
  },
  tripNameEn: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.textSecondary,
    marginTop: 2,
  },
  tripDates: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 10,
    fontVariant: ['tabular-nums'],
  },
  tripStatusRow: {
    marginTop: 10,
    flexDirection: 'row',
  },
  tripStatusPill: {
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.accent,
  },
  tripStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textInverse,
    letterSpacing: 0.3,
  },

  // Quota card
  quotaCard: {
    marginTop: 10,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    padding: Spacing.md - 2,
    paddingVertical: Spacing.md - 2,
    ...Shadows.sm,
  },
  quotaLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  quotaRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginTop: 4,
  },
  quotaNum: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  quotaTotal: {
    fontSize: 13,
    color: Colors.textTertiary,
    fontWeight: '600',
  },
  quotaBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.surfaceSecondary,
    marginTop: 10,
    overflow: 'hidden',
  },
  quotaBarFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: Colors.accent,
  },
  quotaTag: {
    marginTop: 8,
    fontSize: 11,
    color: Colors.textTertiary,
  },

  // Shutter
  shutterWrap: {
    alignItems: 'center',
    marginTop: 22,
  },
  shutter: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1F3A2D',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.30,
    shadowRadius: 24,
    elevation: 12,
    borderWidth: 4,
    borderColor: 'rgba(251, 248, 240, 0.6)',
  },
  shutterLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: 10,
    letterSpacing: 0.5,
  },
  manualLink: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontWeight: '500',
  },

  // Action tiles
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  actionTile: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    padding: Spacing.md - 2,
    ...Shadows.sm,
  },
  actionIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: Colors.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  actionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  actionSub: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 2,
  },
});
