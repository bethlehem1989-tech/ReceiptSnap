import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Preprocesses a receipt image before sending to OCR.
 *
 * Steps:
 *  1. Resize — normalise to max 1600px width (Vision APIs don't benefit beyond this)
 *  2. Save as high-quality JPEG — keeps file size reasonable while preserving detail
 *
 * Note: expo-image-manipulator doesn't expose contrast/brightness directly.
 * Claude Vision handles low-contrast thermal receipts through its own image
 * understanding, so resizing + quality normalisation is the right pre-step.
 */
export async function preprocessReceiptImage(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [
      // Normalise width — 800 px is enough for Claude Vision and keeps
      // the upload small (~150 KB), which cuts round-trip time significantly
      { resize: { width: 800 } },
    ],
    {
      compress: 0.88,   // slightly lower quality is fine at 800 px
      format: ImageManipulator.SaveFormat.JPEG,
    },
  );

  return result.uri;
}
