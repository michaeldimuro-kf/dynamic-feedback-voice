import { useCallback, useEffect, useRef, useState } from 'react';
import useStore from '../store/useStore';
import useSocket from './useSocket';

interface VoiceChatOptions {
  initialPrompt?: string;
  voice?: string;
  debugMode?: boolean;
}

/**
 * Custom hook for real-time voice chat using OpenAI's real-time API
 */
const useRealtimeVoiceChat = (options: VoiceChatOptions | string = {}) => {
  // Handle both string and object parameters for backward compatibility
  const config: VoiceChatOptions = typeof options === 'string' 
    ? { initialPrompt: options } 
    : options;
  
  const initialPrompt = config.initialPrompt || '';
  
  const { addMessage, setIsProcessing, setIsRecording } = useStore();
  const { socket, socketReady } = useSocket();
  
  // State variables
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<string>('disconnected');
  const [isStreaming, setIsStreaming] = useState(false);
  
  // Audio processing refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  
  // Debug mode
  const debugMode = config.debugMode ?? (import.meta.env.VITE_DEBUG_WEBRTC === 'true') ?? true;
  
  // Debug logger
  const debugLog = useCallback((message: string, ...args: any[]) => {
    if (debugMode) {
      console.log(`[RealtimeVoiceChat] ${message}`, ...args);
    }
  }, [debugMode]);
  
  // Utility function to convert Float32Array to Int16Array (16-bit PCM)
  const convertToInt16 = (float32Array: Float32Array): Int16Array => {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      // Convert from [-1.0, 1.0] to [-32768, 32767]
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
  };
  
  // Convert ArrayBuffer to Base64
  const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  };
  
  // Create a session with the server
  const createSession = useCallback(async () => {
    try {
      debugLog('Creating Realtime session');
      setError(null);
      
      if (!socket) {
        const error = 'Socket not connected';
        debugLog(`Error: ${error}`);
        throw new Error(error);
      }
      
      if (!socketReady) {
        const error = 'Socket not ready';
        debugLog(`Error: ${error}`);
        throw new Error(error);
      }
      
      debugLog(`Socket is ready. ID: ${socket.id}, Connected: ${socket.connected}`);
      
      return new Promise<string>((resolve, reject) => {
        // Set timeout for session creation
        const timeoutId = setTimeout(() => {
          debugLog('Session creation timed out after 10 seconds');
          reject(new Error('Session creation timeout'));
        }, 10000);
        
        // Listen for session creation response
        const handleSessionCreated = (response: any) => {
          debugLog(`Received realtime-session-created response:`, response);
          clearTimeout(timeoutId);
          socket.off('realtime-session-created', handleSessionCreated);
          
          if (response.success) {
            debugLog('Session created successfully:', response.sessionId);
            setSessionId(response.sessionId);
            resolve(response.sessionId);
          } else {
            debugLog('Failed to create session:', response.error);
            setError(response.error || 'Failed to create session');
            reject(new Error(response.error || 'Failed to create session'));
          }
        };
        
        // Set up listener
        socket.on('realtime-session-created', handleSessionCreated);
        
        // Send session creation request
        debugLog('Emitting start-realtime-session event...');
        socket.emit('start-realtime-session', { initialPrompt });
        debugLog('Sent session creation request');
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      debugLog('Error creating session:', errorMessage);
      setError(`Failed to create session: ${errorMessage}`);
      throw error;
    }
  }, [socket, socketReady, initialPrompt, debugLog]);
  
  // Connect to an existing session
  const connectSession = useCallback(async (sid: string | null = null) => {
    try {
      debugLog('Connecting to Realtime session');
      setError(null);
      
      if (!socket) {
        const error = 'Socket not connected';
        debugLog(`Error: ${error}`);
        throw new Error(error);
      }
      
      if (!socketReady) {
        const error = 'Socket not ready';
        debugLog(`Error: ${error}`);
        throw new Error(error);
      }
      
      debugLog(`Socket is ready for connection. ID: ${socket.id}, Connected: ${socket.connected}`);

      // Use provided session ID or current session ID or create new one
      let targetSessionId: string;
      if (sid) {
        debugLog(`Using provided session ID: ${sid}`);
        targetSessionId = sid;
      } else if (sessionId) {
        debugLog(`Using existing session ID: ${sessionId}`);
        targetSessionId = sessionId;
      } else {
        debugLog('No session ID available, creating new session');
        targetSessionId = await createSession();
        debugLog(`Created new session with ID: ${targetSessionId}`);
      }
      
      return new Promise<boolean>((resolve, reject) => {
        // Set timeout for connection
        const timeoutId = setTimeout(() => {
          debugLog('Session connection timed out after 10 seconds');
          reject(new Error('Session connection timeout'));
        }, 10000);
        
        // Listen for connection response
        const handleSessionConnected = (response: any) => {
          debugLog(`Received realtime-session-connected response:`, response);
          clearTimeout(timeoutId);
          socket.off('realtime-session-connected', handleSessionConnected);
          
          if (response.success) {
            debugLog('Session connected successfully');
            setConnectionState('connected');
            resolve(true);
          } else {
            debugLog('Failed to connect session:', response.error);
            setError(response.error || 'Failed to connect session');
            setConnectionState('error');
            reject(new Error(response.error || 'Failed to connect session'));
          }
        };
        
        // Set up listener
        socket.on('realtime-session-connected', handleSessionConnected);
        
        // Send connection request
        debugLog(`Emitting connect-realtime-session event for session ${targetSessionId}...`);
        socket.emit('connect-realtime-session', {
          sessionId: targetSessionId,
          initialPrompt
        });
        debugLog(`Sent connection request for session ${targetSessionId}`);
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      debugLog('Error connecting session:', errorMessage);
      setError(`Failed to connect session: ${errorMessage}`);
      throw error;
    }
  }, [socket, socketReady, sessionId, createSession, initialPrompt, debugLog]);
  
  // Start a session (create and connect)
  const startSession = useCallback(async () => {
    try {
      debugLog('Starting Realtime session');
      setError(null);
      
      // Create session if it doesn't exist
      if (!sessionId) {
        await createSession();
      }
      
      // Connect to the session
      await connectSession();
      
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      debugLog('Error starting session:', errorMessage);
      setError(`Failed to start session: ${errorMessage}`);
      return false;
    }
  }, [sessionId, createSession, connectSession, debugLog]);
  
  // Start recording audio
  const startRecording = useCallback(async () => {
    try {
      debugLog('Starting audio recording');
      setError(null);
      
      // Ensure we have a session
      if (!sessionId) {
        debugLog('No session ID found, starting a new session');
        await startSession();
      }
      
      if (!socket || !socketReady) {
        throw new Error('Socket not connected or not ready');
      }
      
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      // Create AudioContext
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000 // Using 16kHz as recommended by OpenAI
      });
      
      // Create source node from microphone stream
      const source = audioContext.createMediaStreamSource(stream);
      
      // Create processor node for raw PCM data
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      
      // Connect nodes: source -> processor -> destination
      source.connect(processor);
      processor.connect(audioContext.destination);
      
      // Handle audio processing
      processor.onaudioprocess = (e) => {
        if (!socket || !socketReady || !sessionId) return;
        
        // Get PCM data from the buffer
        const inputBuffer = e.inputBuffer;
        const inputData = inputBuffer.getChannelData(0);
        
        // Convert to Int16Array (16-bit PCM)
        const pcmBuffer = convertToInt16(inputData);
        
        // Convert to base64 for transmission
        const base64Audio = arrayBufferToBase64(pcmBuffer.buffer);
        
        // Send to server
        socket.emit('audio-data', {
          sessionId,
          audioData: base64Audio
        });
      };
      
      // Store references
      audioContextRef.current = audioContext;
      audioSourceRef.current = source;
      audioProcessorRef.current = processor;
      audioStreamRef.current = stream;
      
      // Update state
      setIsRecording(true);
      debugLog('Recording started successfully');
      
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      debugLog('Error starting recording:', errorMessage);
      setError(`Failed to start recording: ${errorMessage}`);
      
      // Cleanup partial setup
      stopRecording();
      return false;
    }
  }, [socket, socketReady, sessionId, startSession, debugLog, setIsRecording]);
  
  // Stop recording audio
  const stopRecording = useCallback(() => {
    debugLog('Stopping recording');
    
    // Disconnect and cleanup audio processing nodes
    if (audioProcessorRef.current) {
      try {
        audioProcessorRef.current.disconnect();
      } catch (err) {
        debugLog('Error disconnecting processor:', err);
      }
      audioProcessorRef.current = null;
    }
    
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.disconnect();
      } catch (err) {
        debugLog('Error disconnecting source:', err);
      }
      audioSourceRef.current = null;
    }
    
    // Stop all media stream tracks
    if (audioStreamRef.current) {
      try {
        audioStreamRef.current.getTracks().forEach(track => track.stop());
      } catch (err) {
        debugLog('Error stopping media tracks:', err);
      }
      audioStreamRef.current = null;
    }
    
    // Close audio context
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close().catch(err => debugLog('Error closing audio context:', err));
      } catch (err) {
        debugLog('Error closing audio context:', err);
      }
      audioContextRef.current = null;
    }
    
    // Update state
    setIsRecording(false);
    debugLog('Recording stopped');
  }, [debugLog, setIsRecording]);
  
  // End the session
  const endSession = useCallback(async () => {
    try {
      debugLog('Ending session');
      
      // Stop recording if active
      if (useStore.getState().audioState.isRecording) {
        stopRecording();
      }
      
      // Tell the server to end the session
      if (socket && socketReady && sessionId) {
        socket.emit('end-realtime-session', { sessionId });
        debugLog('Sent request to end session');
      }
      
      // Clear state
      setSessionId(null);
      setConnectionState('disconnected');
      
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      debugLog('Error ending session:', errorMessage);
      setError(`Failed to end session: ${errorMessage}`);
      return false;
    }
  }, [socket, socketReady, sessionId, stopRecording, debugLog]);
  
  // Handle realtime events from the server
  useEffect(() => {
    if (!socket) return;
    
    debugLog('Setting up event listeners');
    
    // Handle realtime events
    const handleRealtimeEvent = (event: any) => {
      if (event.type) {
        debugLog(`Received event: ${event.type}`);
      }
      
      // Handle different event types
      switch (event.type) {
        case 'session.created':
        case 'session.updated':
          debugLog(`Session ${event.type}:`, event.session);
          break;
          
        case 'input_audio_buffer.speech_started':
          debugLog('Speech started');
          break;
          
        case 'input_audio_buffer.speech_stopped':
          debugLog('Speech stopped');
          break;
          
        case 'input_audio_buffer.committed':
          debugLog('Audio buffer committed');
          break;
          
        case 'response.created':
          debugLog('Response created:', event.response?.id);
          setIsProcessing(true);
          break;
          
        case 'response.text.delta':
          if (event.delta && event.delta.text) {
            debugLog('Text delta:', event.delta.text);
            addMessage(event.delta.text, 'bot', true);
          }
          break;
          
        case 'response.audio.delta':
          if (event.delta && event.delta.audio) {
            const audioBase64 = event.delta.audio;
            debugLog(`Audio delta: ${audioBase64.substring(0, 20)}... (${audioBase64.length} chars)`);
            
            // Play the audio
            try {
              const audio = new Audio(`data:audio/mp3;base64,${audioBase64}`);
              audio.play().catch(err => {
                debugLog('Error playing audio:', err);
              });
            } catch (err) {
              debugLog('Error creating audio element:', err);
            }
          }
          break;
          
        case 'response.completed':
          debugLog('Response completed');
          setIsProcessing(false);
          break;
          
        case 'error':
          const errorMessage = event.error?.message || 'Unknown error from API';
          debugLog('Error from API:', errorMessage);
          setError(errorMessage);
          break;
      }
    };
    
    // Handle audio stream (for backward compatibility)
    const handleAudioStream = (data: { audio: string, sessionId: string }) => {
      if (data.sessionId !== sessionId) return;
      
      debugLog(`Received audio stream: ${data.audio ? data.audio.substring(0, 20) + '...' : 'empty'}`);
      
      if (data.audio && data.audio.length > 0) {
        try {
          const audio = new Audio(`data:audio/mp3;base64,${data.audio}`);
          audio.play().catch(err => {
            debugLog('Error playing audio stream:', err);
          });
        } catch (err) {
          debugLog('Error creating audio element for stream:', err);
        }
      }
    };
    
    // Handle errors
    const handleError = (error: any) => {
      const errorMessage = typeof error === 'string' ? error : 
        (error?.message || 'Unknown server error');
      debugLog('Error from server:', errorMessage);
      setError(errorMessage);
    };
    
    // Add event listeners
    socket.on('realtime-event', handleRealtimeEvent);
    socket.on('audio-stream', handleAudioStream);
    socket.on('error', handleError);
    
    // Cleanup function
    return () => {
      socket.off('realtime-event', handleRealtimeEvent);
      socket.off('audio-stream', handleAudioStream);
      socket.off('error', handleError);
    };
  }, [socket, sessionId, addMessage, setIsProcessing, debugLog]);
  
  // Print socket state when it changes
  useEffect(() => {
    debugLog(`Socket state updated - connected: ${!!socket}, ready: ${socketReady}`);
    
    if (socket) {
      // Log socket ID when available
      debugLog(`Socket ID: ${socket.id}`);
      
      // Add one-time connection event handler
      socket.once('connect', () => {
        debugLog(`Socket connected with ID: ${socket.id}`);
      });
      
      // Add disconnect handler
      socket.on('disconnect', (reason) => {
        debugLog(`Socket disconnected. Reason: ${reason}`);
      });
      
      // Add reconnect handler
      socket.on('reconnect', (attemptNumber) => {
        debugLog(`Socket reconnected after ${attemptNumber} attempts`);
      });
      
      // Add error handler
      socket.on('connect_error', (error) => {
        debugLog(`Socket connection error: ${error.message}`);
      });
      
      return () => {
        socket.off('disconnect');
        socket.off('reconnect');
        socket.off('connect_error');
      };
    }
  }, [socket, socketReady, debugLog]);
  
  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (useStore.getState().audioState.isRecording) {
        stopRecording();
      }
      
      endSession().catch(err => {
        debugLog('Error during cleanup:', err);
      });
    };
  }, [endSession, stopRecording, debugLog]);
  
  // Return functions and state
  return {
    // Session state
    sessionId,
    connectionState,
    error,
    
    // Actions
    createSession,
    startSession,
    connectSession,
    startRecording,
    stopRecording,
    endSession,
    
    // Audio state
    isRecording: useStore.getState().audioState.isRecording,
    isProcessing: useStore.getState().audioState.isProcessing,
    isStreaming,
    
    // Diagnostic helper
    runConnectionDiagnostics: async () => {
      const diagnostics = {
        timestamp: new Date().toISOString(),
        browser: navigator.userAgent,
        socketState: {
          exists: !!socket,
          connected: socket?.connected || false,
          id: socket?.id || 'no-id'
        },
        sessionState: {
          sessionId: sessionId,
          connectionState: connectionState,
          hasError: !!error,
          errorMessage: error
        },
        audioState: {
          isRecording: useStore.getState().audioState.isRecording,
          isProcessing: useStore.getState().audioState.isProcessing,
          hasAudioContext: !!audioContextRef.current,
          hasAudioProcessor: !!audioProcessorRef.current,
          hasAudioStream: !!audioStreamRef.current
        }
      };
      
      debugLog('Connection diagnostics:', diagnostics);
      
      // Try to ping the server if socket exists
      if (socket?.connected) {
        try {
          debugLog('Testing server connection with ping...');
          const pingStart = Date.now();
          
          // Create a promise that resolves when pong is received or rejects on timeout
          const pingResult = await new Promise<{success: boolean, latency: number}>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              socket.off('pong');
              resolve({success: false, latency: -1});
            }, 3000);
            
            socket.once('pong', () => {
              clearTimeout(timeoutId);
              const latency = Date.now() - pingStart;
              resolve({success: true, latency});
            });
            
            socket.emit('ping');
          });
          
          diagnostics['pingTest'] = pingResult;
          debugLog(`Ping test result: ${pingResult.success ? 'Success' : 'Failed'}, Latency: ${pingResult.latency}ms`);
        } catch (err) {
          debugLog('Error during ping test:', err);
          diagnostics['pingTest'] = {success: false, error: String(err)};
        }
      }
      
      return diagnostics;
    }
  };
};

export default useRealtimeVoiceChat; 