/**
 * Secure Backend Proxy for AI Voice Services
 *
 * Supports three modes:
 * 1. Vertex AI (cloud) - Uses Google's Vertex AI with zero data retention
 * 2. Gemini (cloud) - Uses Google's Gemini Live API (55-day retention)
 * 3. Local AI - Uses self-hosted Whisper + Qwen + TTS on Mac Studio
 *
 * Credentials never reach the browser in any mode.
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Modality } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/api/live' });

// Configuration from environment
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const LOCAL_AI_URL = process.env.LOCAL_AI_URL; // e.g., ws://192.168.0.55:3001/api/live
const USE_VERTEX_AI = process.env.USE_VERTEX_AI === 'true';
const VERTEX_PROJECT = process.env.VERTEX_PROJECT || 'big-depth-420810';
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'europe-west1';
const GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS;

// Determine which mode to use
const USE_LOCAL_AI = !!LOCAL_AI_URL;

if (!USE_LOCAL_AI && !USE_VERTEX_AI && !GEMINI_API_KEY) {
  console.error('ERROR: Either GEMINI_API_KEY, USE_VERTEX_AI=true, or LOCAL_AI_URL must be set');
  process.exit(1);
}

if (USE_VERTEX_AI && !GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('ERROR: GOOGLE_APPLICATION_CREDENTIALS must be set when using Vertex AI');
  process.exit(1);
}

const getAIMode = () => {
  if (USE_LOCAL_AI) return 'LOCAL (Mac Studio)';
  if (USE_VERTEX_AI) return 'VERTEX AI (Zero Retention)';
  return 'GEMINI (Cloud)';
};

console.log(`AI Mode: ${getAIMode()}`);
if (USE_LOCAL_AI) {
  console.log(`Local AI URL: ${LOCAL_AI_URL}`);
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: USE_LOCAL_AI ? 'local' : (USE_VERTEX_AI ? 'vertex_ai' : 'gemini'),
    dataRetention: USE_LOCAL_AI ? 'none' : (USE_VERTEX_AI ? 'none' : '55_days'),
    timestamp: new Date().toISOString()
  });
});

// Store active sessions
const sessions = new Map<WebSocket, any>();

// Handler for Local AI mode
async function handleLocalAI(clientWs: WebSocket) {
  console.log('Client connected (Local AI mode)');

  let localWs: WebSocket | null = null;
  let audioBuffer: Buffer[] = [];
  let isConnected = false;

  clientWs.on('message', async (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());

      // Handle session setup - connect to local AI server
      if (message.type === 'setup' && !localWs) {
        console.log('Connecting to local AI server...');

        localWs = new WebSocket(LOCAL_AI_URL!);

        localWs.on('open', () => {
          console.log('Connected to local AI server');
          isConnected = true;

          // Send setup to local AI
          localWs!.send(JSON.stringify({ type: 'setup' }));
        });

        localWs.on('message', (localData: Buffer) => {
          try {
            const localMsg = JSON.parse(localData.toString());

            // Translate local AI messages to Gemini format for frontend
            if (localMsg.type === 'setup_complete') {
              clientWs.send(JSON.stringify({ type: 'connected' }));
            }

            if (localMsg.type === 'transcription') {
              // Send as text part in Gemini format
              clientWs.send(JSON.stringify({
                type: 'gemini',
                data: {
                  serverContent: {
                    modelTurn: {
                      parts: [{ text: `You: ${localMsg.text}\n` }]
                    }
                  }
                }
              }));
            }

            if (localMsg.type === 'text' || localMsg.type === 'audio') {
              // Convert to Gemini-like format
              const parts: any[] = [];

              if (localMsg.text) {
                parts.push({ text: `Tony: ${localMsg.text}\n` });
              }

              if (localMsg.audio) {
                parts.push({
                  inlineData: {
                    mimeType: 'audio/wav',
                    data: localMsg.audio
                  }
                });
              }

              clientWs.send(JSON.stringify({
                type: 'gemini',
                data: {
                  serverContent: {
                    modelTurn: { parts }
                  }
                }
              }));
            }

          } catch (err) {
            console.error('Error parsing local AI message:', err);
          }
        });

        localWs.on('close', () => {
          console.log('Local AI connection closed');
          isConnected = false;
          clientWs.send(JSON.stringify({ type: 'closed' }));
        });

        localWs.on('error', (err) => {
          console.error('Local AI error:', err);
          clientWs.send(JSON.stringify({
            type: 'error',
            message: 'Local AI connection error'
          }));
        });
      }

      // Accumulate audio chunks
      // Frontend sends: { type: 'audio', media: { data: 'base64...', mimeType: 'audio/pcm' } }
      if (message.type === 'audio' && localWs && isConnected) {
        const audioData = message.media?.data;
        if (audioData && typeof audioData === 'string') {
          audioBuffer.push(Buffer.from(audioData, 'base64'));
        }
      }

      // When we detect silence or enough audio, send to local AI
      // For now, send audio in batches (frontend sends continuously)
      if (message.type === 'audio' && audioBuffer.length >= 10 && localWs && isConnected) {
        const combinedAudio = Buffer.concat(audioBuffer);
        audioBuffer = [];

        localWs.send(JSON.stringify({
          type: 'audio',
          data: combinedAudio.toString('base64')
        }));
      }

    } catch (err) {
      console.error('Error processing message:', err);
    }
  });

  clientWs.on('close', () => {
    console.log('Client disconnected');
    if (localWs) {
      localWs.close();
    }
    // Send any remaining audio
    if (audioBuffer.length > 0 && localWs && isConnected) {
      const combinedAudio = Buffer.concat(audioBuffer);
      localWs.send(JSON.stringify({
        type: 'audio',
        data: combinedAudio.toString('base64')
      }));
      localWs.send(JSON.stringify({ type: 'end_audio' }));
    }
  });

  clientWs.on('error', (err) => {
    console.error('Client WebSocket error:', err);
  });
}

// Create GoogleGenAI instance based on mode
function createGoogleAI(): GoogleGenAI {
  if (USE_VERTEX_AI) {
    console.log(`Using Vertex AI - Project: ${VERTEX_PROJECT}, Location: ${VERTEX_LOCATION}`);
    return new GoogleGenAI({
      vertexai: true,
      project: VERTEX_PROJECT,
      location: VERTEX_LOCATION,
    });
  } else {
    console.log('Using Gemini API with API key');
    return new GoogleGenAI({ apiKey: GEMINI_API_KEY! });
  }
}

// Handler for Gemini/Vertex AI mode
async function handleGemini(clientWs: WebSocket) {
  console.log(`Client connected (${USE_VERTEX_AI ? 'Vertex AI' : 'Gemini'} mode)`);

  try {
    const ai = createGoogleAI();

    let geminiSession: any = null;
    let isConnecting = false;
    let audioChunkCount = 0;

    clientWs.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        // Handle session setup message
        if (message.type === 'setup' && !geminiSession && !isConnecting) {
          isConnecting = true;
          console.log('Setting up Gemini session...');
          console.log('Received config from client:', JSON.stringify(message.config, null, 2));

          try {
          // Different model names for Vertex AI vs Gemini API
          const modelName = USE_VERTEX_AI
            ? 'gemini-live-2.5-flash-native-audio'           // Vertex AI GA model
            : 'gemini-2.5-flash-native-audio-preview-12-2025'; // Gemini API 2.5 preview

          console.log(`Using model: ${modelName}`);

          geminiSession = await ai.live.connect({
            model: modelName,
            callbacks: {
              onopen: function() {
                console.log('Gemini session opened successfully');
                clientWs.send(JSON.stringify({ type: 'connected' }));

                // Send initial prompt to trigger Tony to greet
                // Use setTimeout to ensure session is fully ready
                setTimeout(() => {
                  if (geminiSession) {
                    console.log('Sending initial greeting prompt...');
                    geminiSession.sendClientContent({
                      turns: 'A caller has just connected. Please greet them.',
                      turnComplete: true
                    });
                  }
                }, 100);
              },
              onmessage: (geminiMessage: any) => {
                // Log significant messages
                const msgStr = JSON.stringify(geminiMessage);
                if (msgStr.includes('turnComplete') || msgStr.includes('interrupted') ||
                    msgStr.includes('text') || msgStr.includes('toolCall')) {
                  console.log('Gemini event:', msgStr.substring(0, 200));
                }
                // Log when audio data is received (but not the full data)
                if (msgStr.includes('inlineData')) {
                  console.log('Gemini audio received - parts count:',
                    geminiMessage.serverContent?.modelTurn?.parts?.length || 0);
                }
                if (clientWs.readyState === WebSocket.OPEN) {
                  clientWs.send(JSON.stringify({
                    type: 'gemini',
                    data: geminiMessage
                  }));
                }
              },
              onclose: (event: any) => {
                console.log('Gemini session closed');
                console.log('Close event type:', typeof event);
                console.log('Close event:', JSON.stringify(event, null, 2));
                if (event?.code) console.log('Close code:', event.code);
                if (event?.reason) console.log('Close reason:', event.reason);
                if (clientWs.readyState === WebSocket.OPEN) {
                  clientWs.send(JSON.stringify({ type: 'closed' }));
                }
              },
              onerror: (err: any) => {
                console.error('Gemini error:', err);
                console.error('Error details:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
                if (clientWs.readyState === WebSocket.OPEN) {
                  clientWs.send(JSON.stringify({
                    type: 'error',
                    message: err?.message || 'Gemini error'
                  }));
                }
              }
            },
            config: message.config
          });

          sessions.set(clientWs, geminiSession);
          isConnecting = false;
          } catch (connectErr: any) {
            console.error('Failed to connect to Gemini:', connectErr);
            console.error('Connect error details:', JSON.stringify(connectErr, Object.getOwnPropertyNames(connectErr)));
            isConnecting = false;
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({
                type: 'error',
                message: connectErr?.message || 'Failed to connect to AI'
              }));
            }
          }
        }

        // Handle audio input from client
        if (message.type === 'audio' && geminiSession) {
          audioChunkCount++;
          // Log periodically to avoid spam (every ~5 seconds worth of audio)
          if (audioChunkCount % 50 === 0) {
            console.log('Audio streaming active, chunks sent:', audioChunkCount);
          }
          geminiSession.sendRealtimeInput({ media: message.media });
        }

        // Handle tool response from client
        if (message.type === 'toolResponse' && geminiSession) {
          geminiSession.sendToolResponse(message.response);
        }

      } catch (err) {
        console.error('Error processing message:', err);
      }
    });

    clientWs.on('close', () => {
      console.log('Client disconnected');
      const session = sessions.get(clientWs);
      if (session) {
        session.close?.();
        sessions.delete(clientWs);
      }
    });

    clientWs.on('error', (err) => {
      console.error('Client WebSocket error:', err);
    });

  } catch (err) {
    console.error('Error setting up connection:', err);
    clientWs.close();
  }
}

// Route connections to appropriate handler
wss.on('connection', (clientWs: WebSocket) => {
  if (USE_LOCAL_AI) {
    handleLocalAI(clientWs);
  } else {
    handleGemini(clientWs);
  }
});

// Serve static frontend files in production
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, '../../dist');
if (fs.existsSync(STATIC_DIR)) {
  console.log(`Serving static files from: ${STATIC_DIR}`);
  app.use(express.static(STATIC_DIR));
  // SPA fallback - serve index.html for all non-API routes
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(STATIC_DIR, 'index.html'));
    }
  });
}

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`AI Voice proxy server running on port ${PORT}`);
  console.log(`Mode: ${getAIMode()}`);
  console.log('Credentials are secure - never sent to browser');
  if (USE_VERTEX_AI) {
    console.log('Data retention: NONE (Vertex AI)');
  }
});
