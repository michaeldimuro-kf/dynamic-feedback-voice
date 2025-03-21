import { useEffect, useRef, useState, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';
import useStore from '../store/useStore';

// Global socket instance to ensure single connection across components
let globalSocket: Socket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RETRY_DELAY = 1000;

// Define the message event types
interface Message {
  id: string;
  text: string;
  type: 'user' | 'bot';
  timestamp: Date;
}

// Add new interface for page summary
interface PageSummary {
  text: string;
  pageNumber: number;
  pageTitle: string;
  pageCount: number;
}

// Add interface for audio response
interface PageAudioResponse {
  audio: number[];
  pageNumber: number;
}

/**
 * Primary WebSocket connection manager for the entire application.
 * This hook creates and maintains a single global WebSocket connection
 * that is shared across all components, including voice chat functionality.
 * 
 * It handles:
 * - Socket connection and reconnection logic
 * - Event handling for messages, transcriptions, and responses
 * - Sending audio data and text inputs to the server
 */
const useSocket = () => {
  const { addMessage, setIsProcessing, setIsConnected } = useStore();
  const socketRef = useRef<Socket | null>(globalSocket);
  const [socketReady, setSocketReady] = useState<boolean>(globalSocket !== null && globalSocket.connected);
  
  // Add state for page narration
  const [currentPageSummary, setCurrentPageSummary] = useState<PageSummary | null>(null);
  const [isProcessingPage, setIsProcessingPage] = useState(false);
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  
  const createSocketConnection = useCallback(() => {
    // If we already have a connected socket, use it
    if (globalSocket?.connected) {
      console.log('[Socket] Using existing connected socket:', globalSocket.id);
      socketRef.current = globalSocket;
      setSocketReady(true);
      setIsConnected(true);
      return;
    }
    
    // If socket exists but is disconnected, try to reconnect
    if (globalSocket) {
      console.log('[Socket] Existing socket found but disconnected, attempting to reconnect...');
      
      if (!globalSocket.connected) {
        try {
          console.log('[Socket] Calling connect() on existing socket');
          globalSocket.connect();
        } catch (err) {
          console.error('[Socket] Error reconnecting socket:', err);
          // If reconnecting fails, create a new socket
          console.log('[Socket] Reconnection failed, will create new socket');
          globalSocket = null;
        }
      }
      
      socketRef.current = globalSocket;
      return;
    }
    
    // Create a new socket if none exists
    console.log('[Socket] Creating new socket connection...');
    
    // Get server URL from environment or use default
    const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';
    console.log('[Socket] Connecting to server at:', serverUrl);
    
    try {
      const socket = io(serverUrl, {
        reconnection: true,
        reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
        reconnectionDelay: INITIAL_RETRY_DELAY,
        reconnectionDelayMax: 5000,
        timeout: 10000,
        transports: ['websocket', 'polling'], // Try WebSocket first, then fallback to polling
        forceNew: false, // Try to reuse existing connection if possible
      });
      
      // Save as global
      globalSocket = socket;
      socketRef.current = socket;
      
      // Connection event handlers with more detailed logging
      socket.on('connect', () => {
        console.log('[Socket] Connected successfully with ID:', socket.id);
        reconnectAttempts = 0;
        setSocketReady(true);
        setIsConnected(true);
      });
      
      socket.on('disconnect', (reason) => {
        console.log('[Socket] Disconnected - Reason:', reason);
        setSocketReady(false);
        setIsConnected(false);
      });
      
      socket.on('connect_error', (error) => {
        console.error('[Socket] Connection error:', error);
        reconnectAttempts++;
        setSocketReady(false);
        setIsConnected(false);
        
        console.log(`[Socket] Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
        
        // If max reconnect attempts reached, notify user
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          addMessage('Unable to connect to server. Please check your internet connection and try again.', 'bot', false);
        }
      });

      // Add more detailed socket event logging
      socket.on('reconnect', (attemptNumber) => {
        console.log(`[Socket] Successfully reconnected after ${attemptNumber} attempts`);
        setSocketReady(true);
        setIsConnected(true);
      });

      socket.on('reconnect_attempt', (attemptNumber) => {
        console.log(`[Socket] Reconnection attempt #${attemptNumber}`);
      });

      socket.on('reconnect_error', (error) => {
        console.error('[Socket] Error during reconnection attempt:', error);
      });

      socket.on('reconnect_failed', () => {
        console.error('[Socket] Failed to reconnect after maximum attempts');
        addMessage('Connection to server lost. Please refresh the page to try again.', 'bot', false);
      });

      // Custom event handlers
      socket.on('transcription-result', (data) => {
        console.log('Received transcription:', data);
        if (data && data.text) {
          addMessage(data.text, 'user', false);
        }
      });
      
      socket.on('transcription', (data) => {
        console.log('Received transcription (legacy event):', data);
        if (data && data.text) {
          addMessage(data.text, 'user', false);
        }
      });
      
      socket.on('ai-response', (data) => {
        console.log('Received AI response:', data);
        
        if (data && data.text) {
          addMessage(data.text, 'bot', false);
        } else {
          console.error('Received invalid AI response:', data);
          addMessage('Sorry, I received an invalid response. Please try again.', 'bot', false);
        }
      });
      
      socket.on('audio-response', (data) => {
        console.log('Received audio response');
        
        if (data && data.audio && data.audio.length > 0) {
          try {
            // Convert array back to Blob
            const audioArray = new Uint8Array(data.audio);
            const audioBlob = new Blob([audioArray], { type: 'audio/mp3' });
            
            // Create object URL for the blob
            const audioUrl = URL.createObjectURL(audioBlob);
            
            // Create audio element
            const audio = new Audio();
            audio.src = audioUrl;
            
            // Play audio
            audio.play().catch(err => {
              console.error('Error playing audio:', err);
            });
            
            // Clean up URL after playback
            audio.onended = () => {
              URL.revokeObjectURL(audioUrl);
              console.log('Audio playback complete');
              setIsProcessing(false);
            };
          } catch (error) {
            console.error('Error handling audio response:', error);
            setIsProcessing(false);
          }
        } else {
          console.log('Audio processing complete (empty audio response)');
          setIsProcessing(false);
        }
      });
      
      socket.on('error', (error) => {
        console.error('Socket error:', error);
        
        let errorMessage = 'An error occurred. Please try again.';
        
        if (typeof error === 'string') {
          errorMessage = error;
        } else if (error && typeof error === 'object' && 'message' in error) {
          errorMessage = String(error.message);
        }
        
        addMessage(errorMessage, 'bot', false);
        setIsProcessing(false);
      });
      
    } catch (error) {
      console.error('Error creating socket connection:', error);
      setSocketReady(false);
      setIsConnected(false);
    }
    
  }, [addMessage, setIsProcessing, setIsConnected]);
  
  // Initialize socket connection
  useEffect(() => {
    createSocketConnection();
    
    // Check socket connection status periodically
    const checkConnectionInterval = setInterval(() => {
      const isConnected = socketRef.current?.connected ?? false;
      
      // If our state doesn't match the actual connection status, update it
      if (socketReady !== isConnected) {
        console.log(`Socket connection state mismatch - Current: ${socketReady}, Actual: ${isConnected}`);
        setSocketReady(isConnected);
        setIsConnected(isConnected);
      }
    }, 2000);
    
    // Cleanup function
    return () => {
      clearInterval(checkConnectionInterval);
      // Don't disconnect on component unmount
      // We want to keep the connection alive
    };
  }, [createSocketConnection, socketReady]);
  
  // Function to send audio data to server
  const sendAudio = useCallback(async (
    audioData: Uint8Array,
    isFinal: boolean = false,
    mimeType: string = 'audio/webm'
  ): Promise<boolean> => {
    // If socket is not connected, wait for it to connect with a timeout
    if (socketRef.current && !socketRef.current.connected) {
      console.log('Socket not connected, waiting for connection...');
      
      try {
        await new Promise<void>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            reject(new Error('Connection timeout'));
          }, 5000);
          
          const connectHandler = () => {
            clearTimeout(timeoutId);
            resolve();
          };
          
          socketRef.current?.once('connect', connectHandler);
          
          // Clean up if we abort
          return () => {
            clearTimeout(timeoutId);
            socketRef.current?.off('connect', connectHandler);
          };
        });
      } catch (error) {
        console.error('Timed out waiting for socket connection');
        return false;
      }
    }
    
    // Check if we have a valid socket connection
    if (!socketRef.current) {
      console.error('No socket connection available');
      return false;
    }
    
    // Double check connection status before sending
    if (!socketRef.current.connected) {
      console.error('Socket is not connected, cannot send audio');
      return false;
    }
    
    try {
      console.log(`Sending audio data: ${audioData.length} bytes, isFinal: ${isFinal}, mimeType: ${mimeType}`);
      
      // Send the audio data - backend expects streaming-audio event
      socketRef.current.emit('streaming-audio', {
        audio: Array.from(audioData),
        isFinal,
        mimeType,
      });
      
      // Mark as processing if this is the final chunk
      if (isFinal) {
        setIsProcessing(true);
      }
      
      return true;
    } catch (error) {
      console.error('Error sending audio:', error);
      return false;
    }
  }, [setIsProcessing]);
  
  // Function to send text input instead of audio
  const sendTextInput = useCallback((text: string): boolean => {
    if (!socketRef.current || !socketRef.current.connected) {
      console.error('Socket not connected, cannot send text');
      return false;
    }
    
    try {
      console.log('Sending text input:', text);
      setIsProcessing(true);
      socketRef.current.emit('text-input', { text });
      return true;
    } catch (error) {
      console.error('Error sending text:', error);
      setIsProcessing(false);
      return false;
    }
  }, [setIsProcessing]);
  
  // Function to manually attempt reconnection
  const reconnect = useCallback(() => {
    if (socketRef.current && !socketRef.current.connected) {
      console.log('Manually attempting reconnection...');
      socketRef.current.connect();
      
      // Update connection status after a short delay to allow connection to establish
      setTimeout(() => {
        const isConnected = socketRef.current?.connected ?? false;
        setSocketReady(isConnected);
        setIsConnected(isConnected);
        console.log(`Socket connection status after reconnect attempt: ${isConnected}`);
      }, 1000);
    } else {
      console.log('Creating new connection...');
      createSocketConnection();
    }
  }, [createSocketConnection, setIsConnected]);
  
  // Expose the connection status to help debug issues
  const getConnectionStatus = useCallback(() => {
    const status = {
      socketExists: socketRef.current !== null,
      socketConnected: socketRef.current?.connected ?? false,
      socketReady,
      globalSocketExists: globalSocket !== null,
      globalSocketConnected: globalSocket?.connected ?? false
    };
    
    console.log('Socket connection status:', status);
    return status;
  }, [socketReady]);
  
  // Add listeners for page summary events
  useEffect(() => {
    if (!socketRef.current) return;

    // Handle page summary
    const handlePageSummary = (data: PageSummary) => {
      console.log('Received page summary:', data);
      setCurrentPageSummary(data);
      
      // Add the summary to the chat messages
      if (addMessage) {
        addMessage(`Page ${data.pageNumber} - ${data.pageTitle}: ${data.text}`, 'bot', false);
      }
    };

    // Handle page audio response
    const handlePageAudioResponse = (data: PageAudioResponse) => {
      console.log(`Received audio for page ${data.pageNumber}, size: ${data.audio.length} bytes`);
      
      if (data.audio && data.audio.length > 0) {
        try {
          // Convert audio data to playable format
          const audioBlob = new Blob([new Uint8Array(data.audio)], { type: 'audio/mpeg' });
          const audioUrl = URL.createObjectURL(audioBlob);
          
          // Create audio element
          const audio = new Audio(audioUrl);
          
          // Store the audio element for controlling playback
          setCurrentAudio(audio);
          
          // Set up event listeners
          audio.onended = () => {
            console.log('Audio playback ended');
            setCurrentAudio(null);
            setIsProcessingPage(false);
            
            // Clean up the URL
            URL.revokeObjectURL(audioUrl);
            
            // Emit event when audio ends
            if (socketRef.current && socketRef.current.connected) {
              socketRef.current.emit('page-audio-completed', { pageNumber: data.pageNumber });
            }
          };
          
          // Start playing audio
          audio.play().catch(err => {
            console.error('Error playing audio:', err);
            setIsProcessingPage(false);
          });
        } catch (error) {
          console.error('Error processing audio response:', error);
          setIsProcessingPage(false);
        }
      } else {
        console.log('Received empty audio data');
        setIsProcessingPage(false);
      }
    };

    // Add event listeners
    socketRef.current.on('page-summary', handlePageSummary);
    socketRef.current.on('page-audio-response', handlePageAudioResponse);

    // Cleanup function
    return () => {
      socketRef.current?.off('page-summary', handlePageSummary);
      socketRef.current?.off('page-audio-response', handlePageAudioResponse);
    };
  }, [socketRef.current, addMessage]);

  // Add function to request page summarization
  const requestPageSummary = async (pageNumber: number): Promise<boolean> => {
    console.log(`Requesting summary for page ${pageNumber}`);
    
    if (!socketRef.current || !socketRef.current.connected) {
      console.log('Socket not connected');
      return false;
    }
    
    // Set processing state
    setIsProcessingPage(true);
    
    try {
      // Emit the summarize-page event
      socketRef.current.emit('summarize-page', { pageNumber });
      return true;
    } catch (error) {
      console.error('Error requesting page summary:', error);
      setIsProcessingPage(false);
      return false;
    }
  };
  
  // Add functions to control audio playback
  const pauseAudio = () => {
    if (currentAudio) {
      currentAudio.pause();
      setIsPaused(true);
    }
  };
  
  const resumeAudio = () => {
    if (currentAudio) {
      currentAudio.play();
      setIsPaused(false);
    }
  };
  
  const stopAudio = () => {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      setIsPaused(false);
      setCurrentAudio(null);
      setIsProcessingPage(false);
    }
  };
  
  // Return socket and utility functions
  return {
    socket: socketRef.current,
    socketReady,
    sendAudio,
    sendTextInput,
    requestPageSummary,
    pauseAudio,
    resumeAudio,
    stopAudio,
    currentPageSummary,
    isProcessingPage,
    isPaused,
    reconnect: createSocketConnection
  };
};

export default useSocket; 