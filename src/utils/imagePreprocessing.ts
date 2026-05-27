import * as ImageManipulator from 'expo-image-manipulator';
import { isLikelyOverseas } from '../services/aiProvider';

/**
 * Preprocesses a receipt image before sending to OCR.
 *
 * Two-step pipeline (v1.2.0 #23):
 *  1. Bake EXIF orientation into pixels by running manipulateAsync with an
 *     empty actions array. Without this step, landscape-captured photos can
 *     reach the OCR endpoint with the receipt content lying sideways, because
 *     some EXIF Orientation tags (esp. 6/8 from iPhone landscape shots in a
 *     portrait-locked app) are not consistently honoured downstream.
 *  2. Resize the now-pixel-correct image to a 1800 px long edge. 1800 keeps
 *     A4 增值税发票 small print legible while keeping uploads under ~700 KB.
 *
 * `targetLongEdge` lets the caller pick a smaller size for slow overseas
 * uploads (~1000 cuts payload to ~250 KB).
 */
export async function preprocessReceiptImage(
  uri: string,
  /**
   * Pass an explicit long edge to override the auto-detected default.
   * Default: 1800 in mainland China, 1200 overseas (smaller upload survives
   * hotel/airport WiFi better).
   */
  targetLongEdge?: number,
): Promise<string> {
  const longEdge = targetLongEdge ?? (isLikelyOverseas() ? 1200 : 1800);
  // Step 1: bake EXIF orientation. Empty action array forces the library to
  // re-encode the pixels in their displayed orientation.
  const normalized = await ImageManipulator.manipulateAsync(
    uri,
    [],
    {
      compress: 1.0,
      format: ImageManipulator.SaveFormat.JPEG,
    },
  );

  // Step 2: resize to the long edge so landscape A4 invoices and portrait
  // thermal receipts both get the same pixel budget for fine print.
  const isLandscape = normalized.width >= normalized.height;
  const resizeAction: ImageManipulator.Action = isLandscape
    ? { resize: { width: longEdge } }
    : { resize: { height: longEdge } };

  const result = await ImageManipulator.manipulateAsync(
    normalized.uri,
    [resizeAction],
    {
      compress: 0.9,
      format: ImageManipulator.SaveFormat.JPEG,
    },
  );

  return result.uri;
}
