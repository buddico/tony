/**
 * Secure Backend Proxy for Gemini Live API
 *
 * This server holds the API key securely and proxies WebSocket connections
 * between the frontend and Gemini. The API key never reaches the browser.
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Modality } from '@google/genai';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/api/live' });

// API key from environment - NEVER expose to frontend
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY environment variable not set');
  process.exit(1);
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Store active sessions
const sessions = new Map<WebSocket, any>();

wss.on('connection', async (clientWs: WebSocket) => {
  console.log('Client connected');

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    // We'll store the session config when client sends it
    let geminiSession: any = null;
    let isConnecting = false;

    clientWs.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        // Handle session setup message
        if (message.type === 'setup' && !geminiSession && !isConnecting) {
          isConnecting = true;
          console.log('Setting up Gemini session...');

          geminiSession = await ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            callbacks: {
              onopen: () => {
                console.log('Gemini session opened');
                clientWs.send(JSON.stringify({ type: 'connected' }));
              },
              onmessage: (geminiMessage: any) => {
                // Forward Gemini messages to client
                if (clientWs.readyState === WebSocket.OPEN) {
                  clientWs.send(JSON.stringify({
                    type: 'gemini',
                    data: geminiMessage
                  }));
                }
              },
              onclose: () => {
                console.log('Gemini session closed');
                if (clientWs.readyState === WebSocket.OPEN) {
                  clientWs.send(JSON.stringify({ type: 'closed' }));
                }
              },
              onerror: (err: any) => {
                console.error('Gemini error:', err);
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
        }

        // Handle audio input from client
        if (message.type === 'audio' && geminiSession) {
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
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Gemini proxy server running on port ${PORT}`);
  console.log('API key is secure - never sent to browser');
});
