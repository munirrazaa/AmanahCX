/**
 * Cross-platform dialogs: React Native's Alert.alert is a silent no-op on
 * react-native-web, so web (used for previews) falls back to the browser's
 * native confirm/alert.
 */
import { Alert, Platform } from 'react-native';

export function confirmDialog(title: string, message: string, confirmText: string, onConfirm: () => void, cancelText = 'Cancel') {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if (globalThis.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelText, style: 'cancel' },
    { text: confirmText, onPress: onConfirm },
  ]);
}

export function notify(title: string, message: string, onDone?: () => void) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    globalThis.alert(`${title}\n\n${message}`);
    onDone?.();
    return;
  }
  Alert.alert(title, message, [{ text: 'OK', onPress: onDone }]);
}
