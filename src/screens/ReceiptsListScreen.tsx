import { format } from 'date-fns';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CATEGORY_ICONS, CATEGORY_LABELS } from '../constants/i18n';
import { Colors, Radius, Shadows, Spacing, Typography } from '../constants/theme';
import { ReceiptsStackParamList } from '../navigation';
import { convertToCny } from '../services/currency';
import { getReceipts } from '../services/receipts';
import { supabase } from '../services/supabase';
import { Receipt, ReceiptCategory } from '../types';

type Props = {
  navigation: NativeStackNavigationProp<ReceiptsStackParamList, 'ReceiptsList'>;
};

export default function ReceiptsListScreen({ navigation }: Props) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [totalCny, setTotalCny] = useState(0);
  const [totalCnyReady, setTotalCnyReady] = useState(false);

  const loadReceipts = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const data = await getReceipts(user.id);

    // Sort: drafts first (newest draft first), then complete by date desc
    const sorted = [...data].sort((a, b) => {
      const ad = a.is_draft ?? false;
      const bd = b.is_draft ?? false;
      if (ad !== bd) return ad ? -1 : 1;
      const aTime = a.date ? new Date(a.date).getTime() : 0;
      const bTime = b.date ? new Date(b.date).getTime() : 0;
      return bTime - aTime;
    });
    setReceipts(sorted);

    // CNY total excludes drafts (their amounts may be incomplete/zero)
    setTotalCnyReady(false);
    const nonDrafts = data.filter((r) => !(r.is_draft ?? false));
    const cnyValues = await Promise.all(
      nonDrafts.map((r) => r.amount_cny != null
        ? Promise.resolve(r.amount_cny)
        : convertToCny(r.amount, r.currency).then((v) => v ?? 0),
      ),
    );
    setTotalCny(cnyValues.reduce((s: number, v: number) => s + v, 0));
    setTotalCnyReady(true);
  }, []);

  useEffect(() => {
    loadReceipts().finally(() => setLoading(false));
  }, [loadReceipts]);

  async function onRefresh() {
    setRefreshing(true);
    await loadReceipts();
    setRefreshing(false);
  }

  function renderItem({ item, index }: { item: Receipt; index: number }) {
    const isDraft = item.is_draft ?? false;
    const catIcon = CATEGORY_ICONS[item.category ?? 'other'];

    return (
      <TouchableOpacity
        style={[s.card, isDraft && s.cardDraft, index === 0 && { marginTop: Spacing.sm }]}
        onPress={() => isDraft
          ? navigation.navigate('EditReceipt', { receiptId: item.id })
          : navigation.navigate('ReceiptDetail', { receiptId: item.id })
        }
        activeOpacity={0.75}
      >
        {/* Thumbnail — show placeholder for receipts without image */}
        <View style={s.thumbnailWrap}>
          {item.image_url ? (
            <Image
              source={{ uri: item.thumbnail_url ?? item.image_url }}
              style={s.thumbnail}
            />
          ) : (
            <View style={[s.thumbnail, s.thumbnailPlaceholder]}>
              <Text style={s.thumbnailPlaceholderIcon}>📄</Text>
            </View>
          )}
        </View>

        {/* Body */}
        <View style={s.cardBody}>
          <Text style={s.cardTitle} numberOfLines={1}>{item.description || '未命名收据'}</Text>
          <Text style={s.cardDate}>
            {item.date ? format(new Date(item.date), 'yyyy年M月d日') : '未设置日期'}
          </Text>
          {isDraft ? (
            <View style={s.draftPill}>
              <Text style={s.draftPillText}>草稿 · 待补录</Text>
            </View>
          ) : item.category ? (
            <View style={s.categoryPill}>
              <Text style={s.categoryPillText}>
                {catIcon} {CATEGORY_LABELS[item.category] ?? item.category}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Amount */}
        <View style={s.amountBlock}>
          <Text style={[s.amountValue, isDraft && s.amountValueDraft]}>
            {isDraft && item.amount === 0 ? '—' : item.amount.toLocaleString()}
          </Text>
          <Text style={s.amountCurrency}>{item.currency}</Text>
          <Text style={s.chevron}>›</Text>
        </View>
      </TouchableOpacity>
    );
  }

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={Colors.black} />
      </View>
    );
  }

  return (
    <SafeAreaView style={s.screen} edges={['bottom']}>
      {/* Summary header */}
      {receipts.length > 0 && (
        <View style={s.summaryBar}>
          <View style={{ flex: 1 }}>
            <Text style={Typography.label}>合计（等值人民币）</Text>
            {totalCnyReady ? (
              <Text style={s.summaryAmount}>¥{totalCny.toFixed(2)}</Text>
            ) : (
              <ActivityIndicator size="small" color={Colors.black} style={{ marginTop: 4 }} />
            )}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={Typography.label}>收据数量</Text>
            <Text style={s.summaryCount}>{receipts.length} 张</Text>
          </View>
        </View>
      )}

      <FlatList
        data={receipts}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.black} />
        }
        contentContainerStyle={receipts.length === 0 ? s.emptyContainer : s.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={s.emptyState}>
            <Text style={s.emptyTitle}>还没有收据</Text>
            <Text style={s.emptySubtitle}>
              点击下方相机 Tab，拍摄你的第一张收据
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },

  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  summaryAmount: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.black,
    marginTop: 2,
    letterSpacing: -0.5,
  },
  summaryCount: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textSecondary,
    marginTop: 2,
  },

  listContent: { paddingHorizontal: 16, paddingBottom: 32 },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: Spacing.sm + 4,
    marginBottom: Spacing.sm,
    marginHorizontal: 16,
    ...Shadows.sm,
  },
  cardDraft: {
    backgroundColor: '#FFFBF5',
    borderWidth: 1,
    borderColor: '#F6D28D',
  },

  thumbnailWrap: { marginRight: 12 },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: Colors.border,
  },
  thumbnailPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailPlaceholderIcon: { fontSize: 24 },

  cardBody: { flex: 1, marginRight: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Colors.black, marginBottom: 2 },
  cardDate: { fontSize: 12, color: Colors.textSecondary, marginBottom: 4 },
  categoryPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: '#E4E8ED',
  },
  categoryPillText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  draftPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F6D28D',
  },
  draftPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400E',
  },

  amountBlock: { alignItems: 'flex-end' },
  amountValue: { fontSize: 17, fontWeight: '700', color: Colors.black },
  amountValueDraft: { color: Colors.textTertiary },
  amountCurrency: { fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  chevron: { fontSize: 18, color: Colors.textTertiary, marginTop: 4 },

  emptyContainer: { flex: 1 },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.black,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
