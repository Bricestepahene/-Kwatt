import { Stack } from 'expo-router';
import { night } from '@kwatt/design';
import { probe } from '@/probe';

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: probe || night.bg } }} />;
}
