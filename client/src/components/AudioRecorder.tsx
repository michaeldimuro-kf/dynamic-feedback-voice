import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MdMic, MdStop } from 'react-icons/md';
import { motion } from 'framer-motion';
import MicrophonePermissionsModal from './MicrophonePermissionsModal';
import useStore from '../store/useStore';
import useRealtimeVoiceChat from '../hooks/useRealtimeVoiceChat';
import '../styles/AudioRecorder.css';

/**
 * AudioRecorder component for voice chat with the AI
 */
const AudioRecorder: React.FC = () => {
  const {
    setIsRecording
  } = useStore();
  
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
    runConnectionDiagnostics
  } = useRealtimeVoiceChat({
    debugMode: true,
    initialPrompt: 'You are a helpful assistant that answers questions about documents. Keep your answers concise and friendly.',
    voice: 'onxy' // OpenAI voice options: alloy, echo, fable, onyx, nova, shimmer
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
  }, [sessionId, startSession, startRecording, isProcessing]);
  
  // Stop recording function
  const stopRecordingHandler = useCallback(() => {
    if (!isRecordingRef.current) return;
    
    console.log("🛑 Stopping recording...");
    stopRecording();
    isRecordingRef.current = false;
    console.log("🛑 Recording stopped!");
  }, [stopRecording]);
  
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
