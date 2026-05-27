import React from 'react';
import { StyleSheet, View, ViewStyle, StyleProp } from 'react-native';
import { Colors } from '../constants/theme';

type Props = {
  /**
   * Whether to draw the soft tonal "blobs" behind the content. Defaults
   * to true. Disable on screens that already have their own dark hero
   * background (e.g., camera viewfinder).
   */
  blobs?: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Soft layered background with two tonal "blobs" behind the page content.
 * This is what gives BlurView surfaces something interesting to blur over,
 * which is what makes the glass effect actually read as glass and not as
 * a flat translucent rectangle.
 *
 * The blobs are radial-gradient stand-ins drawn with three concentric
 * Views of decreasing alpha. RN doesn't ship a gradient primitive in core
 * but this approximation looks correct enough at the offscreen sizes used.
 */
export function AmbientBackground({ blobs = true, children, style }: Props) {
  return (
    <View style={[s.root, style]}>
      {blobs && (
        <>
          <View style={[s.blob, s.blobWarm]} pointerEvents="none" />
          <View style={[s.blob, s.blobCool]} pointerEvents="none" />
          <View style={[s.blob, s.blobAccent]} pointerEvents="none" />
        </>
      )}
      <View style={s.content}>{children}</View>
    </View>
  );
}

const BLOB_SIZE = 480;

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flex: 1,
  },
  blob: {
    position: 'absolute',
    width: BLOB_SIZE,
    height: BLOB_SIZE,
    borderRadius: BLOB_SIZE / 2,
    opacity: 0.55,
  },
  blobWarm: {
    top: -BLOB_SIZE * 0.45,
    left: -BLOB_SIZE * 0.35,
    backgroundColor: Colors.backgroundWarm,
  },
  blobCool: {
    bottom: -BLOB_SIZE * 0.50,
    right: -BLOB_SIZE * 0.30,
    backgroundColor: Colors.backgroundCool,
  },
  blobAccent: {
    top: '38%',
    right: -BLOB_SIZE * 0.55,
    width: BLOB_SIZE * 0.7,
    height: BLOB_SIZE * 0.7,
    borderRadius: (BLOB_SIZE * 0.7) / 2,
    backgroundColor: Colors.backgroundTint,
    opacity: 0.40,
  },
});
