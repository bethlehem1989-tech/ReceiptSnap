// react-native-gesture-handler MUST be the very first import
import 'react-native-gesture-handler';

// NOTE: react-native-url-polyfill/auto is intentionally NOT imported here.
// RN 0.81 ships its own URL implementation; the polyfill triggers a
// recursive stack overflow (RangeError: Maximum call stack size exceeded)
// on launch, which presents as a pure white screen in TestFlight / release
// builds. v1.2.0 build #21 shipped with this polyfill by mistake — removed
// to fix that crash. See also the comment in src/services/supabase.ts.

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
