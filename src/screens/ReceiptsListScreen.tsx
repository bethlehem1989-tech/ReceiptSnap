import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { format } from 'date-fns';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AmbientBackground } from '../components/AmbientBackground';
import { CATEGORY_LABELS } from '../constants/i18n';
import { Colors, Radius, Shadows, Spacing } from '../constants/theme';
import { ReceiptsStackParamList } from '../navigation';
import { convertToCny } from '../services/currency';
import { getReceipts } from '../services/receipts';
import { supabase } from '../services/supabase';
import { Receipt } from '../types';

type Props = {
  navigation: NativeStackNavigationProp<ReceiptsStackParamList, 'ReceiptsList'>;
  route: RouteProp<ReceiptsStackParamList, 'ReceiptsList'>;
};

type FilterKey = 'all' | 'pending' | 'matched';

const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'];

type Classified = Receipt & {
  _isDraft: boolean;
  _isMatched: boolean;
  _needsAttention: boolean;
};

function classify(r: Receipt): Classified {
  const isDraft = r.is_draft ?? false;
  // v1.2 #13: a draft receipt should never show up in the "已匹配" filter,
  // even if its payment_match_status was 'matched' before it was demoted.
  const isMatched = !isDraft && r.payment_match_status === 'matched';
  // v1.2 #13: needsAttention is for drafts OR non-draft receipts without
  // verified payment proof. Matched non-drafts don't need attention.
  const needsAttention = isDraft || (!isDraft && !isMatched);
  return { ...r, _isDraft: isDraft, _isMatched: isMatched, _needsAttention: needsAttention };
}

