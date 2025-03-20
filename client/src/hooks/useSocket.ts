import { useEffect, useRef, useState, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';
import useStore from '../store/useStore';

// Global socket instance to ensure single connection across components
let globalSocket: Socket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RETRY_DELAY = 1000;

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
  
  const createSocketConnection = useCallback(() => {
    // If we already have a connected socket, use it
    if (globalSocket?.connected) {
      console.log('Using existing connected socket:', globalSocket.id);
      socketRef.current = globalSocket;
      setSocketReady(true);
      setIsConnected(true);
      return;
    }
    
    // If socket exists but is disconnected, try to reconnect
    if (globalSocket) {
      console.log('Attempting to reconnect existing socket...');
      
      if (!globalSocket.connected) {
        try {
          globalSocket.connect();
        } catch (err) {
          console.error('Error reconnecting socket:', err);
          // If reconnecting fails, create a new socket
          globalSocket = null;
        }
      }
      
      socketRef.current = globalSocket;
      return;
    }
    
    // Create a new socket if none exists
    console.log('Creating new socket connection...');
    
    // Get server URL from environment or use default
    const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';
    console.log('Connecting to server at:', serverUrl);
    
    try {
      const socket = io(serverUrl, {
        reconnection: true,
        reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
        reconnectionDelay: INITIAL_RETRY_DELAY,
        reconnectionDelayMax: 5000,
        timeout: 10000,
        transports: ['websocket', 'polling'], // Try WebSocket first, then fallback to polling
      });
      
      // Save as global
      globalSocket = socket;
      socketRef.current = socket;
      
      // Connection event handlers
      socket.on('connect', () => {
        console.log('Socket connected:', socket.id);
        reconnectAttempts = 0;
        setSocketReady(true);
        setIsConnected(true);
      });
      
      socket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
        setSocketReady(false);
        setIsConnected(false);
      });
      
      socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
        reconnectAttempts++;
        setSocketReady(false);
        setIsConnected(false);
        
        // If max reconnect attempts reached, notify user
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          addMessage('Unable to connect to server. Please check your internet connection and try again.', 'bot');
        }
      });
      
      // Custom event handlers
      socket.on('transcription-result', (data) => {
        console.log('Received transcription:', data);
        if (data && data.text) {
          addMessage(data.text, 'user');
        }
      });
      
      socket.on('transcription', (data) => {
        console.log('Received transcription (legacy event):', data);
        if (data && data.text) {
          addMessage(data.text, 'user');
        }
      });
      
      socket.on('ai-response', (data) => {
        console.log('Received AI response:', data);
        
        if (data && data.text) {
          addMessage(data.text, 'bot');
        } else {
          console.error('Received invalid AI response:', data);
          addMessage('Sorry, I received an invalid response. Please try again.', 'bot');
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
        
        addMessage(errorMessage, 'bot');
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
  
  return { 
    socket: socketRef.current, 
    socketReady, 
    sendAudio, 
    sendTextInput, 
    reconnect,
    getConnectionStatus
  };
};

export default useSocket; 