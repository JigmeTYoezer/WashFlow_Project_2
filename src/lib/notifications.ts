import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

const DEVICE_UPDATE_CHANNEL = 'washflow-updates';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function initializeDeviceNotifications() {
  if (Platform.OS === 'web') return false;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(DEVICE_UPDATE_CHANNEL, {
        name: 'WashFlow updates',
        importance: AndroidImportance.HIGH,
        sound: 'default',
      });
    }
    let permission = await Notifications.getPermissionsAsync();
    if (permission.status !== 'granted') permission = await Notifications.requestPermissionsAsync();
    return permission.status === 'granted';
  } catch {
    return false;
  }
}

export async function showDeviceNotification(input: { title: string; message: string; data?: Record<string, string> }) {
  if (Platform.OS === 'web') return false;
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (permission.status !== 'granted') return false;
    await Notifications.scheduleNotificationAsync({
      content: { title: input.title, body: input.message, data: input.data, sound: 'default' },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
        ...(Platform.OS === 'android' ? { channelId: DEVICE_UPDATE_CHANNEL } : {}),
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function scheduleWashReminders(input: {
  bookingId: string;
  machineId: string;
  startAt: number;
  endAt: number;
}) {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('washflow', {
        name: 'WashFlow reminders',
        importance: AndroidImportance.DEFAULT,
      });
    }

    let permission = await Notifications.getPermissionsAsync();
    if (permission.status !== 'granted') permission = await Notifications.requestPermissionsAsync();
    if (permission.status !== 'granted') return false;

    const schedule = async (title: string, body: string, timestamp: number) => {
      if (timestamp <= Date.now()) return;
      await Notifications.scheduleNotificationAsync({
        content: { title, body, data: { bookingId: input.bookingId, machineId: input.machineId } },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(timestamp),
          ...(Platform.OS === 'android' ? { channelId: 'washflow' } : {}),
        },
      });
    };

    await schedule('Your wash is coming up', `${input.machineId} is ready for you in 15 minutes.`, input.startAt - 15 * 60_000);
    await schedule('Laundry cycle complete', `Your wash in ${input.machineId} should be finished.`, input.endAt);
    return true;
  } catch {
    return false;
  }
}

export async function cancelWashReminders(bookingId: string) {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(scheduled
      .filter((item) => item.content.data?.bookingId === bookingId)
      .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)));
  } catch {
    // The Firestore cancellation is authoritative; local reminder cleanup is best effort.
  }
}
