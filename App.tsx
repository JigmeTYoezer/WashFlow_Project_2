import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { firebaseEnabled } from './src/lib/firebase';
import { cancelWashReminders, initializeDeviceNotifications, scheduleWashReminders, showDeviceNotification } from './src/lib/notifications';
import {
  addSlotTime,
  addMachine,
  addManagedUser,
  cancelReservation,
  changeOwnPassword,
  clearArchivedBookings,
  DEFAULT_SLOT_TIMES,
  loadProfile,
  logOut,
  loginStudent,
  observeAllBookings,
  observeAuth,
  observeDateBookings,
  observeMachineConfig,
  observeSlotTimes,
  observeUserNotifications,
  observeUsers,
  observeUserBookings,
  registerStudent,
  removeMachine,
  removeManagedUser,
  removeSlotTime,
  renameMachine,
  reserveMachine,
  setMachineMaintenance,
  type SlotTime,
  updateWashStatus,
  updateOwnProfile,
  type BookingStatus,
  type MachineInfo,
  type UserProfile,
  type WashBooking,
} from './src/lib/washflow';

type Tab = 'Home' | 'Machines' | 'Bookings' | 'Activity' | 'Profile' | 'Manage' | 'Users' | 'Reports';
type Machine = { id: string; floor?: string; status: 'Available' | 'In Use' | 'Maintenance'; nextFree?: string };

const initialMachines: MachineInfo[] = [
  { id: 'Washer 01', floor: '', status: 'Available' },
  { id: 'Washer 02', floor: '', status: 'Available' },
  { id: 'Washer 03', floor: '', status: 'Available' },
  { id: 'Washer 04', floor: '', status: 'Available' },
];

function localDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function defaultSlotsForDate(dateKey: string): SlotTime[] {
  const day = new Date(`${dateKey}T00:00:00`).getDay();
  const weekend = day === 0 || day === 6;
  const startHour = weekend ? 10 : 17;
  const mealBreaks = weekend ? new Set([12, 18]) : new Set([18]);
  const slots: SlotTime[] = [];
  for (let hour = startHour; hour < 23; hour += 1) {
    if (mealBreaks.has(hour)) continue;
    slots.push({ start: `${String(hour).padStart(2, '0')}:00`, end: `${String(hour + 1).padStart(2, '0')}:00` });
  }
  return slots;
}

