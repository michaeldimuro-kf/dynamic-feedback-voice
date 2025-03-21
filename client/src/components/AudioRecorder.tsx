import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MdMic, MdStop, MdSettings } from 'react-icons/md';
import { AnimatePresence, motion } from 'framer-motion';
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
  const [showRecorder, setShowRecorder] = useState<boolean>(false);
  const [permissionDenied, setPermissionDenied] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Reference to track if we're currently recording
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
    endSession
  } = useRealtimeVoiceChat({
    debugMode: true,
    initialPrompt: 'You are a helpful assistant that answers questions about documents. Keep your answers concise and friendly.',
    voice: 'alloy' // OpenAI voice options: alloy, echo, fable, onyx, nova, shimmer
  });
  
  // Map connection state to UI state
  const voiceChatConnected = connectionState === 'connected';

  // Handle errors from the voice chat hook
  useEffect(() => {
    if (voiceChatError) {
      setErrorMessage(voiceChatError);
      console.error("Voice chat error:", voiceChatError);
    }
  }, [voiceChatError]);
  
  // Toggle recorder visibility
  const toggleRecorder = () => {
    setShowRecorder(!showRecorder);
  };
  
  // Handle button click to start/stop recording
  const handleRecordButtonClick = useCallback(async () => {
    if (isRecordingRef.current) {
      // If already recording, stop it
      console.log("Stopping recording...");
      stopRecording();
      isRecordingRef.current = false;
    } else {
      // If not recording, start it
      console.log("Starting recording...");
      try {
        // Ensure we have a session first
        if (!sessionId) {
          console.log("No session, starting one...");
          await startSession();
        }
        
        // Start the actual recording
        const success = await startRecording();
        if (success) {
          isRecordingRef.current = true;
          console.log("Recording started successfully");
        } else {
          console.error("Failed to start recording");
          setErrorMessage("Failed to start recording");
        }
      } catch (err) {
        console.error("Error starting recording:", err);
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    }
  }, [sessionId, startSession, startRecording, stopRecording]);
  
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
  const recorderVariants = {
    hidden: { opacity: 0, scale: 0.8 },
    visible: { opacity: 1, scale: 1, transition: { type: "spring", duration: 0.5 } }
  };
  
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
    if (isRecording) return "recording";
    return "idle";
  };
  
  // Close permission dialog
  const handleClosePermissionModal = () => {
    setPermissionDenied(false);
  };
  
  return (
    <>
      <div className="audio-recorder-wrapper">
        <AnimatePresence>
          {showRecorder && (
            <motion.div 
              className="recorder-controls"
              variants={recorderVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
            >
              <motion.button
                className="record-button"
                onClick={handleRecordButtonClick}
                variants={buttonVariants}
                animate={getButtonState()}
                disabled={isProcessing && !isRecording}
              >
                <motion.div
                  variants={micIconVariants}
                  animate={getButtonState()}
                >
                  {isRecording ? <MdStop size={24} /> : <MdMic size={24} />}
                </motion.div>
              </motion.button>
              
              {errorMessage && (
                <div className="error-message">
                  {errorMessage}
                </div>
              )}
              
              {isProcessing && !isRecording && (
                <div className="processing-indicator">
                  Processing...
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        
        <button 
          className={`toggle-recorder-button ${showRecorder ? 'active' : ''}`}
          onClick={toggleRecorder}
          aria-label="Toggle audio recorder"
        >
          {showRecorder ? <MdSettings size={20} /> : <MdMic size={20} />}
        </button>
      </div>
      
      {permissionDenied && (
        <MicrophonePermissionsModal onClose={handleClosePermissionModal} />
      )}
    </>
  );
};

export default AudioRecorder; 