export default function ReceiptsListScreen({ navigation, route }: Props) {
  const initialFilter: FilterKey = (route.params as any)?.initialFilter ?? 'all';
  const [receipts, setReceipts] = useState<Classified[]>([]);
  const [cnyByReceipt, setCnyByReceipt] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterKey>(initialFilter);
  const [search, setSearch] = useState('');

  const loadReceipts = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const data = await getReceipts(user.id);
    const classified = data.map(classify);
    setReceipts(classified);

    const cnyMap: Record<string, number> = {};
    await Promise.all(
      classified.map(async (r) => {
        if (r._isDraft) return;
        const cached = (r as any).amount_cny;
        const v =
          cached != null
            ? cached
            : ((await convertToCny(r.amount, r.currency)) ?? 0);
        cnyMap[r.id] = v;
      }),
    );
    setCnyByReceipt(cnyMap);
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => loadReceipts());
    loadReceipts().finally(() => setLoading(false));
    return unsub;
  }, [navigation, loadReceipts]);

  const counts = useMemo(
    () => ({
      all: receipts.length,
      pending: receipts.filter((r) => r._needsAttention).length,
      matched: receipts.filter((r) => r._isMatched).length,
    }),
    [receipts],
  );

  const filtered = useMemo(() => {
    let list = receipts;
    if (filter === 'pending') list = list.filter((r) => r._needsAttention);
    if (filter === 'matched') list = list.filter((r) => r._isMatched);

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => {
        const desc = (r.description ?? '').toLowerCase();
        const amt = String(r.amount ?? '');
        const notes = (r.notes ?? '').toLowerCase();
        return desc.includes(q) || amt.includes(q) || notes.includes(q);
      });
    }
    return list;
  }, [receipts, filter, search]);

  type Group = { date: string; weekday: string; items: Classified[]; totalCny: number };
  const groups = useMemo<Group[]>(() => {
    const drafts = filtered.filter((r) => r._isDraft);
    const completed = filtered.filter((r) => !r._isDraft);

    const byDate = new Map<string, Classified[]>();
    for (const r of completed) {
      const d = r.date || 'unknown';
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(r);
    }

    const groupsArr: Group[] = Array.from(byDate.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, items]) => {
        const totalCny = items.reduce((s, it) => s + (cnyByReceipt[it.id] ?? 0), 0);
        const weekday =
          date && date !== 'unknown' ? WEEKDAY_ZH[new Date(date).getDay()] : '';
        return { date, weekday, items, totalCny };
      });

    if (drafts.length > 0) {
      groupsArr.unshift({ date: 'drafts', weekday: '', items: drafts, totalCny: 0 });
    }
    return groupsArr;
  }, [filtered, cnyByReceipt]);

  async function onRefresh() {
    setRefreshing(true);
    await loadReceipts();
    setRefreshing(false);
  }

  function thumbColor(r: Classified): { bg: string; icon: keyof typeof Ionicons.glyphMap } {
    const cat = r.category ?? 'other';
    switch (cat) {
      case 'meals':         return { bg: '#E6C5B8', icon: 'restaurant-outline' };
      case 'transport':     return { bg: '#BCD0D8', icon: 'train-outline' };
      case 'accommodation': return { bg: '#CBBED7', icon: 'bed-outline' };
      case 'entertainment': return { bg: '#BFD5C4', icon: 'film-outline' };
      case 'office':        return { bg: '#CBCEBF', icon: 'briefcase-outline' };
      default:              return { bg: '#D4CDC1', icon: 'document-text-outline' };
    }
  }

  function renderReceipt({ item }: { item: Classified }) {
    const t = thumbColor(item);
    return (
      <Pressable
        onPress={() =>
          item._isDraft
            ? navigation.navigate('EditReceipt', { receiptId: item.id })
            : navigation.navigate('ReceiptDetail', { receiptId: item.id })
        }
        style={({ pressed }) => [s.cardWrap, pressed && { opacity: 0.78 }]}
      >
        <View style={[s.card, item._isDraft && s.cardDraft]}>
          <View style={[s.thumb, { backgroundColor: t.bg }]}>
            {item.image_url ? (
              <Image
                source={{ uri: item.thumbnail_url ?? item.image_url }}
                style={s.thumbImg}
              />
            ) : (
              <Ionicons name={t.icon} size={22} color={Colors.textPrimary} />
            )}
          </View>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.cardTitle} numberOfLines={1}>
              {item.description || '未命名票据'}
            </Text>
            <Text style={s.cardCat}>
              {item.category
                ? CATEGORY_LABELS[item.category] ?? item.category
                : '未分类'}
            </Text>

            {item._isDraft ? (
              <View style={[s.statusPill, s.statusPillPending]}>
                <Ionicons name="time-outline" size={11} color="#7C5400" />
                <Text style={[s.statusPillText, { color: '#7C5400' }]}>待补充</Text>
              </View>
            ) : item._isMatched ? (
              <View style={[s.statusPill, s.statusPillMatched]}>
                <Ionicons name="checkmark-circle" size={11} color={Colors.success} />
                <Text style={[s.statusPillText, { color: Colors.success }]}>已匹配</Text>
              </View>
            ) : !item.payment_image_url ? (
              <View style={[s.statusPill, s.statusPillPending]}>
                <Ionicons name="add-circle-outline" size={11} color="#7C5400" />
                <Text style={[s.statusPillText, { color: '#7C5400' }]}>待补充</Text>
              </View>
            ) : null}
          </View>

          <View style={s.amountBlock}>
            <Text style={[s.amountValue, item._isDraft && s.amountValueDraft]}>
              {item._isDraft && item.amount === 0
                ? '—'
                : (item.currency === 'CNY' ? '¥' : '') +
                  item.amount.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
            </Text>
            <Text style={s.amountCurrency}>{item.currency}</Text>
          </View>
        </View>
      </Pressable>
    );
  }

  if (loading) {
    return (
      <AmbientBackground>
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>
      </AmbientBackground>
    );
  }

  return (
    <AmbientBackground>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <Text style={s.screenTitle}>票据列表</Text>

        <View style={s.searchRow}>
          <View style={s.searchWrap}>
            <Ionicons name="search-outline" size={16} color={Colors.textTertiary} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="搜索商家、金额、备注"
              placeholderTextColor={Colors.textTertiary}
              style={s.searchInput}
              returnKeyType="search"
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={Colors.textTertiary} />
              </Pressable>
            )}
          </View>
          <Pressable
            onPress={() => setFilter(filter === 'pending' ? 'all' : 'pending')}
            style={({ pressed }) => [s.filterBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="options-outline" size={16} color={Colors.textSecondary} />
          </Pressable>
        </View>

        <View style={s.filterTabs}>
          {(['all', 'pending', 'matched'] as const).map((k) => (
            <Pressable
              key={k}
              onPress={() => setFilter(k)}
              style={({ pressed }) => [s.filterTab, pressed && { opacity: 0.6 }]}
            >
              <View style={[s.filterTabInner, filter === k && s.filterTabInnerActive]}>
                <Text
                  style={[s.filterTabText, filter === k && s.filterTabTextActive]}
                >
                  {k === 'all' ? '全部' : k === 'pending' ? '待补充' : '已匹配'}{' '}
                  <Text style={s.filterTabCount}>{counts[k]}</Text>
                </Text>
              </View>
            </Pressable>
          ))}
        </View>

        <FlatList
          data={groups}
          keyExtractor={(g) => g.date}
          renderItem={({ item: g }) => (
            <View>
              <View style={s.dayHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                  <Text style={s.dayDate}>
                    {g.date === 'drafts'
                      ? '草稿'
                      : g.date === 'unknown'
                      ? '未设日期'
                      : format(new Date(g.date), 'yyyy年M月d日')}
                  </Text>
                  {g.weekday ? (
                    <Text style={s.dayWeekday}>星期{g.weekday}</Text>
                  ) : null}
                </View>
                {g.totalCny > 0 ? (
                  <Text style={s.dayTotal}>
                    ¥
                    {g.totalCny.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </Text>
                ) : null}
              </View>
              {g.items.map((item) => (
                <View key={item.id}>{renderReceipt({ item })}</View>
              ))}
            </View>
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.accent}
            />
          }
          contentContainerStyle={
            groups.length === 0 ? s.emptyContainer : s.listContent
          }
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.emptyState}>
              <View style={s.emptyIcon}>
                <Ionicons name="receipt-outline" size={36} color={Colors.textTertiary} />
              </View>
              <Text style={s.emptyTitle}>
                {search ? '没有匹配的票据' : '还没有票据'}
              </Text>
              <Text style={s.emptySubtitle}>
                {search ? '换个关键词试试' : '回到首页，拍下你的第一张票据'}
              </Text>
            </View>
          }
        />
      </SafeAreaView>
    </AmbientBackground>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  screenTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
    paddingTop: 6,
    paddingBottom: 14,
  },

  searchRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    gap: 8,
    marginBottom: 12,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.textPrimary,
    padding: 0,
  },
  filterBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  filterTabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.hairline,
    marginBottom: 8,
    paddingHorizontal: Spacing.md - 4,
    gap: 14,
  },
  filterTab: { paddingVertical: 8 },
  filterTabInner: {
    paddingVertical: 4,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  filterTabInnerActive: { borderBottomColor: Colors.accent },
  filterTabText: { fontSize: 13, fontWeight: '600', color: Colors.textTertiary },
  filterTabTextActive: { color: Colors.accent, fontWeight: '700' },
  filterTabCount: { fontSize: 11, fontWeight: '600', opacity: 0.7 },

  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: Spacing.md,
    paddingTop: 12,
    paddingBottom: 10,
  },
  dayDate: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  dayWeekday: { fontSize: 11, color: Colors.textTertiary, fontWeight: '500' },
  dayTotal: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },

  // v1.2 #1: bumped bottom padding so last day-group isn't hidden behind tab bar
  listContent: { paddingHorizontal: Spacing.md, paddingBottom: 200 },
  cardWrap: { marginBottom: 8 },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    padding: 12,
    ...Shadows.sm,
  },
  cardDraft: {
    backgroundColor: '#FBF5E5',
    borderColor: 'rgba(198, 139, 46, 0.30)',
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImg: { width: 52, height: 52 },

  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  cardCat: { fontSize: 11, color: Colors.textSecondary, marginBottom: 5 },

  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  statusPillMatched: { backgroundColor: Colors.successLight },
  statusPillPending: {
    backgroundColor: Colors.warningLight,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(198, 139, 46, 0.30)',
  },
  statusPillText: { fontSize: 10, fontWeight: '700' },

  amountBlock: { alignItems: 'flex-end' },
  amountValue: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  amountValueDraft: { color: Colors.textTertiary },
  amountCurrency: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },

  emptyContainer: { flex: 1, paddingTop: 40 },
  emptyState: { alignItems: 'center', paddingHorizontal: 40, paddingTop: 60 },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: Colors.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
});
