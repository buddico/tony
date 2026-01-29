import { useState, useRef, useEffect } from 'react';
import { Modality } from '@google/genai';
import { SYSTEM_INSTRUCTION } from './navigation-data';
import { createPcmBlob, decodeAudioData } from './utils/audio';
import { AgentState, RoutingResultArgs, RoutingToolDeclaration } from './types';
import { AudioVisualizer } from './components/AudioVisualizer';
import { RoutingCard } from './components/RoutingCard';
import {
  checkBrowserCompatibility,
  createAudioContext,
  resumeAudioContext,
  getMediaStream,
  getCompatibilityHelp
} from './utils/browser-compat';

// Get WebSocket URL - use secure wss:// in production
function getWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/live`;
}

export default function App() {
  const [state, setState] = useState<AgentState>(AgentState.IDLE);
  const [routingResult, setRoutingResult] = useState<RoutingResultArgs | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [browserInfo, setBrowserInfo] = useState<{ supported: boolean; help: string } | null>(null);

  // Check browser compatibility on mount
  useEffect(() => {
    const compat = checkBrowserCompatibility();
    setBrowserInfo({
      supported: compat.supported,
      help: getCompatibilityHelp()
    });
  }, []);

  // Refs for Audio handling
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSession();
    };
  }, []);

  const stopSession = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    // Stop all playing sources
    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) { /* ignore */ }
    });
    sourcesRef.current.clear();

    setState(AgentState.IDLE);
  };

  const startSession = async () => {
    // Check browser compatibility
    const compat = checkBrowserCompatibility();
    if (!compat.supported) {
      setError(`Browser not supported: ${compat.issues.join(', ')}. ${getCompatibilityHelp()}`);
      return;
    }

    try {
      setState(AgentState.PROCESSING); // Show "Please hold" while connecting
      setRoutingResult(null);
      setTranscript('');
      setError(null);

      // 1. Setup Audio Contexts (with browser compatibility)
      inputAudioContextRef.current = createAudioContext(16000);
      outputAudioContextRef.current = createAudioContext(24000);

      if (!inputAudioContextRef.current || !outputAudioContextRef.current) {
        throw new Error('Failed to create audio context. Please try a different browser.');
      }

      // Resume audio contexts (required for iOS Safari and some mobile browsers)
      await resumeAudioContext(inputAudioContextRef.current);
      await resumeAudioContext(outputAudioContextRef.current);

      // 2. Get Mic Stream (with browser compatibility)
      const stream = await getMediaStream();
      mediaStreamRef.current = stream;

      // 3. Connect to our secure backend proxy
      const wsUrl = getWebSocketUrl();
      console.log('Connecting to backend proxy:', wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('Connected to backend proxy');

        // Send session setup with config (API key is on server, not here!)
        ws.send(JSON.stringify({
          type: 'setup',
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: SYSTEM_INSTRUCTION,
            tools: [{ functionDeclarations: [RoutingToolDeclaration] }],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } }
            },
            // VAD tuning: HIGH sensitivity to detect speech start, LOW to avoid cutting off
            realtimeInputConfig: {
              automaticActivityDetection: {
                startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
                endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
                prefixPaddingMs: 300,
                silenceDurationMs: 1500  // Wait 1.5 seconds of silence before ending turn
              }
            }
          }
        }));
      };

      ws.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);

          // Handle connection confirmation
          if (message.type === 'connected') {
            console.log('Gemini session ready');
            setState(AgentState.LISTENING);

            // Start audio streaming
            if (!inputAudioContextRef.current || !mediaStreamRef.current) return;

            const source = inputAudioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
            sourceNodeRef.current = source;

            const processor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);

              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                  type: 'audio',
                  media: pcmBlob
                }));
              }

              // Ensure audio contexts stay active
              if (inputAudioContextRef.current?.state === 'suspended') {
                inputAudioContextRef.current.resume();
              }
              if (outputAudioContextRef.current?.state === 'suspended') {
                outputAudioContextRef.current.resume();
              }
            };

            source.connect(processor);
            processor.connect(inputAudioContextRef.current.destination);
          }

          // Handle Gemini messages forwarded from server
          if (message.type === 'gemini' && message.data) {
            const geminiMessage = message.data;

            // Debug logging - identify message content
            const hasAudio = geminiMessage.serverContent?.modelTurn?.parts?.some((p: any) => p.inlineData?.data);
            const hasText = geminiMessage.serverContent?.modelTurn?.parts?.some((p: any) => p.text);
            const hasTurnComplete = geminiMessage.serverContent?.turnComplete;
            if (hasAudio || hasText || hasTurnComplete) {
              console.log(`Gemini msg: audio=${hasAudio} text=${hasText} turnComplete=${hasTurnComplete}`);
            }

            // Handle Tool Calling (Routing Result)
            if (geminiMessage.toolCall?.functionCalls) {
              console.log('Tool call received', geminiMessage.toolCall);
              for (const fc of geminiMessage.toolCall.functionCalls) {
                if (fc.name === RoutingToolDeclaration.name) {
                  const args = fc.args as unknown as RoutingResultArgs;
                  setRoutingResult(args);

                  // Send tool response back through proxy
                  if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({
                      type: 'toolResponse',
                      response: {
                        functionResponses: {
                          id: fc.id,
                          name: fc.name,
                          response: { result: 'Routing recorded successfully.' }
                        }
                      }
                    }));
                  }
                }
              }
            }

            // Handle Text Transcription (for UI)
            if (geminiMessage.serverContent?.modelTurn?.parts) {
              const textPart = geminiMessage.serverContent.modelTurn.parts.find((p: any) => p.text && !p.thought);
              if (textPart && textPart.text) {
                setTranscript(prev => prev + textPart.text);
              }
            }

            // Handle Audio Output - find the part with inlineData (audio)
            const audioPart = geminiMessage.serverContent?.modelTurn?.parts?.find((p: any) => p.inlineData?.data);
            const base64Audio = audioPart?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);

              const audioBuffer = await decodeAudioData(base64Audio, ctx, 24000, 1);
              const audioSource = ctx.createBufferSource();
              audioSource.buffer = audioBuffer;
              audioSource.connect(ctx.destination);

              audioSource.addEventListener('ended', () => {
                sourcesRef.current.delete(audioSource);
              });

              audioSource.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(audioSource);
            }

            // Handle Interruption
            if (geminiMessage.serverContent?.interrupted) {
              console.log('Interrupted');
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          }

          // Handle errors from server
          if (message.type === 'error') {
            console.error('Server error:', message.message);
            setError(message.message || 'Server error');
            setState(AgentState.ERROR);
          }

          // Handle session close
          if (message.type === 'closed') {
            console.log('Session closed by server');
            setState(AgentState.IDLE);
          }

        } catch (err) {
          console.error('Error processing message:', err);
        }
      };

      ws.onerror = (event) => {
        console.error('WebSocket error:', event);
        setError('Connection error. Please try again.');
        setState(AgentState.ERROR);
      };

      ws.onclose = (event) => {
        console.log('WebSocket closed - code:', event.code, 'reason:', event.reason || 'none', 'wasClean:', event.wasClean);
        if (state !== AgentState.IDLE && state !== AgentState.ERROR) {
          setState(AgentState.IDLE);
        }
      };

    } catch (err) {
      console.error('Failed to start session', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to start session';

      if (errorMessage.includes('Permission denied') || errorMessage.includes('NotAllowedError')) {
        setError('Microphone access denied. Please allow microphone access and try again.');
      } else if (errorMessage.includes('NotFoundError') || errorMessage.includes('no audio input')) {
        setError('No microphone found. Please connect a microphone and try again.');
      } else if (errorMessage.includes('NotReadableError')) {
        setError('Microphone is in use by another application. Please close other apps using the microphone.');
      } else {
        setError(`${errorMessage}. ${getCompatibilityHelp()}`);
      }

      setState(AgentState.ERROR);
    }
  };

  const handleStartStop = () => {
    if (state === AgentState.IDLE || state === AgentState.ERROR) {
      startSession();
    } else {
      stopSession();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Testing Mode Banner */}
      <div className="bg-amber-500 text-amber-950 py-2 px-4">
        <div className="max-w-4xl mx-auto flex items-center justify-center gap-2 text-sm font-medium">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>TESTING MODE - Do not use real patient information</span>
        </div>
      </div>

      {/* Header */}
      <header className="bg-blue-600 text-white py-4 px-6 shadow-lg">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img
              src="/stroud-green-logo.png"
              alt="Stroud Green Medical Clinic"
              className="h-12 w-auto"
            />
            <div>
              <h1 className="text-2xl font-bold">Stroud Green Medical Clinic</h1>
              <p className="text-blue-100 text-sm">AI Voice Receptionist</p>
            </div>
          </div>
          <div className={`h-3 w-3 rounded-full ${state === AgentState.LISTENING ? 'bg-green-400 animate-pulse' : 'bg-blue-300'}`} />
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Error Banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Browser Compatibility Warning */}
        {browserInfo && !browserInfo.supported && (
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 text-orange-800">
            <strong>Browser Compatibility:</strong> {browserInfo.help}
          </div>
        )}

        {/* What to Expect - Key Information */}
        <div className="bg-white border-2 border-blue-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800 mb-3 flex items-center gap-2">
            <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            What Happens After Your Call
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-200">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-emerald-800">Standard Request</h3>
              </div>
              <p className="text-sm text-emerald-700">
                Creates an <strong>e-Consult</strong> that our admin team will respond to <strong>within 1 hour</strong> during working hours.
              </p>
            </div>
            <div className="bg-red-50 rounded-lg p-4 border border-red-200">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-red-800">Urgent Symptoms</h3>
              </div>
              <p className="text-sm text-red-700">
                <strong>Immediate escalation</strong> to clinical staff for urgent review and callback.
              </p>
            </div>
          </div>
        </div>

        {/* Privacy Notice - Collapsed */}
        <details className="bg-slate-50 border border-slate-200 rounded-lg">
          <summary className="p-4 cursor-pointer flex items-center gap-2 text-slate-700 font-medium hover:bg-slate-100 rounded-lg">
            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Privacy &amp; Data Protection (Zero Retention)
          </summary>
          <div className="px-4 pb-4 text-sm text-slate-600 space-y-2">
            <p>This pilot uses Google Vertex AI with enterprise privacy controls:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Zero data retention - no conversation data stored by Google</li>
              <li>Audio processed in real-time and immediately discarded</li>
              <li>NHS-compliant data handling via Vertex AI</li>
            </ul>
          </div>
        </details>

        {/* Call Control */}
        <div className="bg-white rounded-xl shadow-lg p-8">
          <div className="flex flex-col items-center">
            {/* Call Button */}
            <button
              onClick={handleStartStop}
              className={`w-24 h-24 rounded-full flex items-center justify-center transition-all transform hover:scale-105 ${
                state === AgentState.IDLE || state === AgentState.ERROR
                  ? 'bg-green-500 hover:bg-green-600 text-white'
                  : 'bg-red-500 hover:bg-red-600 text-white'
              }`}
            >
              {state === AgentState.IDLE || state === AgentState.ERROR ? (
                <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
                </svg>
              ) : (
                <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
                </svg>
              )}
            </button>

            {/* Status Text */}
            <p className="mt-4 text-lg font-medium text-slate-700">
              {state === AgentState.IDLE && 'Click to start call'}
              {state === AgentState.LISTENING && 'Listening...'}
              {state === AgentState.SPEAKING && 'Tony is speaking...'}
              {state === AgentState.PROCESSING && 'Please hold, connecting...'}
              {state === AgentState.ERROR && 'Error - Click to retry'}
            </p>

            {/* Audio Visualizer */}
            <div className="mt-6 w-full max-w-md">
              <AudioVisualizer
                isActive={state === AgentState.LISTENING}
                isSpeaking={state === AgentState.SPEAKING}
                isConnecting={state === AgentState.PROCESSING}
              />
            </div>
          </div>
        </div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Transcript */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">
              Conversation Transcript
            </h2>
            <div className="h-64 overflow-y-auto bg-slate-50 rounded-lg p-4">
              {transcript ? (
                <p className="text-slate-700 whitespace-pre-wrap">{transcript}</p>
              ) : (
                <p className="text-slate-400 italic">
                  Transcript will appear here during the call...
                </p>
              )}
            </div>
          </div>

          {/* Routing Result */}
          <div>
            <h2 className="text-lg font-semibold text-slate-800 mb-4">
              Your e-Consult
            </h2>
            <RoutingCard result={routingResult} />
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
          <h3 className="font-semibold mb-2">How it works:</h3>
          <ol className="list-decimal list-inside space-y-1">
            <li>Click the green phone button to start</li>
            <li>Allow microphone access when prompted</li>
            <li>Speak naturally - Tony will ask about your needs</li>
            <li>Answer Tony's questions about your symptoms</li>
            <li>An <strong>e-Consult</strong> is created automatically</li>
            <li>Admin responds <strong>within 1 hour</strong> (or urgent escalation)</li>
          </ol>
          <p className="mt-3 text-xs text-blue-600">
            Works on Chrome, Firefox, Safari, Edge. Requires microphone access.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-8 py-4 border-t border-slate-200">
        <div className="max-w-4xl mx-auto text-center text-sm text-slate-500">
          &copy; 2026 Buddico. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