function dateLabel(date: Date) {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function displayTime(time: string) {
  const [hour, minute] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function addMinutes(time: string, minutes: number) {
  const [hour, minute] = time.split(':').map(Number);
  const value = hour * 60 + minute + minutes;
  return `${String(Math.floor(value / 60) % 24).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

const palette = {
  blue: '#2563EB',
  cyan: '#06B6D4',
  background: '#F5F7FB',
  surface: '#FFFFFF',
  ink: '#0F172A',
  muted: '#64748B',
  line: '#E3E8F0',
  softBlue: '#E8EFFE',
  green: '#059669',
  orange: '#EA580C',
  red: '#DC2626',
};
const HOSTEL_NAMES = ['RKA', 'RKB', 'NK', 'HA', 'HB', 'HC', 'HD', 'HE', 'HF'];

export default function App({ initialTab = 'Home' }: { initialTab?: Tab }) {
  const [clock, setClock] = useState(Date.now());
  const now = new Date(clock);
  const [tab, setTabState] = useState<Tab>(initialTab);
  const setTab = (next: Tab) => setTabState(next);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [splashFinished, setSplashFinished] = useState(false);
  const [splashExitFinished, setSplashExitFinished] = useState(false);
  const splashOpacity = useRef(new Animated.Value(0)).current;
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [studentId, setStudentId] = useState('');
  const [fullName, setFullName] = useState('');
  const [roomNumber, setRoomNumber] = useState('');
  const [hostel, setHostel] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [machineConfig, setMachineConfig] = useState(initialMachines);
  const [slotTimes, setSlotTimes] = useState<SlotTime[]>(DEFAULT_SLOT_TIMES);
  const [todayBookings, setTodayBookings] = useState<WashBooking[]>([]);
  const [bookingsForDate, setBookingsForDate] = useState<WashBooking[]>([]);
  const [myBookings, setMyBookings] = useState<WashBooking[]>([]);
  const [allBookings, setAllBookings] = useState<WashBooking[]>([]);
  const [dataError, setDataError] = useState('');
  const [query, setQuery] = useState('');
  const [machineFilter, setMachineFilter] = useState<'All machines' | 'Available'>('All machines');
  const [bookingMachine, setBookingMachine] = useState<string | null>(null);
  const [cycle, setCycle] = useState('Normal cycle');
  const [selectedDate, setSelectedDate] = useState(localDateKey(new Date()));
  const [selectedTime, setSelectedTime] = useState(defaultSlotsForDate(localDateKey(new Date()))[0]?.start ?? '17:00');
  const [booked, setBooked] = useState(false);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [bookingFilter, setBookingFilter] = useState<'Scheduled' | 'Completed' | 'Cancelled'>('Scheduled');
  const [staffBookingFilter, setStaffBookingFilter] = useState<'Scheduled' | 'Completed' | 'Cancelled'>('Scheduled');
  const [selectingBookingsToClear, setSelectingBookingsToClear] = useState(false);
  const [selectedBookingIds, setSelectedBookingIds] = useState<string[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [newMachineName, setNewMachineName] = useState('');
  const [newManagedUserId, setNewManagedUserId] = useState('');
  const [newManagedUserName, setNewManagedUserName] = useState('');
  const [newManagedUserPassword, setNewManagedUserPassword] = useState('');
  const [adminActionBusy, setAdminActionBusy] = useState(false);
  const [slotStart, setSlotStart] = useState('');
  const [slotEnd, setSlotEnd] = useState('');
  const [editingMachineId, setEditingMachineId] = useState<string | null>(null);
  const [editedMachineName, setEditedMachineName] = useState('');
  const [profileName, setProfileName] = useState('');
  const [profileRoom, setProfileRoom] = useState('');
  const [profileHostel, setProfileHostel] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  const availableTimeSlots = useMemo(() => {
    const combined = new Map(defaultSlotsForDate(selectedDate).map((slot) => [slot.start, slot]));
    slotTimes.forEach((slot) => combined.set(slot.start, slot));
    return [...combined.values()].sort((a, b) => a.start.localeCompare(b.start));
  }, [selectedDate, slotTimes]);

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSplashFinished(true), 1400);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const fadeIn = Animated.timing(splashOpacity, { toValue: 1, duration: 450, useNativeDriver: true });
    fadeIn.start();
    return () => fadeIn.stop();
  }, [splashOpacity]);

  useEffect(() => {
    if (!authReady || !splashFinished) return;
    const fadeOut = Animated.timing(splashOpacity, { toValue: 0, duration: 350, useNativeDriver: true });
    fadeOut.start(({ finished }) => { if (finished) setSplashExitFinished(true); });
    return () => fadeOut.stop();
  }, [authReady, splashFinished, splashOpacity]);

  useEffect(() => {
    if (!firebaseEnabled) {
      setAuthReady(true);
      return;
    }
    let authRequest = 0;
    const stopObserving = observeAuth((firebaseUser) => {
      const requestId = ++authRequest;
      setAuthReady(false);
      setProfile(null);
      setAuthError('');
      setTabState('Home');
      setMyBookings([]);
      setAllBookings([]);
      setUsers([]);
      if (!firebaseUser) {
        setStudentId('');
        setPassword('');
        setConfirmPassword('');
        setFullName('');
        setRoomNumber('');
        setHostel('');
        setAuthMode('login');
        setAuthReady(true);
        return;
      }
      void loadProfile(firebaseUser).then((value) => {
        if (requestId !== authRequest) return;
        setProfile(value);
        if (value?.role === 'ADMIN' || value?.role === 'STAFF') setTabState('Bookings');
        setAuthReady(true);
        if (!value) setAuthError('Your Firebase account has no WashFlow profile yet. Please register again or contact the warden.');
      }).catch((error: unknown) => {
        if (requestId !== authRequest) return;
        setAuthError(error instanceof Error ? error.message : 'Could not load your account.');
        setAuthReady(true);
      });
    });
    return () => {
      authRequest += 1;
      stopObserving();
    };
  }, []);

  useEffect(() => {
    if (!profile || !firebaseEnabled) return;
    const stopMine = profile.role === 'STUDENT' ? observeUserBookings(profile.userId, setMyBookings, setDataError) : undefined;
    const stopMachines = observeMachineConfig(setMachineConfig, setDataError);
    const stopAll = profile.role !== 'STUDENT' ? observeAllBookings(setAllBookings, setDataError) : undefined;
    const stopUsers = profile.role === 'ADMIN' ? observeUsers(setUsers, setDataError) : undefined;
    const stopSlots = observeSlotTimes(setSlotTimes, setDataError);
    return () => { stopMine?.(); stopMachines(); stopAll?.(); stopUsers?.(); stopSlots(); };
  }, [profile]);

  useEffect(() => {
    if (!profile || !firebaseEnabled) return;
    let disposed = false;
    let stopObserving: (() => void) | undefined;
    void initializeDeviceNotifications().then(() => {
      if (disposed) return;
      stopObserving = observeUserNotifications(profile.userId, (items) => {
        items.forEach((item) => {
          void showDeviceNotification({
            title: item.title,
            message: item.message,
            data: { notificationId: item.id },
          });
        });
      }, setDataError);
    });
    return () => {
      disposed = true;
      stopObserving?.();
    };
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    setProfileName(profile.fullName);
    setProfileRoom(profile.roomNumber ?? '');
    setProfileHostel(profile.hostel ?? '');
    setCycle('Normal cycle');
  }, [profile]);

  const todayKey = localDateKey(now);
  useEffect(() => {
    if (!profile || !firebaseEnabled) return;
    return observeDateBookings(todayKey, setTodayBookings, setDataError);
  }, [profile, todayKey]);

  useEffect(() => {
    if (!profile || !firebaseEnabled) return;
    return observeDateBookings(selectedDate, setBookingsForDate, setDataError);
  }, [profile, selectedDate]);

  useEffect(() => {
    if (!availableTimeSlots.some((slot) => slot.start === selectedTime) && availableTimeSlots.length) {
      setSelectedTime(availableTimeSlots[0].start);
    }
  }, [availableTimeSlots, selectedTime]);

  const machines: Machine[] = machineConfig.map((machine) => {
    if (machine.status === 'Maintenance') return { ...machine, status: 'Maintenance' };
    const active = todayBookings.find((booking) => booking.machineId === machine.id
      && !['CANCELLED', 'COMPLETED', 'DELIVERED'].includes(booking.status)
      && booking.startAt <= clock && booking.endAt > clock);
    return active
      ? { ...machine, status: 'In Use', nextFree: new Date(active.endAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }
      : { ...machine, status: 'Available' };
  });

  const availableMachines = machines.filter((machine) => machine.status === 'Available').length;
  const filteredMachines = useMemo(
    () => machines.filter((machine) => machineFilter !== 'Available' || machine.status === 'Available')
      .filter((machine) => machine.id.toLowerCase().includes(query.trim().toLowerCase())),
    [machines, machineFilter, query],
  );

  const startBooking = (machine: Machine) => {
    if (machine.status === 'Maintenance') {
      Alert.alert('Machine unavailable', 'This machine is currently under maintenance.');
      return;
    }
    setBookingMachine(machine.id);
    setSelectedDate(localDateKey(new Date()));
    setSelectedTime(defaultSlotsForDate(localDateKey(new Date()))[0]?.start ?? '17:00');
    setBookingError('');
    setBooked(false);
  };

  const confirmBooking = async () => {
    if (!bookingMachine || !profile) return;
    const minutes = 60;
    const slot = availableTimeSlots.find((item) => item.start === selectedTime);
    if (!slot) return;
    setBookingBusy(true);
    setBookingError('');
    try {
      const reservation = await reserveMachine({
        profile,
        machineId: bookingMachine,
        date: selectedDate,
        startTime: slot.start,
        endTime: slot.end,
        cycle,
        cycleMinutes: minutes,
      });
      await scheduleWashReminders({ bookingId: reservation.id, machineId: bookingMachine, startAt: reservation.startAt, endAt: reservation.endAt });
      setBooked(true);
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : 'Booking could not be saved. Try again.');
    } finally {
      setBookingBusy(false);
    }
  };

  const cancelBooking = async (booking: WashBooking) => {
    if (!profile) return;
    await cancelReservation(booking, profile.userId);
    await cancelWashReminders(booking.id);
    const markCancelled = (items: WashBooking[]) => items.map((item) => item.id === booking.id
      ? { ...item, status: 'CANCELLED' as const }
      : item);
    setMyBookings(markCancelled);
    setTodayBookings(markCancelled);
    setBookingsForDate(markCancelled);
    setAllBookings(markCancelled);
  };

  const activeTabs: Tab[] = profile?.role === 'ADMIN'
    ? ['Bookings', 'Machines', 'Reports', 'Users', 'Profile']
    : profile?.role === 'STAFF'
      ? ['Bookings', 'Machines', 'Profile']
      : ['Home', 'Machines', 'Bookings', 'Activity', 'Profile'];
  const bookingDays = Array.from({ length: 5 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index);
    return date;
  });
  const isTimeOccupied = (machineId: string, date: string, startTime: string) => bookingsForDate.some((booking) =>
    booking.machineId === machineId && booking.date === date && booking.startTime === startTime
    && !['CANCELLED', 'COMPLETED', 'DELIVERED'].includes(booking.status));
  const selectedTimeIsPast = selectedDate === localDateKey(new Date())
    && (() => {
      const [hour, minute] = selectedTime.split(':').map(Number);
      const time = new Date(); time.setHours(hour, minute, 0, 0); return time.getTime() <= clock;
    })();
  const nextBooking = myBookings.find((booking) => booking.startAt >= clock && !['CANCELLED', 'COMPLETED', 'DELIVERED'].includes(booking.status));
  const staffUpdatedBookings = myBookings.filter((booking) => ['COLLECTED', 'WASHING', 'READY'].includes(booking.status))
    .sort((a, b) => a.startAt - b.startAt);
  const scheduledBookings = myBookings.filter((booking) => booking.status === 'BOOKED')
    .sort((a, b) => a.startAt - b.startAt);
  const nextScheduledBooking = scheduledBookings.find((booking) => booking.startAt >= clock);
  const finishedBookings = myBookings.filter((booking) => ['DELIVERED', 'COMPLETED', 'CANCELLED'].includes(booking.status))
    .sort((a, b) => b.endAt - a.endAt);
  const trackedBooking = staffUpdatedBookings[0] ?? nextScheduledBooking ?? finishedBookings[0] ?? scheduledBookings[0];
  const visibleStaffBookings = allBookings.filter((booking) => {
    if (staffBookingFilter === 'Completed') return ['COMPLETED', 'DELIVERED'].includes(booking.status);
    if (staffBookingFilter === 'Cancelled') return booking.status === 'CANCELLED';
    return !['COMPLETED', 'DELIVERED', 'CANCELLED'].includes(booking.status);
  });
  const visibleTodayBookings = todayBookings.filter((booking) => {
    if (staffBookingFilter === 'Completed') return ['COMPLETED', 'DELIVERED'].includes(booking.status);
    if (staffBookingFilter === 'Cancelled') return booking.status === 'CANCELLED';
    return !['COMPLETED', 'DELIVERED', 'CANCELLED'].includes(booking.status);
  });
  const washStage = trackedBooking ? ({ BOOKED: 0, COLLECTED: 1, WASHING: 2, READY: 3, DELIVERED: 4, COMPLETED: 4, CANCELLED: -1 } as Record<BookingStatus, number>)[trackedBooking.status] : -1;
  const progress = washStage < 0 ? 0 : washStage * 25;
  const washStatusMessage = trackedBooking ? ({
    BOOKED: 'Waiting for laundry staff to start your wash.',
    COLLECTED: 'Laundry staff marked your items as collected.',
    WASHING: 'Laundry staff marked your wash as in progress.',
    READY: 'Your wash is ready for collection.',
    DELIVERED: 'Laundry staff marked your items as delivered.',
    COMPLETED: 'Your wash is complete.',
    CANCELLED: 'This booking was cancelled.',
  } as Record<BookingStatus, string>)[trackedBooking.status] : '';
  const visibleBookings = myBookings.filter((booking) => {
    if (bookingFilter === 'Completed') return ['COMPLETED', 'DELIVERED'].includes(booking.status);
    if (bookingFilter === 'Cancelled') return booking.status === 'CANCELLED';
    return !['COMPLETED', 'DELIVERED', 'CANCELLED'].includes(booking.status);
  });
  const clearableBookings = visibleBookings.filter((booking) => ['CANCELLED', 'COMPLETED', 'DELIVERED'].includes(booking.status));
  const selectedBookingsToClear = clearableBookings.filter((booking) => selectedBookingIds.includes(booking.id));
  const dailyUsage = useMemo(() => Array.from({ length: 7 }, (_, index) => {
      const date = new Date(clock);
      date.setDate(date.getDate() - (6 - index));
      const key = localDateKey(date);
      return { key, label: date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' }), count: allBookings.filter((booking) => booking.date === key && booking.status !== 'CANCELLED').length };
  }), [allBookings, clock]);
  const confirmClearBookings = () => Alert.alert(
    'Clear selected bookings?',
    `Permanently remove ${selectedBookingsToClear.length} selected completed or cancelled ${selectedBookingsToClear.length === 1 ? 'booking' : 'bookings'}?`,
    [
      { text: 'Keep bookings', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => {
        void clearArchivedBookings(selectedBookingsToClear, profile!.userId)
          .then((count) => {
            selectedBookingsToClear.forEach((booking) => { void cancelWashReminders(booking.id); });
            setSelectedBookingIds([]);
            setSelectingBookingsToClear(false);
            Alert.alert('Bookings cleared', `${count} ${count === 1 ? 'booking was' : 'bookings were'} removed.`);
          })
          .catch((error: unknown) => Alert.alert('Could not clear bookings', error instanceof Error ? error.message : 'Try again.'));
      } },
    ],
  );

  const toggleBookingForClear = (bookingId: string) => {
    setSelectedBookingIds((current) => current.includes(bookingId)
      ? current.filter((id) => id !== bookingId)
      : [...current, bookingId]);
  };

  const handleAddMachine = async () => {
    setAdminActionBusy(true);
    try {
      await addMachine(newMachineName);
      setNewMachineName('');
    } catch (error) {
      Alert.alert('Could not add machine', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setAdminActionBusy(false);
    }
  };

  const confirmRemoveMachine = (machine: MachineInfo) => Alert.alert(
    'Remove machine?',
    `${machine.id} will be removed from the machine list. Existing booking records will remain.`,
    [
      { text: 'Keep machine', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => {
        void removeMachine(machine).catch((error: unknown) => Alert.alert('Could not remove machine', error instanceof Error ? error.message : 'Try again.'));
      } },
    ],
  );

  const handleRenameMachine = async (machine: MachineInfo) => {
    setAdminActionBusy(true);
    try {
      await renameMachine(machine, editedMachineName);
      setEditingMachineId(null);
      setEditedMachineName('');
    } catch (error) {
      Alert.alert('Could not edit machine', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setAdminActionBusy(false);
    }
  };

  const handleAddSlotTime = async () => {
    setAdminActionBusy(true);
    try {
      await addSlotTime(slotStart, slotEnd);
      setSlotStart('');
      setSlotEnd('');
    } catch (error) {
      Alert.alert('Could not save time slot', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setAdminActionBusy(false);
    }
  };

  const handleAddManagedUser = async () => {
    setAdminActionBusy(true);
    try {
      await addManagedUser({ userId: newManagedUserId, fullName: newManagedUserName, password: newManagedUserPassword, role: 'STAFF' });
      setNewManagedUserId('');
      setNewManagedUserName('');
      setNewManagedUserPassword('');
      Alert.alert('Account added', 'The user can now sign in with their user ID and password.');
    } catch (error) {
      Alert.alert('Could not add account', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setAdminActionBusy(false);
    }
  };

  const confirmRemoveManagedUser = (user: UserProfile) => Alert.alert(
    'Remove this user?',
    `Remove ${user.fullName} (${user.userId}) from WashFlow? Their sign-in will be blocked.`,
    [
      { text: 'Keep user', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => {
        void removeManagedUser(user, profile?.userId ?? '').catch((error: unknown) => Alert.alert('Could not remove user', error instanceof Error ? error.message : 'Try again.'));
      } },
    ],
  );

  const doLogin = async () => {
    setAuthBusy(true); setAuthError('');
    try {
      const signedInProfile = await loginStudent(studentId, password);
      setProfile(signedInProfile);
      if (signedInProfile.role === 'ADMIN' || signedInProfile.role === 'STAFF') setTabState('Bookings');
    }
    catch (error) { setAuthError(error instanceof Error ? error.message : 'Could not sign in.'); }
    finally { setAuthBusy(false); }
  };

  const doRegister = async () => {
    setAuthError('');
    if (password !== confirmPassword) { setAuthError('Passwords do not match.'); return; }
    setAuthBusy(true);
    try {
      await registerStudent({ userId: studentId, fullName, roomNumber, hostel, password });
      await logOut();
      setProfile(null);
      setAuthMode('login');
      setStudentId('');
      setPassword('');
      setConfirmPassword('');
      setFullName('');
      setRoomNumber('');
      setHostel('');
      Alert.alert('Account created', 'Your account is ready. Please sign in with your user ID and password.');
    } catch (error) { setAuthError(error instanceof Error ? error.message : 'Could not create your account.'); }
    finally { setAuthBusy(false); }
  };

  const saveProfile = async () => {
    setProfileBusy(true);
    try {
      const updated = await updateOwnProfile(profile!, { fullName: profileName, roomNumber: profileRoom, hostel: profileHostel });
      setProfile(updated);
      Alert.alert('Profile saved', 'Your profile has been updated.');
    } catch (error) {
      Alert.alert('Could not save profile', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setProfileBusy(false);
    }
  };

  const saveNewPassword = async () => {
    setProfileBusy(true);
    try {
      await changeOwnPassword(currentPassword, nextPassword);
      setCurrentPassword('');
      setNextPassword('');
      Alert.alert('Password changed', 'Your new password is ready to use.');
    } catch (error) {
      Alert.alert('Could not change password', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setProfileBusy(false);
    }
  };

  if (!authReady || !splashFinished || !splashExitFinished) return <SafeAreaView style={styles.splashScreen}><StatusBar style="dark" /><Animated.View style={[styles.splashContent, { opacity: splashOpacity, transform: [{ scale: splashOpacity.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }]}><Image source={require('./assets/icon.png')} style={styles.splashLogo} resizeMode="contain" /><Text style={styles.splashTitle}>WashFlow</Text><Text style={styles.splashTagline}>Hostel laundry, on your time.</Text></Animated.View></SafeAreaView>;

  if (!profile) return <AuthScreen
    mode={authMode}
    busy={authBusy}
    error={authError}
    configured={firebaseEnabled}
    studentId={studentId}
    fullName={fullName}
    roomNumber={roomNumber}
    hostel={hostel}
    password={password}
    confirmPassword={confirmPassword}
    setStudentId={setStudentId}
    setFullName={setFullName}
    setRoomNumber={setRoomNumber}
    setHostel={setHostel}
    setPassword={setPassword}
    setConfirmPassword={setConfirmPassword}
    onSubmit={authMode === 'login' ? doLogin : doRegister}
    onToggle={() => { setAuthError(''); setConfirmPassword(''); setAuthMode(authMode === 'login' ? 'register' : 'login'); }}
  />;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go to home" onPress={() => setTab(profile.role === 'STUDENT' ? 'Home' : 'Bookings')} style={styles.brandMark}>
          <Image source={require('./assets/icon.png')} style={styles.brandImage} resizeMode="contain" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>WashFlow</Text>
          <Text style={styles.brandSub}>HOSTEL LAUNDRY</Text>
        </View>
        <Pressable style={styles.avatar} onPress={() => setTab('Profile')}><Text style={styles.avatarText}>{profile.fullName.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</Text></Pressable>
      </View>

      {dataError ? <Text style={styles.dataBanner}>{dataError}</Text> : null}
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {bookingMachine ? (
          <View>
            <Pressable onPress={() => setBookingMachine(null)} style={styles.backLink}><Text style={styles.backText}>‹  Back to machines</Text></Pressable>
            <Text style={styles.eyebrow}>NEW BOOKING</Text>
            <Text style={styles.title}>{booked ? 'You’re all set!' : 'Book a machine'}</Text>
            <Text style={styles.subtitle}>{booked ? 'Your laundry slot is confirmed.' : `Reserve ${bookingMachine} for your next wash.`}</Text>
            {booked ? (
              <Card style={styles.confirmCard}>
                <View style={styles.confirmIcon}><Text style={{ fontSize: 26 }}>✓</Text></View>
                <Text style={styles.cardTitle}>Booking confirmed</Text>
                <Text style={styles.body}>{bookingMachine} · {dateLabel(new Date(`${selectedDate}T00:00:00`))}, {displayTime(selectedTime)}</Text>
                <Text style={styles.body}>{cycle}</Text>
                <View style={{ height: 20 }} />
                <Pressable accessibilityRole="button" style={styles.confirmActionButton} onPress={() => { setBookingMachine(null); setTab('Bookings'); }}><Text style={styles.confirmActionButtonText}>View my bookings</Text></Pressable>
              </Card>
            ) : (
              <Card>
                <Text style={styles.label}>MACHINE</Text>
                <Text style={styles.fieldValue}>{bookingMachine}</Text>
                <Text style={[styles.label, { marginTop: 20 }]}>DATE</Text>
                <View style={[styles.chipRow, { flexWrap: 'wrap' }]}>{bookingDays.map((date) => { const key = localDateKey(date); return <Pill key={key} text={date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })} selected={selectedDate === key} onPress={() => setSelectedDate(key)} />; })}</View>
                <Text style={[styles.label, { marginTop: 20 }]}>AVAILABLE START TIMES</Text>
                <View style={[styles.chipRow, { flexWrap: 'wrap' }]}>{availableTimeSlots.map((slot) => { const occupied = bookingMachine ? isTimeOccupied(bookingMachine, selectedDate, slot.start) : false; const timePast = selectedDate === localDateKey(new Date()) && (() => { const [hour, minute] = slot.start.split(':').map(Number); const time = new Date(); time.setHours(hour, minute, 0, 0); return time.getTime() <= clock; })(); return <Pill key={slot.start} text={occupied ? `${displayTime(slot.start)} · Taken` : displayTime(slot.start)} selected={selectedTime === slot.start} disabled={occupied || timePast} onPress={() => setSelectedTime(slot.start)} />; })}</View>
                <Text style={[styles.label, { marginTop: 20 }]}>WASH CYCLE</Text>
                <View style={styles.cycleRow}>{['Quick cycle', 'Normal cycle', 'Heavy cycle'].map((item) => <Pressable key={item} style={[styles.cycleOption, cycle === item && styles.cycleSelected]} onPress={() => setCycle(item)}><Text style={[styles.cycleText, cycle === item && { color: palette.blue }]}>{item}</Text></Pressable>)}</View>
                <View style={{ height: 24 }} />
                {!!bookingError && <Text style={styles.errorText}>{bookingError}</Text>}
                <Button label={bookingBusy ? 'Saving booking…' : 'Confirm booking'} disabled={bookingBusy || selectedTimeIsPast || (bookingMachine ? isTimeOccupied(bookingMachine, selectedDate, selectedTime) : false)} onPress={confirmBooking} />
                <Text style={styles.helper}>Your slot is reserved atomically when you confirm.</Text>
              </Card>
            )}
          </View>
        ) : tab === 'Home' ? (
          <>
            <View style={styles.hero}>
              <View style={styles.heroTop}><View><Text style={styles.heroGreeting}>{now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase()}</Text><Text style={styles.heroTitle}>Fresh start,{ '\n' }{profile.fullName.split(' ')[0]}.</Text></View><View style={styles.washerArt}><Image source={require('./assets/washer-machine.jpg')} style={styles.homeWasherImage} resizeMode="contain" /></View></View>
              <Text style={styles.heroCopy}>Your laundry day, made simple.</Text>
              <Pressable style={styles.heroButton} onPress={() => setTab('Machines')}><Text style={styles.heroButtonText}>Find a machine  →</Text></Pressable>
            </View>

            <View style={styles.statsRow}>
              <StatCard value={`${availableMachines}`} label="Available now" icon={<Image source={require('./assets/washer-machine.jpg')} style={styles.availableWasherImage} resizeMode="contain" />} tone="blue" />
              <StatCard value={`${myBookings.filter((booking) => booking.startAt >= clock && !['CANCELLED', 'COMPLETED', 'DELIVERED'].includes(booking.status)).length}`} label="Upcoming washes" icon="◷" tone="cyan" />
            </View>

            <SectionHeading title="Your next wash" action="See all" onAction={() => setTab('Bookings')} />
            {nextBooking ? <Card style={styles.bookingCard}>
              <View style={styles.bookingCardTop}><View style={styles.dateTile}><Text style={styles.dateMonth}>{new Date(`${nextBooking.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</Text><Text style={styles.dateDay}>{new Date(`${nextBooking.date}T00:00:00`).getDate()}</Text></View><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{nextBooking.machineId}</Text><Text style={styles.body}>{dateLabel(new Date(`${nextBooking.date}T00:00:00`))} · {displayTime(nextBooking.startTime)}</Text></View><Badge text={statusLabel(nextBooking.status)} color={statusColor(nextBooking.status)} background={statusBackground(nextBooking.status)} /></View>
              <View style={styles.divider} /><View style={styles.bookingCardBottom}><Text style={styles.smallMuted}>{nextBooking.cycle} · {nextBooking.cycleMinutes} min</Text><Pressable onPress={() => setTab('Activity')}><Text style={styles.link}>Track wash  →</Text></Pressable></View>
            </Card> : <Card style={styles.emptyCard}><Text style={styles.cardTitle}>No upcoming washes</Text><Text style={styles.body}>Pick a machine and reserve an open time slot.</Text><View style={{ height: 14 }} /><Button label="Book a wash" onPress={() => setTab('Machines')} /></Card>}

          </>
        ) : tab === 'Machines' && profile.role !== 'STUDENT' ? (
          <>
            <Text style={styles.eyebrow}>{profile.role === 'ADMIN' ? 'ADMIN TOOLS' : 'LAUNDRY TEAM'}</Text><Text style={styles.title}>Machines</Text><Text style={styles.subtitle}>{profile.role === 'ADMIN' ? 'Add, edit, and manage machine availability.' : 'Check the current machine status.'}</Text>
            {dataError ? <Text style={styles.errorText}>{dataError}</Text> : null}
            {profile.role === 'ADMIN' && <Card style={{ marginTop: 4 }}><Text style={styles.cardTitle}>Add a machine</Text><TextInput style={styles.authInput} placeholder="Machine name, e.g. Washer 05" placeholderTextColor="#94A3B8" value={newMachineName} onChangeText={setNewMachineName} /><View style={{ height: 12 }} /><Button label={adminActionBusy ? 'Adding machine…' : 'Add machine'} disabled={adminActionBusy} onPress={() => { void handleAddMachine(); }} /></Card>}
            {machineConfig.map((machine) => <View key={machine.id}>
              <View style={styles.manageRow}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{machine.id}</Text><Text style={styles.smallMuted}>{machine.status}</Text></View>
                {profile.role === 'ADMIN' ? <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Pressable onPress={() => { const status = machine.status === 'Maintenance' ? 'Available' : 'Maintenance'; void setMachineMaintenance(machine, status).catch((error: unknown) => Alert.alert('Could not update machine', error instanceof Error ? error.message : 'Try again.')); }} style={styles.outlineButton}><Text style={styles.outlineButtonText}>{machine.status === 'Maintenance' ? 'Available' : 'Maintenance'}</Text></Pressable>
                  <Pressable onPress={() => { setEditingMachineId(machine.id); setEditedMachineName(machine.id); }} style={styles.outlineButton}><Text style={styles.outlineButtonText}>Edit</Text></Pressable>
                  <Pressable onPress={() => confirmRemoveMachine(machine)} style={[styles.outlineButton, { borderColor: palette.red }]}><Text style={styles.cancelText}>Remove</Text></Pressable>
                </View> : <Badge text={machine.status} color={machine.status === 'Available' ? palette.green : palette.orange} background={machine.status === 'Available' ? '#E7F7F1' : '#FFF1E8'} />}
              </View>
              {profile.role === 'ADMIN' && editingMachineId === machine.id && <Card style={{ marginTop: 8 }}><Text style={styles.cardTitle}>Edit machine name</Text><TextInput style={styles.authInput} value={editedMachineName} onChangeText={setEditedMachineName} placeholder="Machine name" /><View style={{ height: 10 }} /><Button label={adminActionBusy ? 'Saving…' : 'Save name'} disabled={adminActionBusy} onPress={() => { void handleRenameMachine(machine); }} /><Pressable style={styles.authToggle} onPress={() => setEditingMachineId(null)}><Text style={styles.link}>Cancel</Text></Pressable></Card>}
            </View>)}
            {!machineConfig.length && <Card style={styles.emptyCard}><Text style={styles.body}>No machines have been added.</Text></Card>}
            {profile.role === 'ADMIN' && <Card style={{ marginTop: 22 }}><Text style={styles.cardTitle}>Custom time slots</Text><Text style={styles.body}>Each custom slot is one hour and is added alongside the weekday and weekend schedule. Times use 24-hour format.</Text><View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}><TextInput style={[styles.authInput, { flex: 1 }]} placeholder="Start, e.g. 14:00" placeholderTextColor="#94A3B8" value={slotStart} onChangeText={setSlotStart} /><TextInput style={[styles.authInput, { flex: 1 }]} placeholder="End, e.g. 15:00" placeholderTextColor="#94A3B8" value={slotEnd} onChangeText={setSlotEnd} /></View><View style={{ height: 10 }} /><Button label={adminActionBusy ? 'Saving…' : 'Save custom slot'} disabled={adminActionBusy} onPress={() => { void handleAddSlotTime(); }} />
              {slotTimes.map((slot) => <View key={slot.start} style={styles.manageRow}><Text style={[styles.cardTitle, { flex: 1 }]}>{displayTime(slot.start)} – {displayTime(slot.end)}</Text><Pressable onPress={() => Alert.alert('Remove time slot?', `${displayTime(slot.start)} will no longer be bookable.`, [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { void removeSlotTime(slot).catch((error: unknown) => Alert.alert('Could not remove time', error instanceof Error ? error.message : 'Try again.')); } }])} style={[styles.outlineButton, { borderColor: palette.red }]}><Text style={styles.cancelText}>Remove</Text></Pressable></View>)}
            </Card>}
          </>
        ) : tab === 'Machines' ? (
          <>
            <Text style={styles.eyebrow}>LIVE AVAILABILITY</Text><Text style={styles.title}>Machines</Text><Text style={styles.subtitle}>Choose a machine and find a time that works.</Text>
            <View style={styles.searchBox}><Text style={{ fontSize: 17 }}>⌕</Text><TextInput placeholder="Search machines" placeholderTextColor="#94A3B8" value={query} onChangeText={setQuery} style={styles.searchInput} /></View>
            <View style={styles.filterRow}>{(['All machines', 'Available'] as const).map((filter) => <Pill key={filter} text={filter} selected={machineFilter === filter} onPress={() => setMachineFilter(filter)} />)}</View>
            <Text style={[styles.sectionTitle, { marginTop: 16 }]}>{availableMachines} available · updates live</Text>
            {filteredMachines.map((machine) => <MachineCard key={machine.id} machine={machine} onBook={() => startBooking(machine)} />)}
          </>
        ) : tab === 'Bookings' && profile.role !== 'STUDENT' ? (
          <>
            <Text style={styles.eyebrow}>{profile.role === 'ADMIN' ? 'ADMIN TOOLS' : 'LAUNDRY TEAM'}</Text><Text style={styles.title}>{profile.role === 'STAFF' ? 'All bookings' : 'Today’s bookings'}</Text><Text style={styles.subtitle}>{profile.role === 'STAFF' ? 'Student reservations across all dates.' : `${dateLabel(new Date(`${todayKey}T00:00:00`))} · review today’s schedule.`}</Text>
            <View style={[styles.filterRow, { marginBottom: 12 }]}>{(['Scheduled', 'Completed', 'Cancelled'] as const).map((filter) => <Pill key={filter} text={filter} selected={staffBookingFilter === filter} onPress={() => setStaffBookingFilter(filter)} />)}</View>
            <Card style={{ marginBottom: 14 }}><Text style={styles.cardTitle}>{profile.role === 'STAFF' ? `${visibleStaffBookings.length} ${staffBookingFilter.toLowerCase()} bookings` : `${visibleTodayBookings.length} ${staffBookingFilter.toLowerCase()} bookings today`}</Text></Card>
            {(profile.role === 'STAFF' ? visibleStaffBookings : visibleTodayBookings).length ? [...(profile.role === 'STAFF' ? visibleStaffBookings : visibleTodayBookings)].sort((a, b) => a.startAt - b.startAt).map((booking) => <Card key={booking.id} style={{ marginBottom: 12 }}><View style={styles.bookingCardTop}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{booking.machineId} · {booking.fullName || 'Student'}</Text><Text style={styles.body}>ID {booking.userId}{booking.roomNumber ? ` · Room ${booking.roomNumber}` : ''}</Text><Text style={styles.body}>{dateLabel(new Date(`${booking.date}T00:00:00`))} · {displayTime(booking.startTime)} – {displayTime(booking.endTime)} · {booking.cycle}</Text></View><Badge text={statusLabel(booking.status)} color={statusColor(booking.status)} background={statusBackground(booking.status)} /></View>{profile.role === 'STAFF' && !['CANCELLED', 'COMPLETED', 'DELIVERED'].includes(booking.status) && <View style={{ marginTop: 12 }}><Button label={nextStaffStatus(booking.status)} onPress={() => { const next = nextStaffStatusValue(booking.status); void updateWashStatus(booking, next).catch((error: unknown) => Alert.alert('Could not update status', error instanceof Error ? error.message : 'Try again.')); }} /></View>}</Card>) : <Card style={styles.emptyCard}><Text style={styles.cardTitle}>{profile.role === 'STAFF' ? `No ${staffBookingFilter.toLowerCase()} bookings` : 'No bookings for today'}</Text><Text style={styles.body}>{profile.role === 'STAFF' ? `There are no ${staffBookingFilter.toLowerCase()} student bookings.` : 'Today’s confirmed student bookings will appear here.'}</Text></Card>}
          </>
        ) : tab === 'Bookings' ? (
          <>
            <Text style={styles.eyebrow}>YOUR LAUNDRY PLAN</Text><Text style={styles.title}>My bookings</Text><Text style={styles.subtitle}>Keep track of upcoming and past washes.</Text>
            <View style={[styles.filterRow, { alignItems: 'center' }]}>{(['Scheduled', 'Completed', 'Cancelled'] as const).map((filter) => <Pill key={filter} text={filter} selected={bookingFilter === filter} onPress={() => { setBookingFilter(filter); setSelectingBookingsToClear(false); setSelectedBookingIds([]); }} />)}{selectingBookingsToClear ? <Pressable onPress={() => { setSelectingBookingsToClear(false); setSelectedBookingIds([]); }} style={{ marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 8 }}><Text style={styles.link}>Cancel</Text></Pressable> : <Pressable disabled={!clearableBookings.length} onPress={() => { setSelectedBookingIds([]); setSelectingBookingsToClear(true); }} style={{ marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 8, opacity: clearableBookings.length ? 1 : 0.45 }}><Text style={styles.cancelText}>Clear</Text></Pressable>}</View>
            {selectingBookingsToClear && <Card style={{ marginTop: 12 }}><Text style={styles.cardTitle}>Select completed or cancelled bookings</Text><Text style={styles.body}>{selectedBookingsToClear.length} selected. Only selected bookings will be removed.</Text><View style={{ height: 10 }} /><Button label={`Clear selected (${selectedBookingsToClear.length})`} disabled={!selectedBookingsToClear.length} onPress={confirmClearBookings} /></Card>}
            {visibleBookings.length ? visibleBookings.map((booking) => {
              const canClear = ['CANCELLED', 'COMPLETED', 'DELIVERED'].includes(booking.status);
              const selected = selectedBookingIds.includes(booking.id);
            return <Card key={booking.id} style={[{ marginTop: 12 }, selected && { borderColor: palette.blue, borderWidth: 2 }]}><View style={styles.bookingCardTop}><View style={styles.dateTile}><Text style={styles.dateMonth}>{new Date(`${booking.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</Text><Text style={styles.dateDay}>{new Date(`${booking.date}T00:00:00`).getDate()}</Text></View><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{booking.machineId || 'Laundry booking'}</Text><Text style={styles.body}>{dateLabel(new Date(`${booking.date}T00:00:00`))} · {displayTime(booking.startTime)}</Text></View><Badge text={statusLabel(booking.status)} color={statusColor(booking.status)} background={statusBackground(booking.status)} /></View><View style={styles.divider} /><View style={styles.bookingCardBottom}><Text style={styles.smallMuted}>{booking.cycle} · {booking.cycleMinutes} min</Text>{selectingBookingsToClear && canClear ? <Pressable onPress={() => toggleBookingForClear(booking.id)} style={styles.outlineButton}><Text style={styles.outlineButtonText}>{selected ? '✓ Selected' : 'Select'}</Text></Pressable> : bookingFilter === 'Scheduled' && booking.status === 'BOOKED' && <Pressable onPress={() => Alert.alert('Cancel booking?', 'Your reserved machine time will be released.', [{ text: 'Keep booking', style: 'cancel' }, { text: 'Cancel booking', style: 'destructive', onPress: () => { void cancelBooking(booking).catch((error: unknown) => Alert.alert('Could not cancel', error instanceof Error ? error.message : 'Try again.')); } }])}><Text style={styles.cancelText}>Cancel</Text></Pressable>}</View></Card>;
            }) : <Card style={[styles.emptyCard, { marginTop: 16 }]}><Text style={styles.cardTitle}>Nothing here yet</Text><Text style={styles.body}>{bookingFilter === 'Scheduled' ? 'Your scheduled washes will show up here.' : `No ${bookingFilter.toLowerCase()} washes to show.`}</Text></Card>}
            <View style={styles.tipBox}><Text style={styles.tipIcon}>✦</Text><Text style={styles.body}>We’ll remind you 15 minutes before your wash starts.</Text></View>
          </>
        ) : tab === 'Activity' ? (
          <>
            <Text style={styles.eyebrow}>WASH TRACKER</Text><Text style={styles.title}>Your activity</Text><Text style={styles.subtitle}>Follow your wash from start to finish.</Text>
            {trackedBooking ? <><Card style={styles.activityCard}><View style={styles.activityHeader}><View><Text style={styles.label}>{trackedBooking.machineId} · {dateLabel(new Date(`${trackedBooking.date}T00:00:00`))} · {displayTime(trackedBooking.startTime)}</Text><Text style={styles.cardTitle}>{statusLabel(trackedBooking.status)}</Text></View><Badge text={statusLabel(trackedBooking.status)} color={statusColor(trackedBooking.status)} background={statusBackground(trackedBooking.status)} /></View><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` as `${number}%` }]} /></View><View style={styles.bookingCardBottom}><Text style={styles.smallMuted}>{washStatusMessage}</Text><Text style={styles.link}>{progress}%</Text></View></Card>
            {['Booking confirmed', 'Laundry collected', 'Wash in progress', 'Ready for collection', 'Delivered'].map((step, index) => { const completed = washStage >= 0 && index < washStage; const inProgress = washStage === index; return <View key={step} style={styles.stepRow}><View style={[styles.stepDot, completed && styles.stepDone, inProgress && styles.stepCurrent]}><Text style={styles.stepMark}>{completed ? '✓' : `${index + 1}`}</Text></View><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{step}</Text><Text style={styles.smallMuted}>{completed ? 'Complete' : inProgress ? statusLabel(trackedBooking.status) : 'Waiting'}</Text></View></View>; })}</> : <Card style={styles.emptyCard}><Text style={styles.cardTitle}>No wash to track</Text><Text style={styles.body}>Your bookings will appear here once you reserve a machine.</Text><View style={{ height: 14 }} /><Button label="View my bookings" onPress={() => setTab('Bookings')} /></Card>}
          </>
        ) : tab === 'Profile' ? (
          <>
            <Text style={styles.eyebrow}>YOUR ACCOUNT</Text><Text style={styles.title}>Profile</Text><Text style={styles.subtitle}>Edit your details, password, and wash preferences.</Text>
            <Card style={{ marginTop: 4 }}>
              <Text style={styles.cardTitle}>Personal details</Text>
              <TextInput style={styles.authInput} placeholder="Full name" placeholderTextColor="#94A3B8" value={profileName} onChangeText={setProfileName} />
              {profile.role === 'STUDENT' && <><TextInput style={styles.authInput} placeholder="Room number" placeholderTextColor="#94A3B8" value={profileRoom} onChangeText={setProfileRoom} /><HostelPicker label="HOSTEL" value={profileHostel} onChange={setProfileHostel} /></>}
              <View style={{ height: 16 }} /><Button label={profileBusy ? 'Saving…' : 'Save profile'} disabled={profileBusy} onPress={() => { void saveProfile(); }} />
            </Card>
            <Card style={{ marginTop: 14 }}><Text style={styles.cardTitle}>Change password</Text><TextInput style={styles.authInput} placeholder="Current password" placeholderTextColor="#94A3B8" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry /><TextInput style={styles.authInput} placeholder="New password (6+ characters)" placeholderTextColor="#94A3B8" value={nextPassword} onChangeText={setNextPassword} secureTextEntry /><View style={{ height: 12 }} /><Button label={profileBusy ? 'Updating…' : 'Change password'} disabled={profileBusy} onPress={() => { void saveNewPassword(); }} /></Card>
            <Pressable onPress={() => { void logOut(); }} style={[styles.profileItem, { justifyContent: 'center', marginTop: 14, paddingVertical: 16, backgroundColor: palette.surface, borderRadius: 13 }]}><Text style={styles.cancelText}>Log out</Text></Pressable>
          </>
        ) : tab === 'Reports' && profile.role === 'ADMIN' ? (
          <>
            <Text style={styles.eyebrow}>ADMIN REPORTS</Text><Text style={styles.title}>Usage summary</Text><Text style={styles.subtitle}>Bookings per day over the last seven days. Cancelled bookings are excluded.</Text>
            <Card style={{ marginTop: 4 }}><Text style={styles.cardTitle}>{dailyUsage.reduce((sum, day) => sum + day.count, 0)} bookings this week</Text>{(() => { const max = Math.max(1, ...dailyUsage.map((day) => day.count)); return dailyUsage.map((day) => <View key={day.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 }}><Text style={[styles.smallMuted, { width: 42 }]}>{day.label}</Text><View style={styles.reportTrack}><View style={[styles.reportBar, { width: `${Math.max(day.count ? 5 : 0, (day.count / max) * 100)}%` as `${number}%` }]} /></View><Text style={[styles.cardTitle, { width: 24, textAlign: 'right' }]}>{day.count}</Text></View>); })()}</Card>
          </>
        ) : tab === 'Users' && profile.role === 'ADMIN' ? (
          <>
            <Text style={styles.eyebrow}>ADMIN TOOLS</Text><Text style={styles.title}>Users & staff</Text><Text style={styles.subtitle}>Add accounts and remove access when someone leaves the laundry team.</Text>
            {dataError ? <Text style={styles.errorText}>{dataError}</Text> : null}
            <Card style={{ marginTop: 4 }}>
              <Text style={styles.cardTitle}>Add staff</Text>
              <TextInput style={styles.authInput} placeholder="Staff user ID, e.g. staff01" placeholderTextColor="#94A3B8" value={newManagedUserId} onChangeText={setNewManagedUserId} autoCapitalize="none" />
              <TextInput style={styles.authInput} placeholder="Full name" placeholderTextColor="#94A3B8" value={newManagedUserName} onChangeText={setNewManagedUserName} />
              <TextInput style={styles.authInput} placeholder="Temporary password (6+ characters)" placeholderTextColor="#94A3B8" value={newManagedUserPassword} onChangeText={setNewManagedUserPassword} secureTextEntry />
              <View style={{ height: 12 }} /><Button label={adminActionBusy ? 'Adding staff…' : 'Add staff'} disabled={adminActionBusy} onPress={() => { void handleAddManagedUser(); }} />
              <Text style={styles.helper}>Staff sign in with their ID and @washflow.app.</Text>
            </Card>
            <SectionHeading title={`Accounts (${users.length})`} action="Refresh" onAction={() => setClock(Date.now())} />
            {users.length ? users.map((user) => <View key={user.userId} style={styles.manageRow}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{user.fullName}</Text><Text style={styles.smallMuted}>{user.userId} · {user.role}</Text></View>{user.role !== 'ADMIN' && <Pressable onPress={() => confirmRemoveManagedUser(user)} style={[styles.outlineButton, { borderColor: palette.red }]}><Text style={styles.cancelText}>Remove</Text></Pressable>}</View>) : <Card style={styles.emptyCard}><Text style={styles.body}>No accounts found.</Text></Card>}
            <View style={styles.divider} /><Pressable style={styles.profileItem} onPress={() => { void logOut(); }}><Text style={styles.cancelText}>Sign out</Text></Pressable>
          </>
        ) : (
          <>
            <Text style={styles.eyebrow}>{profile.role === 'ADMIN' ? 'ADMIN TOOLS' : 'LAUNDRY TEAM'}</Text><Text style={styles.title}>{profile.role === 'ADMIN' ? 'Manage machines' : 'Staff dashboard'}</Text><Text style={styles.subtitle}>{profile.role === 'ADMIN' ? 'Set machine availability, add machines, and remove machines from service.' : 'Review today’s laundry schedule and update machine status.'}</Text>
            {dataError ? <Text style={styles.errorText}>{dataError}</Text> : null}
            {profile.role === 'ADMIN' && <Card style={{ marginTop: 4 }}><Text style={styles.cardTitle}>Add a machine</Text><TextInput style={styles.authInput} placeholder="Machine name, e.g. Washer 05" placeholderTextColor="#94A3B8" value={newMachineName} onChangeText={setNewMachineName} /><View style={{ height: 12 }} /><Button label={adminActionBusy ? 'Adding machine…' : 'Add machine'} disabled={adminActionBusy} onPress={() => { void handleAddMachine(); }} /></Card>}
            <Text style={styles.sectionTitle}>Machine availability</Text>
            {machineConfig.length ? machineConfig.map((machine) => <View key={machine.id} style={styles.manageRow}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{machine.id}</Text><Text style={styles.smallMuted}>{machine.status}</Text></View><Pressable onPress={() => { const status = machine.status === 'Maintenance' ? 'Available' : 'Maintenance'; void setMachineMaintenance(machine, status).catch((error: unknown) => Alert.alert('Could not update machine', error instanceof Error ? error.message : 'Try again.')); }} style={styles.outlineButton}><Text style={styles.outlineButtonText}>{machine.status === 'Maintenance' ? 'Set available' : 'Maintenance'}</Text></Pressable>{profile.role === 'ADMIN' && <Pressable onPress={() => confirmRemoveMachine(machine)} style={[styles.outlineButton, { borderColor: palette.red }]}><Text style={styles.cancelText}>Remove</Text></Pressable>}</View>) : <Card style={styles.emptyCard}><Text style={styles.body}>No machines yet. Add one above.</Text></Card>}
            {profile.role === 'STAFF' && <><SectionHeading title="Bookings" action="Refresh" onAction={() => setClock(Date.now())} />{allBookings.length ? allBookings.slice(0, 20).map((booking) => <Card key={booking.id} style={{ marginBottom: 10 }}><View style={styles.bookingCardTop}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{booking.machineId || 'Laundry'} · {booking.fullName || booking.userId}</Text><Text style={styles.body}>{booking.roomNumber ? `Room ${booking.roomNumber} · ` : ''}{dateLabel(new Date(`${booking.date}T00:00:00`))} · {displayTime(booking.startTime)}</Text></View><Badge text={statusLabel(booking.status)} color={statusColor(booking.status)} background={statusBackground(booking.status)} /></View>{!['CANCELLED', 'COMPLETED', 'DELIVERED'].includes(booking.status) && <View style={{ marginTop: 12 }}><Button label={nextStaffStatus(booking.status)} onPress={() => { const next = nextStaffStatusValue(booking.status); void updateWashStatus(booking, next).catch((error: unknown) => Alert.alert('Could not update status', error instanceof Error ? error.message : 'Try again.')); }} /></View>}</Card>) : <Card style={styles.emptyCard}><Text style={styles.cardTitle}>No bookings yet</Text><Text style={styles.body}>Student reservations will appear here as they are made.</Text></Card>}</>}
            <View style={styles.divider} /><Pressable style={styles.profileItem} onPress={() => { void logOut(); }}><Text style={styles.cancelText}>Sign out</Text></Pressable>
          </>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>

      {!bookingMachine && <View style={styles.tabBar}>{activeTabs.map((item) => <Pressable key={item} style={styles.tabButton} onPress={() => setTab(item)}><Text style={[styles.tabIcon, tab === item && styles.tabIconActive]}>{({ Home: '⌂', Machines: '◉', Bookings: '▤', Activity: '◴', Profile: '○', Manage: '▦', Users: '♙', Reports: '▥' } as Record<Tab, string>)[item]}</Text><Text style={[styles.tabLabel, tab === item && styles.tabLabelActive]}>{item}</Text></Pressable>)}</View>}
    </SafeAreaView>
  );
}

