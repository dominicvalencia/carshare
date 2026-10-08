import { registerRootComponent } from 'expo';
import * as Sentry from '@sentry/react-native';
import * as SplashScreen from 'expo-splash-screen';
import App from './App';
import './src/telemetry/sentry';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

registerRootComponent(Sentry.wrap(App));
