import { ReceiptCategory } from '../types';

/**
 * Keyword-based receipt category classifier.
 *
 * Strategy (in priority order):
 *  1. MERCHANT OVERRIDE — check the merchant name (description) against
 *     a strict list of known pharmacy, grocery, and retail brands.
 *     If matched, return 'other' immediately, ignoring rawText.
 *     This prevents "CVS Pharmacy" from being tagged as meals just because
 *     rawText contains food items sold at the store.
 *  2. DESCRIPTION CHECK — check description-only keywords (higher confidence).
 *  3. FULL TEXT CHECK — check description + rawText combined.
 */

// ─── 1. Merchant-name overrides ──────────────────────────────────────────────
// If the merchant name matches ANY of these, classify as 'other' regardless of rawText.
const PHARMACY_RETAIL_MERCHANTS = [
  // Pharmacy / drug stores
  'cvs', 'walgreens', 'rite aid', 'duane reade', 'boots pharmacy', 'lloyds pharmacy',
  'watsons', 'guardian pharmacy', 'mannings', '万宁', '屈臣氏',
  // Supermarkets / grocery
  'walmart', 'target', 'costco', 'kroger', 'safeway', 'albertsons', 'publix',
  'whole foods', 'trader joe', 'aldi', 'lidl', 'tesco', 'sainsbury', 'asda',
  'waitrose', 'marks & spencer', 'carrefour', 'auchan', '家乐福', '沃尔玛',
  '华润万家', '永辉', '大润发', '盒马', 'hema', 'wellcome', 'park n shop',
  // General retail / convenience
  'dollar general', 'dollar tree', 'family dollar', '7-eleven', '7eleven',
  'circle k', 'convenience store', 'spar', 'lawson', 'familymart', 'family mart',
  'ministop', 'セブン', 'ローソン', 'ファミリーマート',
  // Department stores
  'department store', 'macy', 'nordstrom', 'bloomingdale', 'saks',
  'neiman marcus', 'jcpenney', 'kohl', 'tk maxx', 't.j. maxx',
];

// ─── 2. Category keyword lists ───────────────────────────────────────────────

const KEYWORDS: Record<Exclude<ReceiptCategory, 'other'>, string[]> = {
  meals: [
    // Establishment types
    'kitchen', 'restaurant', 'cafe', 'coffee', 'diner', 'bistro', 'grill',
    'eatery', 'canteen', 'buffet', 'bakery', 'bar', 'pub', 'tavern',
    'pizzeria', 'trattoria', 'brasserie', 'chophouse',
    // Cuisine / food items
    'pizza', 'sushi', 'noodle', 'ramen', 'burger', 'taco', 'sandwich',
    'salad', 'chicken', 'beef', 'pork', 'shrimp', 'seafood', 'rice',
    'dim sum', 'dumpling', 'naan', 'curry', 'steak', 'bbq', 'boba',
    'dessert', 'pastry', 'bread', 'brunch',
    // Drinks
    'brew', 'roast', 'espresso', 'latte', 'tea',
    // Food-related actions
    'dining', 'takeout', 'takeaway', 'delivery',
    // Well-known chains
    'mcdonald', 'starbucks', 'kfc', 'subway', 'chipotle', 'panda express',
    'domino', 'wendys', 'burger king', 'tim horton', 'dunkin',
    'shake shack', 'five guys', 'in-n-out', 'chick-fil',
    // Delivery apps
    'grubhub', 'doordash', 'ubereats', 'foodpanda', 'deliveroo',
    // Chinese / Asian keywords
    '餐', '饮', '食', '厨', '面', '饭', '茶',
  ],
  transport: [
    'uber', 'lyft', 'taxi', 'cab', 'grab', 'didi', 'ola',
    'airline', 'airways', 'air ', 'flight', 'airport',
    'train', 'metro', 'subway', 'mrt', 'bus', 'ferry', 'transit',
    'gas station', 'fuel', 'petrol', 'gasoline', 'shell station', 'bp station', 'exxon',
    'parking', 'toll', 'car rental', 'hertz', 'avis', 'enterprise', 'zipcar',
    'shuttle', 'limousine', 'rideshare',
    '出租', '地铁', '高铁', '机场',
  ],
  accommodation: [
    'hotel', 'motel', 'inn', 'airbnb', 'hostel', 'resort', 'lodge',
    'marriott', 'hilton', 'hyatt', 'sheraton', 'radisson', 'intercontinental',
    'holiday inn', 'courtyard', 'renaissance', 'westin', 'w hotel',
    'four seasons', 'ritz', 'mandarin', 'peninsula',
    'suite', 'accommodation', 'lodging', 'bed and breakfast', 'b&b',
    '酒店', '宾馆', '民宿',
  ],
  entertainment: [
    'cinema', 'movie', 'theatre', 'theater', 'concert', 'museum',
    'gallery', 'exhibition', 'amusement', 'theme park',
    'spa', 'massage', 'sauna', 'gym', 'fitness', 'yoga',
    'karaoke', 'bowling', 'golf', 'billiard', 'escape room',
    'netflix', 'spotify', 'apple music', 'disney', 'hbo',
    '电影', '演出', 'ktv',
  ],
  office: [
    'office', 'staples', 'office depot', 'print', 'copy', 'fedex',
    'ups ', 'dhl', 'usps', 'post office', 'courier', 'shipping',
    'supplies', 'stationery', 'ink', 'toner', 'paper',
    'amazon', 'software', 'saas', 'subscription', 'license',
    'microsoft', 'adobe', 'zoom', 'slack', 'dropbox',
    '办公', '快递', '打印',
  ],
};

// ─── Classifier ───────────────────────────────────────────────────────────────

export function classifyReceiptCategory(
  description = '',
  rawText = '',
): ReceiptCategory {
  const descLower = description.toLowerCase();

  // Step 1 — Merchant override: if the merchant name is a known pharmacy /
  // grocery / retail brand, return 'other' without checking rawText at all.
  if (PHARMACY_RETAIL_MERCHANTS.some((m) => descLower.includes(m))) {
    return 'other';
  }

  // Step 2 — Description-only check (high confidence).
  // Catches "McDonald's", "Hilton Hotel", "Uber" etc. from the merchant name.
  for (const [cat, words] of Object.entries(KEYWORDS) as [Exclude<ReceiptCategory, 'other'>, string[]][]) {
    if (words.some((w) => descLower.includes(w))) return cat;
  }

  // Step 3 — Full-text check (lower confidence, rawText may contain incidental words).
  const fullText = `${description} ${rawText}`.toLowerCase();
  for (const [cat, words] of Object.entries(KEYWORDS) as [Exclude<ReceiptCategory, 'other'>, string[]][]) {
    if (words.some((w) => fullText.includes(w))) return cat;
  }

  return 'other';
}