function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) { return <View style={[styles.card, style]}>{children}</View>; }
function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) { return <Pressable disabled={disabled} style={[styles.button, disabled && styles.buttonDisabled]} onPress={onPress}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
function Pill({ text, selected, onPress, disabled }: { text: string; selected?: boolean; onPress: () => void; disabled?: boolean }) { return <Pressable disabled={disabled} style={[styles.pill, selected && styles.pillSelected, disabled && styles.pillDisabled]} onPress={onPress}><Text style={[styles.pillText, selected && styles.pillTextSelected, disabled && styles.pillTextDisabled]}>{text}</Text></Pressable>; }
function Badge({ text, color, background }: { text: string; color: string; background: string }) { return <View style={[styles.badge, { backgroundColor: background }]}><Text style={[styles.badgeText, { color }]}>{text}</Text></View>; }
function SectionHeading({ title, action, onAction }: { title: string; action: string; onAction: () => void }) { return <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{title}</Text><Pressable onPress={onAction}><Text style={styles.link}>{action}  →</Text></Pressable></View>; }
function StatCard({ value, label, icon, tone }: { value: string; label: string; icon: ReactNode; tone: 'blue' | 'cyan' }) { return <View style={styles.statCard}><View style={[styles.statIcon, { backgroundColor: tone === 'blue' ? palette.softBlue : '#E6FAFC' }]}>{typeof icon === 'string' ? <Text style={{ color: tone === 'blue' ? palette.blue : palette.cyan, fontSize: 19 }}>{icon}</Text> : icon}</View><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>; }
function MachineCard({ machine, onBook, compact }: { machine: Machine; onBook: () => void; compact?: boolean }) { const good = machine.status === 'Available'; const statusColor = good ? palette.green : machine.status === 'In Use' ? palette.orange : palette.muted; const statusBackground = good ? '#E7F7F1' : machine.status === 'In Use' ? '#FFF1E8' : '#F1F5F9'; const disabled = machine.status === 'Maintenance'; return <Card style={styles.machineCard}><View style={styles.machineVisual}><Image source={require('./assets/washer-machine.jpg')} style={compact ? styles.machineImageCompact : styles.machineImage} resizeMode="contain" /></View><View style={styles.machineDetails}><View style={styles.machineTitleRow}><Text style={styles.cardTitle}>{machine.id}</Text><Badge text={machine.status} color={statusColor} background={statusBackground} /></View><Text style={styles.body}>{machine.nextFree ? `Free at ${machine.nextFree}` : machine.status === 'Available' ? 'Ready to book' : machine.status}</Text></View><Pressable disabled={disabled} style={[styles.bookButton, !good && styles.bookButtonDisabled]} onPress={onBook}><Text style={[styles.bookButtonText, !good && { color: palette.muted }]}>{good ? 'Book' : machine.status === 'In Use' ? 'Pick time' : 'Unavailable'}</Text></Pressable></Card>; }

function statusLabel(status: BookingStatus) {
  if (status === 'BOOKED') return 'Scheduled';
  if (status === 'COLLECTED') return 'Collected';
  if (status === 'WASHING') return 'Washing';
  if (status === 'READY') return 'Ready';
  if (status === 'DELIVERED' || status === 'COMPLETED') return 'Completed';
  return 'Cancelled';
}
function statusColor(status: BookingStatus) {
  if (status === 'WASHING' || status === 'COLLECTED') return palette.orange;
  if (status === 'READY' || status === 'DELIVERED' || status === 'COMPLETED') return palette.green;
  if (status === 'CANCELLED') return palette.red;
  return palette.blue;
}
function statusBackground(status: BookingStatus) {
  if (status === 'WASHING' || status === 'COLLECTED') return '#FFF1E8';
  if (status === 'READY' || status === 'DELIVERED' || status === 'COMPLETED') return '#E7F7F1';
  if (status === 'CANCELLED') return '#FEF2F2';
  return palette.softBlue;
}
function nextStaffStatusValue(status: BookingStatus): BookingStatus {
  if (status === 'BOOKED') return 'COLLECTED';
  if (status === 'COLLECTED') return 'WASHING';
  if (status === 'WASHING') return 'READY';
  return 'DELIVERED';
}
function nextStaffStatus(status: BookingStatus) {
  const next = nextStaffStatusValue(status);
  return `Mark ${statusLabel(next).toLowerCase()}`;
}

function AuthScreen(props: {
  mode: 'login' | 'register'; busy: boolean; error: string; configured: boolean;
  studentId: string; fullName: string; roomNumber: string; hostel: string; password: string; confirmPassword: string;
  setStudentId: (value: string) => void; setFullName: (value: string) => void;
  setRoomNumber: (value: string) => void; setHostel: (value: string) => void;
  setPassword: (value: string) => void; setConfirmPassword: (value: string) => void; onSubmit: () => void; onToggle: () => void;
}) {
  const register = props.mode === 'register';
  return <SafeAreaView style={styles.safe}><StatusBar style="dark" /><ScrollView contentContainerStyle={styles.authPage} keyboardShouldPersistTaps="handled">
    <Image source={require('./assets/icon.png')} style={styles.authMark} resizeMode="contain" /><Text style={[styles.brand, styles.authBrand]}>WashFlow</Text><Text style={styles.authTagline}>Hostel laundry, on your time.</Text>
    <Card style={styles.authCard}><Text style={styles.title}>{register ? 'Create account' : 'Welcome back'}</Text><Text style={styles.subtitle}>{register ? 'Set up your student profile to book a wash.' : 'Sign in to view machines and manage your washes.'}</Text>
      {!props.configured ? <Text style={styles.errorText}>Firebase is not configured. Add the project settings to .env.local and restart Expo.</Text> : null}
      {register ? <><AuthInput label="FULL NAME" placeholder="Your name" value={props.fullName} onChangeText={props.setFullName} /><AuthInput label="ROOM NUMBER" placeholder="e.g. 204" value={props.roomNumber} onChangeText={props.setRoomNumber} /><HostelPicker label="HOSTEL" value={props.hostel} onChange={props.setHostel} /></> : null}
      <AuthInput label={register ? 'CST STUDENT EMAIL' : 'USER ID'} placeholder={register ? '02230127.cst@rub.edu.bt' : 'StdID'} value={props.studentId} onChangeText={props.setStudentId} autoCapitalize="none" />
      <AuthInput label="PASSWORD" placeholder="At least 6 characters" value={props.password} onChangeText={props.setPassword} secureTextEntry />
      {register && <AuthInput label="CONFIRM PASSWORD" placeholder="Re-enter your password" value={props.confirmPassword} onChangeText={props.setConfirmPassword} secureTextEntry />}
      {props.error ? <Text style={styles.errorText}>{props.error}</Text> : null}
      <Button label={props.busy ? 'Please wait…' : register ? 'Create student account' : 'Sign in'} disabled={props.busy || !props.configured} onPress={props.onSubmit} />
      <Pressable style={styles.authToggle} onPress={props.onToggle}><Text style={styles.body}>{register ? 'Already have an account? ' : 'New to WashFlow? '}<Text style={styles.link}>{register ? 'Sign in' : 'Create an account'}</Text></Text></Pressable>
    </Card><Text style={styles.authFootnote}>Your account is secured by Firebase Authentication.</Text>
  </ScrollView></SafeAreaView>;
}

function AuthInput(props: { label: string; placeholder: string; value: string; onChangeText: (value: string) => void; secureTextEntry?: boolean; autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters' }) {
  return <View style={styles.authInputGroup}><Text style={styles.label}>{props.label}</Text><TextInput style={styles.authInput} placeholder={props.placeholder} placeholderTextColor="#94A3B8" value={props.value} onChangeText={props.onChangeText} secureTextEntry={props.secureTextEntry} autoCapitalize={props.autoCapitalize ?? (props.secureTextEntry ? 'none' : 'words')} autoCorrect={false} /></View>;
}

function HostelPicker(props: { label: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  return <View style={styles.authInputGroup}>
    <Text style={styles.label}>{props.label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`${props.label}: ${props.value || 'Select hostel'}`} onPress={() => setOpen((current) => !current)} style={styles.hostelPicker}>
      <Text style={[styles.hostelPickerText, !props.value && styles.hostelPlaceholder]}>{props.value || 'Select hostel'}</Text>
      <Text style={styles.hostelChevron}>{open ? '⌃' : '⌄'}</Text>
    </Pressable>
    {open && <View style={styles.hostelOptions}>{HOSTEL_NAMES.map((name) => <Pressable key={name} accessibilityRole="button" onPress={() => { props.onChange(name); setOpen(false); }} style={[styles.hostelOption, props.value === name && styles.hostelOptionSelected]}><Text style={[styles.hostelPickerText, props.value === name && styles.hostelOptionTextSelected]}>{name}</Text>{props.value === name && <Text style={styles.link}>✓</Text>}</Pressable>)}</View>}
  </View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  splashScreen: { flex: 1, backgroundColor: '#F7FAFF', alignItems: 'center', justifyContent: 'center' },
  splashContent: { alignItems: 'center', justifyContent: 'center' },
  splashLogo: { width: 116, height: 116, marginBottom: 16 },
  splashTitle: { color: palette.ink, fontSize: 27, fontWeight: '800', letterSpacing: -0.6 },
  splashTagline: { color: palette.muted, fontSize: 14, marginTop: 7 },
  topbar: { height: 66, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', backgroundColor: palette.surface, borderBottomWidth: 1, borderBottomColor: palette.line, gap: 11 },
  brandMark: { width: 42, height: 42, borderRadius: 13, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, brandImage: { width: 42, height: 42 },
  brand: { color: palette.ink, fontSize: 17, fontWeight: '800', letterSpacing: -0.3 }, brandSub: { color: palette.muted, fontSize: 9, letterSpacing: 1.3, marginTop: 1, fontWeight: '700' },
  avatar: { width: 38, height: 38, borderRadius: 13, backgroundColor: '#DDEAFE', alignItems: 'center', justifyContent: 'center' }, avatarText: { color: palette.blue, fontSize: 13, fontWeight: '800' },
  page: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 18 },
  hero: { backgroundColor: palette.blue, borderRadius: 24, padding: 22, overflow: 'hidden' }, heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, heroGreeting: { color: '#C9DBFF', fontSize: 10, letterSpacing: 1.4, fontWeight: '800' }, heroTitle: { color: 'white', fontSize: 31, fontWeight: '800', lineHeight: 34, letterSpacing: -0.8, marginTop: 8 }, heroCopy: { color: '#DCE8FF', fontSize: 13, marginTop: 10 }, washerArt: { width: 74, height: 82, marginRight: 5, marginTop: 7, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', gap: 2 }, homeWasherImage: { width: 70, height: 70, borderRadius: 12 }, heroButton: { marginTop: 19, alignSelf: 'flex-start', borderRadius: 12, backgroundColor: 'white', paddingHorizontal: 15, paddingVertical: 11 }, heroButtonText: { color: palette.blue, fontSize: 13, fontWeight: '800' },
  statsRow: { flexDirection: 'row', gap: 12, marginTop: 14 }, statCard: { flex: 1, backgroundColor: palette.surface, borderRadius: 18, padding: 15, borderWidth: 1, borderColor: palette.line }, statIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 10, overflow: 'hidden' }, availableWasherImage: { width: 34, height: 34, borderRadius: 7 }, statValue: { color: palette.ink, fontSize: 23, fontWeight: '800' }, statLabel: { color: palette.muted, fontSize: 11, marginTop: 2, fontWeight: '600' },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 26, marginBottom: 12 }, sectionTitle: { color: palette.ink, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 }, link: { color: palette.blue, fontSize: 12, fontWeight: '700' },
  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: 18, padding: 16 }, bookingCard: { padding: 15 }, bookingCardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 }, dateTile: { width: 46, height: 48, borderRadius: 12, backgroundColor: palette.softBlue, alignItems: 'center', justifyContent: 'center' }, dateMonth: { color: palette.blue, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 }, dateDay: { color: palette.blue, fontSize: 18, fontWeight: '800', marginTop: 1 }, cardTitle: { color: palette.ink, fontSize: 14, fontWeight: '800' }, body: { color: palette.muted, fontSize: 12, marginTop: 4, lineHeight: 17 }, badge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8 }, badgeText: { fontSize: 10, fontWeight: '800' }, divider: { height: 1, backgroundColor: palette.line, marginVertical: 13 }, bookingCardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, smallMuted: { color: palette.muted, fontSize: 11 },
  machineCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, marginBottom: 10 }, machineVisual: { width: 48, height: 48, borderRadius: 15, backgroundColor: '#EDF5FF', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, machineImage: { width: 46, height: 46, borderRadius: 8 }, machineImageCompact: { width: 40, height: 40, borderRadius: 7 }, machineDetails: { flex: 1 }, machineTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }, bookButton: { backgroundColor: palette.blue, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 9 }, bookButtonDisabled: { backgroundColor: '#F1F5F9' }, bookButtonText: { color: 'white', fontWeight: '800', fontSize: 11 },
  tabBar: { height: 68, borderTopWidth: 1, borderTopColor: palette.line, backgroundColor: palette.surface, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingBottom: 3 }, tabButton: { alignItems: 'center', justifyContent: 'center', minWidth: 55 }, tabIcon: { color: '#94A3B8', fontSize: 20, height: 24 }, tabIconActive: { color: palette.blue }, tabLabel: { color: '#94A3B8', fontSize: 9, fontWeight: '600', marginTop: 1 }, tabLabelActive: { color: palette.blue, fontWeight: '800' },
  eyebrow: { color: palette.blue, fontSize: 10, fontWeight: '800', letterSpacing: 1.25, marginTop: 4 }, title: { color: palette.ink, fontSize: 28, fontWeight: '800', letterSpacing: -0.7, marginTop: 5 }, subtitle: { color: palette.muted, fontSize: 13, lineHeight: 19, marginTop: 5, marginBottom: 16 }, searchBox: { height: 48, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface, borderRadius: 13, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, gap: 9 }, searchInput: { flex: 1, color: palette.ink, fontSize: 13, paddingVertical: 8 }, filterRow: { flexDirection: 'row', gap: 8, marginTop: 13 }, pill: { borderWidth: 1, borderColor: palette.line, borderRadius: 20, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: palette.surface }, pillSelected: { borderColor: palette.blue, backgroundColor: palette.softBlue }, pillText: { color: palette.muted, fontSize: 11, fontWeight: '700' }, pillTextSelected: { color: palette.blue },
  backLink: { marginBottom: 18, paddingVertical: 3 }, backText: { color: palette.blue, fontSize: 13, fontWeight: '700' }, label: { color: palette.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1 }, fieldValue: { color: palette.ink, fontSize: 14, fontWeight: '700', marginTop: 9 }, chipRow: { flexDirection: 'row', gap: 7, marginTop: 10 }, cycleRow: { gap: 8, marginTop: 10 }, cycleOption: { borderWidth: 1, borderColor: palette.line, borderRadius: 11, padding: 12 }, cycleSelected: { backgroundColor: palette.softBlue, borderColor: palette.blue }, cycleText: { color: palette.ink, fontSize: 12, fontWeight: '700' }, button: { backgroundColor: palette.blue, borderRadius: 13, minHeight: 48, justifyContent: 'center', alignItems: 'center' }, buttonText: { color: 'white', fontWeight: '800', fontSize: 14 }, helper: { color: palette.muted, fontSize: 11, textAlign: 'center', marginTop: 10 }, confirmCard: { alignItems: 'center', paddingVertical: 26, marginTop: 8 }, confirmIcon: { width: 56, height: 56, backgroundColor: '#E7F7F1', borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 13 },
  confirmActionButton: { alignSelf: 'stretch', minHeight: 56, marginTop: 2, paddingHorizontal: 18, borderRadius: 14, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center' },
  confirmActionButtonText: { color: 'white', fontSize: 16, fontWeight: '800', letterSpacing: 0.15 },
  tipBox: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: palette.softBlue, borderRadius: 14, padding: 13, marginTop: 16 }, tipIcon: { color: palette.blue, fontWeight: '900' }, cancelText: { color: palette.red, fontSize: 12, fontWeight: '800' }, activityCard: { marginTop: 8, marginBottom: 20 }, activityHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 7 }, progressTrack: { height: 8, backgroundColor: '#E9EEF6', borderRadius: 9, overflow: 'hidden', marginTop: 20, marginBottom: 11 }, progressFill: { height: '100%', backgroundColor: palette.cyan, borderRadius: 9 }, stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }, stepDot: { width: 29, height: 29, borderRadius: 10, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' }, stepDone: { backgroundColor: '#E7F7F1' }, stepCurrent: { backgroundColor: palette.softBlue }, stepMark: { color: palette.green, fontSize: 11, fontWeight: '800' }, profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 15 }, profileItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13 }, bodyStrong: { color: palette.ink, fontSize: 13, fontWeight: '700' }, chevron: { color: '#94A3B8', fontSize: 21 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }, emptyCard: { marginTop: 4 }, errorText: { color: palette.red, backgroundColor: '#FEF2F2', borderRadius: 11, padding: 11, fontSize: 12, lineHeight: 18, marginVertical: 10 }, dataBanner: { color: palette.red, backgroundColor: '#FEF2F2', paddingHorizontal: 16, paddingVertical: 8, fontSize: 11 },
  manageRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: 15, padding: 13, marginTop: 9 }, outlineButton: { borderWidth: 1, borderColor: palette.blue, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8 }, outlineButtonText: { color: palette.blue, fontSize: 10, fontWeight: '800' }, reportTrack: { flex: 1, height: 10, backgroundColor: '#E9EEF6', borderRadius: 8, overflow: 'hidden' }, reportBar: { height: '100%', backgroundColor: palette.blue, borderRadius: 8 },
  buttonDisabled: { opacity: 0.45 }, pillDisabled: { backgroundColor: '#F1F5F9', borderColor: '#E2E8F0' }, pillTextDisabled: { color: '#94A3B8' },
  authPage: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingVertical: 40 }, authMark: { width: 76, height: 76, alignSelf: 'center', marginBottom: 13 }, authBrand: { alignSelf: 'center', textAlign: 'center' }, authTagline: { color: palette.muted, fontSize: 13, textAlign: 'center', marginTop: 5, marginBottom: 24 }, authCard: { padding: 20 }, authInputGroup: { marginTop: 15 }, authInput: { height: 48, borderWidth: 1, borderColor: palette.line, borderRadius: 12, marginTop: 8, paddingHorizontal: 13, color: palette.ink, fontSize: 14, backgroundColor: '#FCFDFE' }, hostelPicker: { height: 48, borderWidth: 1, borderColor: palette.line, borderRadius: 12, marginTop: 8, paddingHorizontal: 13, backgroundColor: '#FCFDFE', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, hostelPickerText: { color: palette.ink, fontSize: 14, fontWeight: '600' }, hostelPlaceholder: { color: '#94A3B8', fontWeight: '400' }, hostelChevron: { color: palette.muted, fontSize: 20 }, hostelOptions: { borderWidth: 1, borderColor: palette.line, borderRadius: 12, marginTop: 6, overflow: 'hidden', backgroundColor: palette.surface }, hostelOption: { minHeight: 42, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: palette.line }, hostelOptionSelected: { backgroundColor: palette.softBlue }, hostelOptionTextSelected: { color: palette.blue }, authToggle: { alignItems: 'center', marginTop: 18 }, authFootnote: { color: palette.muted, textAlign: 'center', fontSize: 11, marginTop: 17 },
});
