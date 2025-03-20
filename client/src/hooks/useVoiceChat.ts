import { useCallback, useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import useStore from '../store/useStore';
import useSocket from './useSocket';

interface UseVoiceChatOptions {
  debugMode?: boolean;
}

interface TranscriptionData {
  text: string;
  sessionId: string;
  timestamp: string;
}

interface AudioResponseData {
  audio?: string;
  text?: string;
  sessionId: string;
  timestamp: string;
}

interface SessionResponse {
  sessionId?: string;
  error?: string;
  status?: string;
  timestamp?: string;
  details?: string;
}

/**
 * Custom hook for voice chat that leverages the shared socket connection
 * from useSocket hook to communicate with the server
 */
const useVoiceChat = (options: UseVoiceChatOptions = {}) => {
  const { addMessage, setIsProcessing, setIsRecording } = useStore();
  
  // Get the socket instance from useSocket hook
  const { socket, socketReady, sendAudio, reconnect, getConnectionStatus } = useSocket();
  
  // Options with defaults
  const debugMode = options.debugMode || import.meta.env.VITE_DEBUG_WEBRTC === 'true';
  
  // State
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<string>('disconnected');
  
  // Refs
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // Debug logging function
  const debugLog = useCallback((message: string, ...args: unknown[]) => {
    if (debugMode) {
      console.log(`[VoiceChat] ${message}`, ...args);
    }
  }, [debugMode]);
  
  // Helper function to play audio safely
  const playAudio = useCallback((audioSrc: string) => {
    try {
      const audio = new Audio(audioSrc);
      
      // Using a separate function to handle the promise
      const playPromise = audio.play();
      
      // Proper promise handling to satisfy TypeScript
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          debugLog('Error playing audio:', err);
        });
      }
    } catch (err) {
      debugLog('Error creating audio element:', err);
    }
  }, [debugLog]);
  
  // Update connection state based on socket status
  useEffect(() => {
    if (socketReady) {
      setConnectionState('connected');
    } else {
      setConnectionState('disconnected');
    }
  }, [socketReady]);
  
  // Set up event listeners for voice-specific events
  useEffect(() => {
    if (!socket) return;
    
    // Function to handle transcription results
    const handleTranscription = (data: TranscriptionData) => {
      debugLog('Received transcription:', data);
      if (data.text) {
        // Note: We're not adding to messages here as useSocket already handles this
        // This prevents duplicate messages
      }
    };
    
    // Function to handle AI responses
    const handleAIResponse = (data: { text: string }) => {
      debugLog('Received AI text response:', data);
      // Again, not adding to messages here as useSocket handles it
    };
    
    // Function to handle audio responses
    const handleAudioResponse = (data: { audio: number[] }) => {
      debugLog('Received audio response:', data);
      // Audio playback is handled by useSocket
    };
    
    // Error handler
    const handleError = (errorMessage: string) => {
      debugLog('Received error from server:', errorMessage);
      setError(errorMessage);
    };
    
    // Session ended handler
    const handleSessionEnded = (data: any) => {
      debugLog('Session ended by server:', data);
      setSessionId(null);
      setIsRecording(false);
      setIsProcessing(false);
    };
    
    // OpenAI connection handler
    const handleOpenAIConnected = (data: any) => {
      debugLog('OpenAI connection established:', data);
      setConnectionState('ready');
    };
    
    // Add event listeners
    socket.on('session-ended', handleSessionEnded);
    socket.on('openai-connected', handleOpenAIConnected);
    
    // These listeners are for debugging purposes only since useSocket handles the main functionality
    socket.on('transcription-result', handleTranscription);
    socket.on('ai-response', handleAIResponse);
    socket.on('audio-response', handleAudioResponse);
    socket.on('error', handleError);
    
    // Cleanup function
    return () => {
      socket.off('session-ended', handleSessionEnded);
      socket.off('openai-connected', handleOpenAIConnected);
      socket.off('transcription-result', handleTranscription);
      socket.off('ai-response', handleAIResponse);
      socket.off('audio-response', handleAudioResponse);
      socket.off('error', handleError);
    };
  }, [socket, debugLog, setIsProcessing, setIsRecording]);
  
  // Send audio chunk to server using the shared socket
  const sendAudioChunk = useCallback(async (audioBlob: Blob, isFinal: boolean = false) => {
    try {
      // Check for socket connection
      if (!socket) {
        debugLog('Cannot send audio: Socket not available');
        
        if (isFinal) {
          // For final chunks, attempt to reconnect
          debugLog('Final chunk - attempting to reconnect before sending...');
          reconnect();
          
          // Wait for potential reconnection
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Check if reconnection worked
          const status = getConnectionStatus();
          if (!status.socketConnected) {
            debugLog('Still no socket connection after reconnection attempt');
            setError('Connection lost. Unable to process your audio.');
            setIsProcessing(false);
            return;
          }
        } else {
          // For non-final chunks, just log and return
          return;
        }
      }
      
      // Convert blob to array buffer
      const arrayBuffer = await audioBlob.arrayBuffer();
      
      // Convert ArrayBuffer to Uint8Array for transmission
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Use the sendAudio function from useSocket
      debugLog(`Sending audio chunk: ${uint8Array.length} bytes, isFinal: ${isFinal}`);
      const success = await sendAudio(uint8Array, isFinal, 'audio/webm');
      
      if (!success && isFinal) {
        debugLog('Failed to send final audio chunk');
        setError('Failed to send audio to server. Please try again.');
        setIsProcessing(false);
      }
      
    } catch (err) {
      debugLog('Error sending audio chunk:', err);
      
      if (isFinal) {
        setError(`Error sending audio: ${err instanceof Error ? err.message : 'Unknown error'}`);
        setIsProcessing(false);
      }
    }
  }, [debugLog, socket, sendAudio, reconnect, getConnectionStatus, setError, setIsProcessing]);
  
  // Request microphone access
  const requestMicrophone = useCallback(async () => {
    try {
      debugLog('Requesting microphone access...');
      
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      
      debugLog('Microphone access granted');
      return true;
    } catch (err) {
      debugLog('Error accessing microphone:', err);
      setError(`Microphone access denied: ${err instanceof Error ? err.message : 'Unknown error'}`);
      return false;
    }
  }, [debugLog, setError]);
  
  // Start recording audio
  const startRecording = useCallback(async () => {
    try {
      debugLog('Starting recording...');
      
      // Reset any existing error
      setError(null);
      
      // Check if already recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        debugLog('Already recording');
        return true;
      }
      
      // Make sure we have a valid socket connection
      if (!socket || !socketReady) {
        debugLog('Socket not connected, attempting to reconnect...');
        
        // Use the reconnect function from useSocket
        reconnect();
        
        // Give it a moment to connect
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Check connection status after reconnection attempt
        const status = getConnectionStatus();
        
        if (!status.socketConnected) {
          debugLog('Socket still not connected after reconnection attempt');
          setError('Unable to connect to the server. Please refresh the page and try again.');
          return false;
        } else {
          debugLog('Socket reconnected successfully');
        }
      }
      
      // Request microphone access if needed
      if (!mediaStreamRef.current) {
        const micGranted = await requestMicrophone();
        if (!micGranted) {
          debugLog('Failed to access microphone');
          return false;
        }
      }
      
      // Set up new MediaRecorder
      const stream = mediaStreamRef.current!;
      const options = { mimeType: 'audio/webm' };
      
      // Clear previous recording chunks
      recordingChunksRef.current = [];
      
      // Create new MediaRecorder
      const recorder = new MediaRecorder(stream, options);
      
      // Set up event handlers
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
          
          // Note: We're no longer sending each small chunk to avoid duplicate audio
          // The complete audio will be sent when recording stops
          // sendAudioChunk(event.data, false);
        }
      };
      
      // Start recording
      recorder.start(500); // Capture in 500ms chunks for more real-time feeling
      mediaRecorderRef.current = recorder;
      
      // Update state
      setIsRecording(true);
      debugLog('Recording started');
      
      return true;
    } catch (err) {
      debugLog('Error starting recording:', err);
      setError(`Failed to start recording: ${err instanceof Error ? err.message : 'Unknown error'}`);
      return false;
    }
  }, [debugLog, socket, socketReady, requestMicrophone, setError, setIsRecording, reconnect, getConnectionStatus]);
  
  // Stop recording
  const stopRecording = useCallback(() => {
    try {
      debugLog('Stopping recording...');
      
      // Check if recording
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') {
        debugLog('Not recording');
        return false;
      }
      
      // Stop media recorder
      mediaRecorderRef.current.stop();
      
      // Wait for last ondataavailable event and then send final chunk
      setTimeout(async () => {
        debugLog('Sending final audio chunk...');
        if (recordingChunksRef.current.length > 0) {
          // Check socket connection before sending
          if (!socket || !socketReady) {
            debugLog('Socket not connected, attempting to reconnect before sending final chunk...');
            reconnect();
            
            // Wait a moment for reconnection
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // Check if reconnection was successful
            const status = getConnectionStatus();
            if (!status.socketConnected) {
              debugLog('Socket still not connected, cannot send audio');
              setError('Connection lost. Please refresh the page and try again.');
              setIsProcessing(false);
              return;
            }
          }
          
          // Create a combined blob of all chunks
          const combinedBlob = new Blob(recordingChunksRef.current, { type: 'audio/webm' });
          
          // Send as final chunk
          sendAudioChunk(combinedBlob, true);
          
          // Clear chunks
          recordingChunksRef.current = [];
        } else {
          debugLog('No audio chunks to send');
          setIsProcessing(false);
        }
      }, 100);
      
      // Update state
      setIsRecording(false);
      setIsProcessing(true);
      
      debugLog('Recording stopped');
      return true;
    } catch (err) {
      debugLog('Error stopping recording:', err);
      setError(`Failed to stop recording: ${err instanceof Error ? err.message : 'Unknown error'}`);
      return false;
    }
  }, [debugLog, sendAudioChunk, setError, setIsProcessing, setIsRecording]);
  
  // End the session
  const endSession = useCallback(async () => {
    try {
      debugLog('Ending session...');
      
      // Stop recording if active
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      
      // Stop and release microphone stream
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }
      
      // Notify server to end the session
      if (socket && sessionId) {
        await new Promise<void>((resolve) => {
          if (!socket) {
            resolve();
            return;
          }
          
          socket.emit('end-session', { sessionId }, () => {
            resolve();
          });
          
          // Resolve after timeout in case server doesn't respond
          setTimeout(resolve, 1000);
        });
      }
      
      // Reset state
      setSessionId(null);
      setIsRecording(false);
      setIsProcessing(false);
      
      debugLog('Session ended');
      return true;
    } catch (err) {
      debugLog('Error ending session:', err);
      return false;
    }
  }, [debugLog, sessionId, socket, setIsProcessing, setIsRecording]);
  
  // Clean up resources when component unmounts
  useEffect(() => {
    return () => {
      // End session and clean up
      endSession();
    };
  }, [endSession]);
  
  // Log session ID changes for debugging
  useEffect(() => {
    debugLog(`Session ID changed: ${sessionId || 'null'}`);
  }, [debugLog, sessionId]);
  
  // Return the public API
  return {
    isConnected: socketReady,
    error,
    connectionState,
    startRecording,
    stopRecording,
    endSession
  };
};

export default useVoiceChat; 