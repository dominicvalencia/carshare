import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Android native layout stabilization', () => {
  it('keeps shared screen keyboard compensation platform-separated', () => {
    const primitives = source('src/ui/primitives.tsx');
    expect(primitives).toContain('<KeyboardAvoidingView style={styles.flex}>');
    expect(primitives).not.toContain("behavior={Platform.OS === 'ios' ? 'padding' : undefined}");
    expect(primitives).toContain("automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}");
    expect(primitives).toContain("Platform.OS === 'ios' ? { bottom: spacing.xl } : undefined");
    expect(primitives).toContain('contentInset={iosFocusInsets}');
    expect(primitives).toContain('scrollIndicatorInsets={iosFocusInsets}');
    expect(primitives).toContain("safeTop ? ['top'] : []");
    expect(primitives).toContain('nestedScrollEnabled');
    expect(primitives).toContain("Platform.OS === 'android' ? 'none' : 'on-drag'");
    expect(primitives).toContain('keyboardDismissMode={formKeyboardDismissMode}');
    expect(primitives).toContain("Keyboard.addListener('keyboardDidShow'");
    expect(primitives).toContain("Keyboard.addListener('keyboardDidHide'");
    expect(primitives).toContain(
      "basePadding + (Platform.OS === 'android' ? androidKeyboardHeight : 0)",
    );
    expect(primitives).toContain('{ paddingBottom: keyboardAwareBottomPadding }');
  });

  it('keeps authentication forms scrollable while the keyboard is open', () => {
    const auth = source('src/features/auth/AuthFlow.tsx');
    expect(auth).toContain('<ScrollView');
    expect(auth).toContain('contentContainerStyle={[');
    expect(auth).toContain('styles.scrollContent,');
    expect(auth).toContain('keyboardShouldPersistTaps="handled"');
    expect(auth).toContain('keyboardDismissMode={formKeyboardDismissMode}');
    expect(auth).toContain('scrollContent: { flexGrow: 1 }');
    expect(auth).toContain('useKeyboardAwareBottomPadding()');
    expect(auth).toContain('{ paddingBottom: keyboardAwareBottomPadding }');
  });

  it('protects every renter onboarding page from the bottom system inset', () => {
    const onboarding = source('src/onboarding/GuidedOnboarding.tsx');
    expect(onboarding).toContain("edges={['top', 'bottom']}");
    expect(onboarding).toContain('contentContainerStyle={styles.welcome}');
    expect(onboarding).toContain('welcome: { flexGrow: 1');
  });

  it('uses an in-app front-facing camera for Android selfies only', () => {
    const workflow = source('src/features/account/RenterVerificationWorkflow.tsx');
    const androidCamera = source('src/ui/NativeCameraCapture.android.tsx');
    const iosFallback = source('src/ui/NativeCameraCapture.tsx');
    expect(workflow).toContain("if (Platform.OS === 'android')");
    expect(workflow).toContain('<NativeCameraCapture');
    expect(workflow).toContain('facing="front"');
    expect(workflow).toContain('cameraType: ImagePicker.CameraType.front');
    expect(androidCamera).toContain("from 'expo-camera'");
    expect(androidCamera).toContain('<CameraView facing={facing}');
    expect(iosFallback).not.toContain("from 'expo-camera'");
    expect(iosFallback).toContain('return null');
  });

  it('does not duplicate the tab navigator bottom inset in shared tab scenes', () => {
    const primitives = source('src/ui/primitives.tsx');
    const navigation = source('src/navigation/AppNavigation.tsx');
    expect(primitives).toContain("safeTop ? ['top'] : []");
    expect(navigation).toContain('height: 54 + safeBottom');
    expect(navigation).toContain('paddingBottom: safeBottom');
  });

  it('gives vehicle forms the shared keyboard-aware scroll tail without Android height compensation', () => {
    const vehicles = source('src/features/vehicles/VehiclesScreen.tsx');
    expect(vehicles).toContain('useKeyboardAwareBottomPadding(spacing.xl)');
    expect(vehicles).toContain('{ paddingBottom: keyboardAwareBottomPadding }');
    expect(vehicles).not.toContain("behavior={Platform.OS === 'android' ? 'height' : undefined}");
  });
});
