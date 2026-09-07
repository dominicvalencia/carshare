import { registerRootComponent } from 'expo';
import * as Sentry from '@sentry/react-native';
import App from './App';
import './src/telemetry/sentry';

registerRootComponent(Sentry.wrap(App));
