import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { night } from '@kwatt/design';

export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: night.bg }}>
      <Svg width={40} height={40}><Circle cx={20} cy={20} r={18} fill={night.action} /></Svg>
      <Text style={{ color: night.text }}>Kwatt</Text>
    </View>
  );
}
