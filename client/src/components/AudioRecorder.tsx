import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MdMic, MdStop } from 'react-icons/md';
import { motion } from 'framer-motion';
import MicrophonePermissionsModal from './MicrophonePermissionsModal';
import useStore from '../store/useStore';
import useRealtimeVoiceChat from '../hooks/useRealtimeVoiceChat';
import useSocket from '../hooks/useSocket';
import '../styles/AudioRecorder.css';

/**
 * AudioRecorder component for voice chat with the AI
 */
const AudioRecorder: React.FC = () => {
  const {
    setIsRecording,
    setIsProcessing
  } = useStore();
  
  // Get socket connection
  const { socket } = useSocket();
  
  // State for the recorder UI
  const [permissionDenied, setPermissionDenied] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Reference to track if we're currently recording (regardless of hook state)
  const isRecordingRef = useRef<boolean>(false);
  
  // Use our custom hook for realtime voice chat
  const {
    sessionId,
    connectionState,
    error: voiceChatError,
    startSession,
    startRecording,
    stopRecording,
    isRecording,
    isProcessing,
    isStreaming,
    endSession,
    runConnectionDiagnostics,
    commitAudioBuffer,
    createResponse,
    clearAudioBuffer,
    getCurrentSessionId
  } = useRealtimeVoiceChat({
    debugMode: true,
    initialPrompt: 'You are a helpful assistant that answers questions about documents. Keep your answers concise and friendly.',
    voice: 'echo', // OpenAI voice options: alloy, ash, ballad, coral, echo, sage, shimmer, verse
    disableVad: true // Disable Voice Activity Detection for manual control
  });
  
  // Map connection state to UI state
  const voiceChatConnected = connectionState === 'connected';

  // Sync hook's recording state to our ref
  useEffect(() => {
    isRecordingRef.current = isRecording;
    // Update the global store state
    setIsRecording(isRecording);
  }, [isRecording, setIsRecording]);

  // Handle errors from the voice chat hook
  useEffect(() => {
    if (voiceChatError) {
      setErrorMessage(voiceChatError);
      console.error("Voice chat error:", voiceChatError);
    }
  }, [voiceChatError]);
  
  // Start recording function
  const startRecordingHandler = useCallback(async () => {
    if (isRecordingRef.current || isProcessing) return;
    
    console.log("🎙️ Starting recording...");
    try {
      // Ensure we have a session first
      if (!sessionId) {
        console.log("🔄 No session, starting one...");
        await startSession();
        console.log(`🔄 Session started: ${sessionId}`);
      }
      
      // Since VAD is disabled, clear the audio buffer before starting a new recording
      console.log("🧹 Clearing audio buffer...");
      const cleared = await clearAudioBuffer();
      if (!cleared) {
        console.warn("⚠️ Failed to clear audio buffer, but continuing anyway");
      } else {
        console.log("✅ Audio buffer cleared successfully");
      }
      
      // Start the actual recording
      const success = await startRecording();
      if (success) {
        isRecordingRef.current = true;
        console.log("✅ Recording started successfully! Speak now...");
        console.log("📊 Audio data should now be visible in server logs");
      } else {
        console.error("❌ Failed to start recording");
        setErrorMessage("Failed to start recording");
      }
    } catch (err) {
      console.error("❌ Error starting recording:", err);
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [sessionId, startSession, startRecording, isProcessing, clearAudioBuffer]);
  
  // Stop recording function
  const stopRecordingHandler = useCallback(async () => {
    if (!isRecordingRef.current) return;
    
    console.log("🛑 Stopping recording...");
    isRecordingRef.current = false;
    
    try {
      // Store the session ID before stopping the recording to ensure it's available
      const currentSessionId = getCurrentSessionId();
      if (!currentSessionId) {
        console.error("❌ No session ID available, cannot stop recording properly");
        setErrorMessage("Session ID not found. Please refresh and try again.");
        return;
      }
      console.log(`🔑 Using session ID for operations: ${currentSessionId}`);
      
      // Check connection state before proceeding with manual control
      if (connectionState !== 'connected') {
        console.error("❌ Cannot commit audio buffer: Not connected to server");
        setErrorMessage("Not connected to server. Please refresh and try again.");
        return;
      }
      
      await stopRecording();
      console.log("✅ Recording stopped");
      
      setIsProcessing(true);

      // Since VAD is disabled, we need to manually commit the audio buffer and create a response
      console.log("🎤 Manually committing audio buffer...");
      
      // Manually emit the event directly if the commitAudioBuffer function fails
      try {
        const committed = await commitAudioBuffer();
        if (!committed) {
          console.warn("⚠️ Failed to commit audio buffer through the hook, trying direct method");
          if (socket && socket.connected) {
            console.log(`🔄 Directly emitting commit-audio-buffer with session ID: ${currentSessionId}`);
            socket.emit('commit-audio-buffer', { sessionId: currentSessionId });
            console.log("✅ Direct emission of commit-audio-buffer event successful");
          } else {
            throw new Error("Socket not connected");
          }
        } else {
          console.log("✅ Audio buffer committed successfully");
        }
      } catch (commitError) {
        console.error("❌ Error committing audio buffer:", commitError);
        setErrorMessage(commitError instanceof Error ? commitError.message : String(commitError));
        setIsProcessing(false);
        return;
      }
      
      // Create a response once the audio buffer is committed
      console.log("🤖 Manually creating response...");
      try {
        const responseCreated = await createResponse();
        if (!responseCreated) {
          console.warn("⚠️ Failed to create response through the hook, trying direct method");
          if (socket && socket.connected) {
            console.log(`🔄 Directly emitting create-response with session ID: ${currentSessionId}`);
            socket.emit('create-response', { sessionId: currentSessionId });
            console.log("✅ Direct emission of create-response event successful");
          } else {
            throw new Error("Socket not connected");
          }
        } else {
          console.log("✅ Response creation initiated successfully");
        }
      } catch (responseError) {
        console.error("❌ Error creating response:", responseError);
        setErrorMessage(responseError instanceof Error ? responseError.message : String(responseError));
        setIsProcessing(false);
        return;
      }
      
      // Processing will be set to false when the response is done
      // This happens in the event handlers inside useRealtimeVoiceChat
    } catch (err) {
      console.error("❌ Error stopping recording:", err);
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setIsProcessing(false);
    }
  }, [stopRecording, setIsProcessing, commitAudioBuffer, createResponse, connectionState, socket, getCurrentSessionId]);
  
  // Handle press and hold for recording
  const handleRecordButtonDown = () => {
    startRecordingHandler();
  };
  
  const handleRecordButtonUp = () => {
    stopRecordingHandler();
  };
  
  // Handle spacebar key events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !isRecordingRef.current && !isProcessing) {
        e.preventDefault();
        startRecordingHandler();
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && isRecordingRef.current) {
        e.preventDefault();
        stopRecordingHandler();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isProcessing, startRecordingHandler, stopRecordingHandler]);
  
  // Clean up when component unmounts
  useEffect(() => {
    return () => {
      if (isRecordingRef.current) {
        stopRecording();
      }
      endSession().catch(err => console.error("Error ending session:", err));
    };
  }, [stopRecording, endSession]);
  
  // Recorder button animations
  const buttonVariants = {
    idle: { 
      scale: 1, 
      backgroundColor: "var(--accent-color)",
      transition: { duration: 0.2 }
    },
    recording: { 
      scale: [1, 1.1, 1], 
      backgroundColor: "var(--error-color)",
      transition: { repeat: Infinity, duration: 2 }
    },
    processing: {
      scale: 1,
      backgroundColor: "var(--processing-color)",
      transition: { duration: 0.2 }
    }
  };
  
  const micIconVariants = {
    idle: { scale: 1, opacity: 1 },
    recording: { scale: [1, 1.2, 1], opacity: 1, transition: { repeat: Infinity, duration: 2 } },
    processing: { scale: 1, opacity: 0.7 }
  };

  // Get the current button state based on recording status
  const getButtonState = () => {
    if (isProcessing) return "processing";
    if (isRecordingRef.current) return "recording";
    return "idle";
  };
  
  // Close permission dialog
  const handleClosePermissionModal = () => {
    setPermissionDenied(false);
  };
  
  return (
    <>
      <div className="record-button-container">
        <div className="spacebar-hint">
          Hold <kbd>Space</kbd> to record
        </div>
        <motion.button
          className="main-record-button"
          onMouseDown={handleRecordButtonDown}
          onMouseUp={handleRecordButtonUp}
          onMouseLeave={handleRecordButtonUp}
          onTouchStart={handleRecordButtonDown}
          onTouchEnd={handleRecordButtonUp}
          variants={buttonVariants}
          animate={getButtonState()}
          disabled={isProcessing && !isRecordingRef.current}
        >
          <motion.div
            variants={micIconVariants}
            animate={getButtonState()}
          >
            {isRecordingRef.current ? <MdStop size={24} /> : <MdMic size={24} />}
          </motion.div>
        </motion.button>
        
        {errorMessage && (
          <div className="error-message">
            {errorMessage}
          </div>
        )}
        
        {isProcessing && !isRecordingRef.current && (
          <div className="processing-indicator">
            Processing...
          </div>
        )}
      </div>
      
      {permissionDenied && (
        <MicrophonePermissionsModal onClose={handleClosePermissionModal} />
      )}
    </>
  );
};

export default AudioRecorder; 
