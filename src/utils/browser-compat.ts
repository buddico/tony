/**
 * Browser compatibility utilities for audio APIs
 * Supports: Chrome, Firefox, Safari (macOS/iOS), Edge, and mobile browsers
 */

// Polyfill AudioContext for Safari
export const AudioContextCompat = (
  window.AudioContext ||
  (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
);

// Check if browser supports required APIs
export function checkBrowserCompatibility(): {
  supported: boolean;
  issues: string[];
  isMobile: boolean;
  isIOS: boolean;
} {
  const issues: string[] = [];

  // Check for AudioContext
  if (!AudioContextCompat) {
    issues.push('Web Audio API not supported');
  }

  // Check for getUserMedia
  if (!navigator.mediaDevices?.getUserMedia) {
    issues.push('Microphone access not supported');
  }

  // Check for secure context (required for getUserMedia)
  if (!window.isSecureContext) {
    issues.push('HTTPS required for microphone access');
  }

  // Detect mobile and iOS
  const userAgent = navigator.userAgent.toLowerCase();
  const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
  const isIOS = /iphone|ipad|ipod/i.test(userAgent);

  return {
    supported: issues.length === 0,
    issues,
    isMobile,
    isIOS
  };
}

// Create AudioContext with compatibility handling
export function createAudioContext(sampleRate: number): AudioContext | null {
  if (!AudioContextCompat) return null;

  try {
    return new AudioContextCompat({ sampleRate });
  } catch (e) {
    // Some browsers don't support custom sample rates
    console.warn('Failed to create AudioContext with custom sample rate, using default');
    return new AudioContextCompat();
  }
}

// Resume AudioContext (required for iOS Safari and some mobile browsers)
export async function resumeAudioContext(ctx: AudioContext): Promise<void> {
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch (e) {
      console.warn('Failed to resume AudioContext:', e);
    }
  }
}

// Get user media with compatibility
export async function getMediaStream(): Promise<MediaStream> {
  // Modern API
  if (navigator.mediaDevices?.getUserMedia) {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
  }

  // Legacy API fallback (for very old browsers - rarely needed now)
  type LegacyGetUserMedia = (
    constraints: MediaStreamConstraints,
    success: (stream: MediaStream) => void,
    error: (err: Error) => void
  ) => void;

  const nav = navigator as Navigator & {
    webkitGetUserMedia?: LegacyGetUserMedia;
    mozGetUserMedia?: LegacyGetUserMedia;
    msGetUserMedia?: LegacyGetUserMedia;
  };

  const legacyGetUserMedia = nav.webkitGetUserMedia || nav.mozGetUserMedia || nav.msGetUserMedia;

  if (legacyGetUserMedia) {
    return new Promise((resolve, reject) => {
      legacyGetUserMedia.call(navigator, { audio: true }, resolve, reject);
    });
  }

  throw new Error('getUserMedia not supported in this browser');
}

// Detect browser name for error messages
export function getBrowserName(): string {
  const ua = navigator.userAgent;

  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Edg')) return 'Edge';
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Safari')) return 'Safari';
  if (ua.includes('Opera') || ua.includes('OPR')) return 'Opera';

  return 'Unknown browser';
}

// Get helpful error message based on browser
export function getCompatibilityHelp(): string {
  const { issues, isMobile, isIOS } = checkBrowserCompatibility();
  const browser = getBrowserName();

  if (issues.includes('HTTPS required for microphone access')) {
    return 'Microphone access requires a secure (HTTPS) connection. Please access this site via HTTPS.';
  }

  if (isIOS) {
    return 'On iOS, please use Safari and ensure you allow microphone access when prompted. Tap the call button to start.';
  }

  if (isMobile) {
    return 'On mobile, please use Chrome or your default browser and allow microphone access when prompted.';
  }

  if (browser === 'Safari') {
    return 'Safari is supported. Please allow microphone access when prompted.';
  }

  if (issues.length > 0) {
    return `Your browser may not be fully supported. Issues: ${issues.join(', ')}. Please try Chrome, Firefox, Safari, or Edge.`;
  }

  return 'Your browser is supported. Click the call button to start.';
}
