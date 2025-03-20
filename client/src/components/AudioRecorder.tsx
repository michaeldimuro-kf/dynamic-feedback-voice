import { useState, useEffect, useRef } from 'react';
import useVoiceChat from '../hooks/useVoiceChat';
import useStore from '../store/useStore';

// Use WebSockets to communicate with server which manages WebRTC with OpenAI

const AudioRecorder = () => {
  // Get store state and methods
  const { 
    audioState,
    setIsRecording,
    setIsProcessing,
    addMessage,
    isConnected: socketConnected 
  } = useStore();
  
  // Local state
  const [statusText, setStatusText] = useState('Ready');
  const [error, setError] = useState<string | null>(null);
  
  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);

  // Initialize Voice Chat hook
  const { 
    isConnected: voiceChatConnected, 
    error: voiceChatError, 
    connectionState,
    startRecording, 
    stopRecording, 
    endSession 
  } = useVoiceChat({
    debugMode: true // Enable for easier troubleshooting
  });
  
  // Setup audio visualizer
  const setupVisualizer = (stream: MediaStream) => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    
    source.connect(analyser);
    analyser.fftSize = 256;
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const canvas = canvasRef.current;
    const canvasContext = canvas?.getContext('2d');
    
    if (!canvas || !canvasContext) {
      console.error('Canvas or context not available');
      return () => {};
    }
    
    contextRef.current = canvasContext;
    
    // Set canvas dimensions
    const resizeCanvas = () => {
      if (!canvas) return;
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // Draw function for visualization
    const draw = () => {
      if (!canvas || !canvasContext) return;
      
      // Request next animation frame
      animationRef.current = requestAnimationFrame(draw);
      
      // Get audio data
      analyser.getByteFrequencyData(dataArray);
      
      // Clear canvas
      canvasContext.fillStyle = 'rgba(255, 255, 255, 0.1)';
      canvasContext.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw bars
      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;
      
      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;
        
        // Use gradient based on amplitude
        const gradient = canvasContext.createLinearGradient(0, canvas.height, 0, 0);
        gradient.addColorStop(0, '#3a86ff');
        gradient.addColorStop(1, '#8338ec');
        
        canvasContext.fillStyle = gradient;
        canvasContext.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        
        x += barWidth + 1;
      }
    };
    
    // Start animation
    draw();
    
    // Return cleanup function
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      source.disconnect();
      if (audioContext.state !== 'closed') {
        audioContext.close().catch(console.error);
      }
    };
  };
  
  // Stop visualizer animation
  const stopVisualizer = () => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    
    // Clear canvas
    if (canvasRef.current && contextRef.current) {
      contextRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      
      // Draw flat line
      contextRef.current.beginPath();
      contextRef.current.moveTo(0, canvasRef.current.height / 2);
      contextRef.current.lineTo(canvasRef.current.width, canvasRef.current.height / 2);
      contextRef.current.strokeStyle = '#cccccc';
      contextRef.current.lineWidth = 2;
      contextRef.current.stroke();
    }
  };
  
  // Handle start recording button click
  const handleStartRecording = async () => {
    // Don't start if already recording or processing
    if (audioState.isRecording || audioState.isProcessing) {
      return;
    }
    
    // Clear any previous errors
    setError(null);
    
    // Update UI
    setStatusText('Starting...');
    
    try {
      // Start recording
      const success = await startRecording();
      
      if (success) {
        setStatusText('Recording...');
        console.log('Recording started');
        
        // Set up visualizer with the audio stream
        if (voiceChatConnected) {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const cleanup = setupVisualizer(stream);
          
          // Store cleanup function to call when recording stops
          return () => {
            if (cleanup) cleanup();
            stream.getTracks().forEach(track => track.stop());
          };
        }
      } else {
        setStatusText('Error starting');
        setError('Failed to start recording. Please try again.');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('Error starting recording:', err);
      setStatusText('Error');
      setError(`Recording error: ${errorMessage}`);
      setIsRecording(false);
    }
  };
  
  // Handle stop recording button click
  const handleStopRecording = async () => {
    // Only stop if currently recording
    if (!audioState.isRecording) {
      return;
    }
    
    // Update UI
    setStatusText('Processing...');
    stopVisualizer();
    
    try {
      // Stop recording
      const success = stopRecording();
      
      if (success) {
        console.log('Recording stopped, processing audio...');
      } else {
        setStatusText('Error processing');
        setError('Failed to process recording. Please try again.');
        setIsProcessing(false);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('Error stopping recording:', err);
      setStatusText('Error');
      setError(`Processing error: ${errorMessage}`);
      setIsProcessing(false);
    }
  };
  
  // Update UI based on connection state
  useEffect(() => {
    if (voiceChatError) {
      setError(voiceChatError);
      
      // Reset status if there was an error during recording or processing
      if (audioState.isRecording || audioState.isProcessing) {
        setStatusText('Connection error');
        setIsRecording(false);
        setIsProcessing(false);
      }
    }
  }, [voiceChatError, audioState.isRecording, audioState.isProcessing, setIsRecording, setIsProcessing]);
  
  // Set status text based on recording/processing state
  useEffect(() => {
    if (!socketConnected) {
      setStatusText('Connecting...');
    } else if (audioState.isRecording) {
      setStatusText('Recording...');
    } else if (audioState.isProcessing) {
      setStatusText('Processing...');
    } else if (!voiceChatConnected && connectionState !== 'disconnected') {
      setStatusText('Connecting voice...');
    } else if (voiceChatConnected) {
      setStatusText('Ready');
    } else {
      setStatusText('Ready');
    }
  }, [
    audioState.isRecording, 
    audioState.isProcessing, 
    socketConnected, 
    voiceChatConnected, 
    connectionState
  ]);
  
  // Set up keyboard shortcuts for recording
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Use spacebar to start recording
      if (e.code === 'Space' && !e.repeat && !audioState.isRecording && !audioState.isProcessing) {
        e.preventDefault();
        handleStartRecording();
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      // Release spacebar to stop recording
      if (e.code === 'Space' && audioState.isRecording) {
        e.preventDefault();
        handleStopRecording();
      }
    };
    
    // Add event listeners
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    // Clean up
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [audioState.isRecording, audioState.isProcessing]);
  
  // Close voice chat session on unmount
  useEffect(() => {
    return () => {
      endSession();
    };
  }, [endSession]);
  
  // Get button classes based on state
  const getButtonClass = () => {
    if (!socketConnected) {
      return 'button primary disconnected';
    }
    
    if (audioState.isRecording) {
      return 'button primary recording';
    }
    
    if (audioState.isProcessing) {
      return 'button primary processing';
    }
    
    return 'button primary connected';
  };
  
  // Get connection status indicator class
  const getConnectionStatusClass = () => {
    if (!socketConnected) {
      return 'status-indicator disconnected';
    }
    
    if (voiceChatConnected) {
      return 'status-indicator connected';
    }
    
    if (connectionState === 'checking' || connectionState === 'connecting' || connectionState === 'initializing') {
      return 'status-indicator connecting';
    }
    
    if (connectionState === 'failed' || voiceChatError) {
      return 'status-indicator error';
    }
    
    return 'status-indicator disconnected';
  };
  
  return (
    <div className="audio-controls-wrapper">
      <div className="audio-visualizer-container">
        <canvas ref={canvasRef} className="audio-visualizer"></canvas>
      </div>
      
      <div className="status-wrapper">
        <div className={getConnectionStatusClass()} title={connectionState}>
          <span></span>
        </div>
        <div className="status">{statusText}</div>
      </div>
      
      {error && (
        <div className="error-message">
          <p>{error}</p>
          <button 
            className="error-dismiss" 
            onClick={() => setError(null)}
            aria-label="Dismiss error"
          >×</button>
        </div>
      )}
      
      <div className="audio-controls">
        <button
          className={getButtonClass()}
          onMouseDown={handleStartRecording}
          onMouseUp={handleStopRecording}
          onTouchStart={handleStartRecording}
          onTouchEnd={handleStopRecording}
          disabled={!socketConnected || audioState.isProcessing}
        >
          {audioState.isRecording ? 'Recording...' : audioState.isProcessing ? 'Processing...' : 'Hold to Record'}
        </button>
        
        <div className="shortcut-hint">
          <kbd>Spacebar</kbd> {audioState.isRecording ? 'Release to Stop' : 'Hold to Record'}
        </div>
      </div>
    </div>
  );
};

export default AudioRecorder; 
