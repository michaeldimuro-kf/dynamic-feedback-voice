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
        debugLog(`❌ Error: ${error}`);
        throw new Error(error);
      }
      
      if (!socketReady) {
        const error = 'Socket not ready';
        debugLog(`❌ Error: ${error}`);
        throw new Error(error);
      }
      
      debugLog(`🔌 Socket is ready. ID: ${socket.id}, Connected: ${socket.connected}`);
      
      return new Promise<string>((resolve, reject) => {
        // Set timeout for session creation
        const timeoutId = setTimeout(() => {
          debugLog('⏱️ Session creation timed out after 10 seconds');
          reject(new Error('Session creation timeout'));
        }, 10000);
        
        // Listen for session creation response
        const handleSessionCreated = (response: any) => {
          debugLog(`📩 Received realtime-session-started response:`, response);
          clearTimeout(timeoutId);
          socket.off('realtime-session-started', handleSessionCreated);
          
          if (response.success) {
            const newSessionId = response.sessionId;
            debugLog(`✅ Session created successfully: ${newSessionId}`);
            setSessionId(newSessionId);
            
            // Double-check session ID was set
            setTimeout(() => {
              debugLog(`🔍 Verifying session ID was set: ${sessionId || 'not set yet'} -> ${newSessionId}`);
            }, 0);
            
            resolve(newSessionId);
          } else {
            debugLog(`❌ Failed to create session: ${response.error || 'Unknown error'}`);
            setError(response.error || 'Failed to create session');
            reject(new Error(response.error || 'Failed to create session'));
          }
        };
        
        // Set up listener
        socket.on('realtime-session-started', handleSessionCreated);
        
        // Send session creation request
        debugLog('📡 Emitting start-realtime-session event...');
        socket.emit('start-realtime-session', { initialPrompt });
        debugLog('📤 Sent session creation request');
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      debugLog(`❌ Error creating session: ${errorMessage}`);
      setError(`Failed to create session: ${errorMessage}`);
      throw error;
    }
  }, [socket, socketReady, initialPrompt, debugLog, sessionId]);
  
  // Connect to an existing session
  const connectSession = useCallback(async (sid: string | null = null) => {
    try {
      debugLog('Connecting to Realtime session');
      setError(null);
      
      if (!socket) {
        const error = 'Socket not connected';
        debugLog(`❌ Error: ${error}`);
        throw new Error(error);
      }
      
      if (!socketReady) {
        const error = 'Socket not ready';
        debugLog(`❌ Error: ${error}`);
        throw new Error(error);
      }
      
      debugLog(`🔌 Socket is ready for connection. ID: ${socket.id}, Connected: ${socket.connected}`);

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
          debugLog('⏱️ Session connection timed out after 10 seconds');
          reject(new Error('Session connection timeout'));
        }, 10000);
        
        // Listen for connection response
        const handleSessionConnected = (response: any) => {
          debugLog(`📩 Received realtime-session-connected response:`, response);
          clearTimeout(timeoutId);
          socket.off('realtime-session-connected', handleSessionConnected);
          
          if (response.success) {
            debugLog('✅ Session connected successfully');
            setConnectionState('connected');
            resolve(true);
          } else {
            debugLog(`❌ Failed to connect session: ${response.error || 'Unknown error'}`);
            setError(response.error || 'Failed to connect session');
            setConnectionState('error');
            reject(new Error(response.error || 'Failed to connect session'));
          }
        };
        
        // Set up listener
        socket.on('realtime-session-connected', handleSessionConnected);
        
        // Send connection request
        debugLog(`📡 Emitting connect-realtime-session event for session ${targetSessionId}...`);
        socket.emit('connect-realtime-session', {
          sessionId: targetSessionId,
          initialPrompt
        });
        debugLog(`📤 Sent connection request for session ${targetSessionId}`);
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      debugLog(`❌ Error connecting session: ${errorMessage}`);
      setError(`Failed to connect session: ${errorMessage}`);
      throw error;
    }
  }, [socket, socketReady, sessionId, createSession, initialPrompt, debugLog]);
  
  // Start a session (create and connect)
  const startSession = useCallback(async () => {
    try {
      debugLog('Starting Realtime session');
      setError(null);
      
      // Create session if it doesn't exist and store the result directly
      let currentSessionId = sessionId;
      if (!currentSessionId) {
        debugLog('No session ID in state, creating new session');
        currentSessionId = await createSession();
        debugLog(`Created new session with ID: ${currentSessionId}`);
      }
      
      // Connect to the session
      await connectSession(currentSessionId);
      
      // Return the session ID for immediate use
      return currentSessionId;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      debugLog('Error starting session:', errorMessage);
      setError(`Failed to start session: ${errorMessage}`);
      return null;
    }
  }, [sessionId, createSession, connectSession, debugLog]);
  
  // Start recording audio
  const startRecording = useCallback(async () => {
    try {
      debugLog('Starting audio recording');
      setError(null);
      
      // Directly get a session ID that we can use immediately, don't rely on state
      let currentSessionId = sessionId;
      
      // Ensure we have a session
      if (!currentSessionId) {
        debugLog('No session ID found, starting a new session');
        currentSessionId = await startSession();
      }
      
      if (!socket || !socketReady) {
        throw new Error('Socket not connected or not ready');
      }
      
      // Now verify we have a session ID
      if (!currentSessionId) {
        debugLog('❌ Session ID still not available after starting session');
        setError('Failed to obtain a valid session ID for recording');
        return false;
      }
      
      // Log the session ID to confirm it's available
      debugLog(`🔑 Using session ID for recording: ${currentSessionId}`);
      
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
      
      // Store references
      audioContextRef.current = audioContext;
      audioSourceRef.current = source;
      audioProcessorRef.current = processor;
      audioStreamRef.current = stream;
      
      // Connect nodes: source -> processor -> destination
      source.connect(processor);
      processor.connect(audioContext.destination);
      
      debugLog(`🔌 Audio processor configured with session ID: ${currentSessionId}`);
      
      // Handle audio processing
      processor.onaudioprocess = (e) => {
        // Since we capture the sessionId at the beginning of this function,
        // we should still have it here for stability, rather than using the state variable
        if (!socket || !socket.connected || !currentSessionId) {
          const reason = !socket ? "Socket missing" : 
                        !socket.connected ? "Socket disconnected" : 
                        "Session ID missing";
          debugLog(`⚠️ Cannot send audio: ${reason}`);
          return;
        }
        
        // Get PCM data from the buffer
        const inputBuffer = e.inputBuffer;
        const inputData = inputBuffer.getChannelData(0);
        
        // Debug log to verify we're getting audio data
        if (debugMode && inputData.length > 0) {
          let sum = 0;
          for (let i = 0; i < inputData.length; i++) {
            sum += Math.abs(inputData[i]);
          }
          const average = sum / inputData.length;
          
          // Only log if there's actual audio (avoid logging silence)
          if (average > 0.005) {
            debugLog(`🎤 Audio buffer captured: ${inputData.length} samples, avg amplitude: ${average.toFixed(4)}`);
          }
        }
        
        // Convert to Int16Array (16-bit PCM)
        const pcmBuffer = convertToInt16(inputData);
        
        // Convert to base64 for transmission
        const base64Audio = arrayBufferToBase64(pcmBuffer.buffer);
        
        // Send to server using the current socket
        debugLog(`📢 Sending audio data (${base64Audio.length} bytes) to server via 'audio-data' event`);
        debugLog(`🔑 Using session ID for sending: ${currentSessionId}`);
        socket.emit('audio-data', {
          sessionId: currentSessionId,
          audioData: base64Audio
        });
      };
      
      // Update state
      setIsRecording(true);
      debugLog('✅ Recording started successfully');
      
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      debugLog(`❌ Error starting recording: ${errorMessage}`);
      setError(`Failed to start recording: ${errorMessage}`);
      
      // Cleanup partial setup
      stopRecording();
      return false;
    }
  }, [socket, socketReady, sessionId, startSession, debugLog, setIsRecording, debugMode]);
  
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
          
        case 'response.audio_transcript.delta':
          // Handle transcript deltas (new in OpenAI realtime API)
          debugLog('Audio transcript delta:', event.delta?.transcript || '(empty)');
          // No need to do anything with transcript for now, just acknowledge it
          break;
          
        case 'response.audio.delta':
          if (event.delta && event.delta.audio) {
            const audioBase64 = event.delta.audio;
            debugLog(`Audio delta received: ${audioBase64.substring(0, 20)}... (${audioBase64.length} chars)`);
            
            // Indicate that we're streaming audio
            setIsStreaming(true);
            
            // Play the audio
            try {
              debugLog('Attempting to play audio...');
              
              // For PCM16 format, we need to convert to a playable format
              // First, decode the base64 data
              debugLog('Decoding Base64 audio data...');
              const binaryString = atob(audioBase64);
              debugLog(`Decoded Base64 data successfully (length: ${binaryString.length} bytes)`);
              
              // Convert binary string to Int16Array (PCM16 format)
              debugLog('Converting binary data to PCM16 Int16Array...');
              const pcmData = new Int16Array(binaryString.length / 2);
              let byteIndex = 0;
              
              for (let i = 0; i < pcmData.length; i++) {
                // PCM16 is little-endian (least significant byte first)
                const byte1 = binaryString.charCodeAt(byteIndex++);
                const byte2 = binaryString.charCodeAt(byteIndex++);
                pcmData[i] = (byte2 << 8) | byte1;
              }
              
              debugLog(`Converted to Int16Array: ${pcmData.length} samples`);
              
              // Add stats for debugging
              if (pcmData.length > 0) {
                let min = pcmData[0];
                let max = pcmData[0];
                let sum = 0;
                
                for (let i = 0; i < pcmData.length; i++) {
                  min = Math.min(min, pcmData[i]);
                  max = Math.max(max, pcmData[i]);
                  sum += Math.abs(pcmData[i]);
                }
                
                const avg = sum / pcmData.length;
                debugLog(`PCM audio stats - Min: ${min}, Max: ${max}, Avg absolute: ${avg.toFixed(2)}`);
              }
              
              // Convert PCM data to WAV by adding a proper header
              debugLog('Creating WAV header...');
              const wavHeader = createWavHeader(pcmData.byteLength, 16000, 1, 16);
              debugLog(`Created WAV header (${wavHeader.length} bytes)`);
              
              // Combine header and PCM data
              debugLog('Combining header and audio data...');
              const wavData = new Uint8Array(wavHeader.length + pcmData.byteLength);
              wavData.set(wavHeader);
              // Convert Int16Array to Uint8Array to combine with header
              new Uint8Array(wavData.buffer, wavHeader.length).set(new Uint8Array(pcmData.buffer));
              
              debugLog(`Combined WAV data created (${wavData.length} bytes)`);
              
              // Create blob and URL
              debugLog('Creating audio blob and URL...');
              const blob = new Blob([wavData], { type: 'audio/wav' });
              const url = URL.createObjectURL(blob);
              debugLog(`Created audio blob URL: ${url}`);
              
              // Play the audio
              debugLog('Creating Audio element and attempting playback...');
              const audio = new Audio(url);
              
              audio.onloadedmetadata = () => {
                debugLog(`Audio metadata loaded - Duration: ${audio.duration}s`);
              };
              
              audio.onended = () => {
                URL.revokeObjectURL(url);
                debugLog('Audio playback ended, URL revoked');
              };
              
              audio.onerror = (err) => {
                debugLog(`Audio element error: ${audio.error?.code} - ${audio.error?.message}`);
              };
              
              audio.play().then(() => {
                debugLog('Audio playback started successfully');
              }).catch(err => {
                debugLog(`Error playing audio: ${err.name} - ${err.message}`);
              });
            } catch (err) {
              debugLog(`Error processing audio data: ${err instanceof Error ? err.message : String(err)}`);
              if (err instanceof Error && err.stack) {
                debugLog(`Error stack: ${err.stack}`);
              }
            }
          } else {
            // This is normal - OpenAI sometimes sends empty audio delta events at the start/end
            debugLog('Received response.audio.delta event without audio data');
          }
          break;
          
        case 'response.text.final':
          debugLog('Final text received');
          break;
          
        case 'response.audio.final':
          debugLog('Final audio received');
          break;
          
        // Handle "done" events for all response types
        case 'response.audio.done':
          debugLog('Audio processing complete');
          // Don't reset processing yet as there may be more events
          break;
          
        case 'response.audio_transcript.done':
          debugLog('Audio transcript complete');
          break;
          
        case 'response.content_part.done':
          debugLog('Content part complete');
          break;
          
        case 'response.output_item.done':
          debugLog('Output item complete');
          break;
        
        case 'response.done':
          debugLog('Response fully complete');
          // This is the final event, we can safely reset processing
          setIsProcessing(false);
          setIsStreaming(false);
          break;
        
        case 'error':
          const errorMessage = event.error?.message || 'Unknown error';
          const errorCode = event.error?.code || 'ERROR';
          debugLog(`Server error: [${errorCode}] ${errorMessage}`);
          
          // Set the error in our state so UI can display it
          setError(`Error: ${errorMessage}`);
          
          // Always reset processing state on error
          setIsProcessing(false);
          setIsStreaming(false);
          
          // Special handling for session not found errors - prompt to create a new session
          if (errorCode === 'SESSION_NOT_FOUND') {
            debugLog('Session not found, will reset session ID and recreate session');
            setSessionId(null); // Reset the session ID to force creation of a new one
            setConnectionState('disconnected');
            
            // Add a readable message to the chat
            addMessage(`I lost connection to your audio stream. Please try recording again.`, 'bot', false);
            
            // Attempt to automatically reconnect
            startSession().then(newSessionId => {
              if (newSessionId) {
                debugLog(`Successfully recreated session with ID: ${newSessionId}`);
                setSessionId(newSessionId);
                setConnectionState('connected');
                setError(null);
              } else {
                debugLog('Failed to automatically recreate session');
              }
            }).catch(err => {
              debugLog(`Error recreating session: ${err.message}`);
            });
          }
          
          if (errorCode === 'SEND_AUDIO_FAILED' || errorCode === 'AUDIO_PROCESSING_ERROR') {
            // For audio errors, just show a message but don't interrupt the session
            addMessage(`There was an issue processing your audio. Please try speaking again.`, 'bot', false);
          }
          
          break;
          
        default:
          debugLog(`Unhandled event type: ${event.type}`);
          break;
      }
    };
    
    // Function to create a WAV header
    const createWavHeader = (dataLength: number, sampleRate: number, numChannels: number, bitsPerSample: number) => {
      const headerLength = 44;
      const wavHeader = new Uint8Array(headerLength);
      
      // "RIFF" chunk descriptor
      wavHeader.set([0x52, 0x49, 0x46, 0x46]); // "RIFF" in ASCII
      
      // Chunk size (file size - 8)
      const fileSize = dataLength + headerLength - 8;
      wavHeader.set([
        fileSize & 0xff,
        (fileSize >> 8) & 0xff,
        (fileSize >> 16) & 0xff,
        (fileSize >> 24) & 0xff
      ], 4);
      
      // "WAVE" format
      wavHeader.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE" in ASCII
      
      // "fmt " sub-chunk
      wavHeader.set([0x66, 0x6d, 0x74, 0x20], 12); // "fmt " in ASCII
      
      // Sub-chunk size (16 for PCM)
      wavHeader.set([16, 0, 0, 0], 16);
      
      // Audio format (1 for PCM)
      wavHeader.set([1, 0], 20);
      
      // Number of channels
      wavHeader.set([numChannels, 0], 22);
      
      // Sample rate
      wavHeader.set([
        sampleRate & 0xff,
        (sampleRate >> 8) & 0xff,
        (sampleRate >> 16) & 0xff,
        (sampleRate >> 24) & 0xff
      ], 24);
      
      // Byte rate = SampleRate * NumChannels * BitsPerSample/8
      const byteRate = sampleRate * numChannels * bitsPerSample / 8;
      wavHeader.set([
        byteRate & 0xff,
        (byteRate >> 8) & 0xff,
        (byteRate >> 16) & 0xff,
        (byteRate >> 24) & 0xff
      ], 28);
      
      // Block align = NumChannels * BitsPerSample/8
      const blockAlign = numChannels * bitsPerSample / 8;
      wavHeader.set([blockAlign, 0], 32);
      
      // Bits per sample
      wavHeader.set([bitsPerSample, 0], 34);
      
      // "data" sub-chunk
      wavHeader.set([0x64, 0x61, 0x74, 0x61], 36); // "data" in ASCII
      
      // Data size
      wavHeader.set([
        dataLength & 0xff,
        (dataLength >> 8) & 0xff,
        (dataLength >> 16) & 0xff,
        (dataLength >> 24) & 0xff
      ], 40);
      
      return wavHeader;
    };
    
    // Handle audio stream events specially (compatibility with older API)
    const handleAudioStream = (data: { audio: string, sessionId: string }) => {
      debugLog(`Received audio stream, length: ${data.audio.length}`);
      
      if (data.audio && data.audio.length > 0) {
        try {
          debugLog('Playing audio from audio-stream event');
          const audio = new Audio(`data:audio/mp3;base64,${data.audio}`);
          audio.play().catch(err => {
            debugLog('Error playing audio from stream:', err);
          });
        } catch (err) {
          debugLog('Error creating audio element from stream:', err);
        }
      }
    };
    
    // Handle errors
    const handleError = (error: any) => {
      const errorMessage = typeof error === 'string' ? error : 
        (error?.message || 'Unknown server error');
      debugLog('Error from server:', errorMessage);
      setError(errorMessage);
      
      // For general errors, add a message to the chat
      addMessage(`There was a problem with the voice chat: ${errorMessage}. Please try again.`, 'bot', false);
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

      // Request echo to test socket connection
      debugLog('Sending echo test to server...');
      socket.emit('echo-test', { timestamp: Date.now(), message: 'Testing socket communication' });
      
      // Set up echo response handler
      socket.on('echo-response', (data) => {
        debugLog('Received echo response from server:', data);
      });
      
      // Monitor realtime-event specifically for debugging
      if (debugMode) {
        const realtimeEventListener = (event: any) => {
          debugLog(`⬇️ RECEIVED REALTIME EVENT: ${event.type || 'unknown'}`, event);
        };
        
        socket.on('realtime-event', realtimeEventListener);
        
        // Clean up this listener too
        return () => {
          socket.off('disconnect');
          socket.off('reconnect');
          socket.off('connect_error');
          socket.off('echo-response');
          socket.off('realtime-event', realtimeEventListener);
        };
      }
      
      return () => {
        socket.off('disconnect');
        socket.off('reconnect');
        socket.off('connect_error');
        socket.off('echo-response');
      };
    }
  }, [socket, socketReady, debugLog, debugMode]);
  
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
  
  // Run the function when socket is ready and we have a session ID
  useEffect(() => {
    if (socketReady && !sessionId && connectionState === 'disconnected') {
      debugLog('Socket is ready but no active session, attempting to create one');
      
      // Add a slight delay to avoid race conditions
      const initTimer = setTimeout(() => {
        startSession()
          .then((newSessionId) => {
            if (newSessionId) {
              debugLog(`Session created: ${newSessionId}`);
            }
          })
          .catch((err) => {
            debugLog(`Failed to initialize session: ${err.message}`);
          });
      }, 1000);
      
      return () => clearTimeout(initTimer);
    }
  }, [socketReady, sessionId, connectionState, startSession, debugLog]);
  
  // Add a safety effect to reset stuck processing state
  useEffect(() => {
    // If processing lasts more than 20 seconds, automatically reset it as a failsafe
    let processingTimeout: ReturnType<typeof setTimeout> | null = null;
    
    if (useStore.getState().audioState.isProcessing) {
      debugLog('Setting up 20s timeout to auto-clear stuck processing state');
      processingTimeout = setTimeout(() => {
        debugLog('Processing state stuck for 20s, auto-resetting');
        setIsProcessing(false);
        setIsStreaming(false);
        addMessage('The AI seems to be taking too long to respond. Please try again.', 'bot', false);
      }, 20000);
    }
    
    return () => {
      if (processingTimeout) {
        clearTimeout(processingTimeout);
      }
    };
  }, [useStore.getState().audioState.isProcessing, addMessage, debugLog, setIsProcessing]);
  
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
      interface DiagnosticsData {
        timestamp: string;
        browser: string;
        socketState: {
          exists: boolean;
          connected: boolean;
          id: string;
        };
        sessionState: {
          sessionId: string | null;
          connectionState: string;
          hasError: boolean;
          errorMessage: string | null;
        };
        audioState: {
          isRecording: boolean;
          isProcessing: boolean;
          hasAudioContext: boolean;
          hasAudioProcessor: boolean;
          hasAudioStream: boolean;
        };
        pingTest?: {
          success: boolean;
          latency?: number;
          error?: string;
        };
      }

      const diagnostics: DiagnosticsData = {
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
          
          diagnostics.pingTest = pingResult;
          debugLog(`Ping test result: ${pingResult.success ? 'Success' : 'Failed'}, Latency: ${pingResult.latency}ms`);
        } catch (err) {
          debugLog('Error during ping test:', err);
          diagnostics.pingTest = {success: false, error: String(err)};
        }
      }
      
      return diagnostics;
    }
  };
};

export default useRealtimeVoiceChat; 