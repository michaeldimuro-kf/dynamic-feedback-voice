import React, { useState, useEffect } from 'react';
import useSocket from '../hooks/useSocket';
import useRealtimeVoiceChat from '../hooks/useRealtimeVoiceChat';

/**
 * A debug component to help diagnose connection issues with the WebRTC server
 */
const ConnectionDebugger: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [diagnosticResults, setDiagnosticResults] = useState<any>(null);
  const [isRunningTest, setIsRunningTest] = useState(false);
  
  // Get socket and voice chat hooks
  const { socket, socketReady, reconnect: reconnectSocket } = useSocket();
  const { 
    sessionId, 
    connectionState,
    error: realtimeError,
    runConnectionDiagnostics 
  } = useRealtimeVoiceChat({ debugMode: true });
  
  const runDiagnostics = async () => {
    setIsRunningTest(true);
    try {
      const results = await runConnectionDiagnostics();
      setDiagnosticResults(results);
      console.log('Diagnostic results:', results);
    } catch (err) {
      console.error('Error running diagnostics:', err);
    } finally {
      setIsRunningTest(false);
    }
  };
  
  const handleReconnect = () => {
    if (reconnectSocket) {
      reconnectSocket();
    }
  };
  
  // Update diagnostics automatically when socket state changes
  useEffect(() => {
    if (isExpanded) {
      runDiagnostics();
    }
  }, [socketReady, sessionId, connectionState, isExpanded]);
  
  if (!isExpanded) {
    return (
      <div className="fixed bottom-2 left-2 bg-gray-800 text-white p-2 rounded-lg shadow-lg cursor-pointer z-50"
           onClick={() => setIsExpanded(true)}>
        <div className="flex items-center space-x-2">
          <div className={`w-3 h-3 rounded-full ${socketReady ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <span className="text-xs font-mono">Debug</span>
        </div>
      </div>
    );
  }
  
  return (
    <div className="fixed bottom-2 left-2 bg-gray-800 text-white p-4 rounded-lg shadow-lg z-50 max-w-md max-h-[80vh] overflow-auto">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Connection Debugger</h3>
        <button 
          onClick={() => setIsExpanded(false)}
          className="text-gray-400 hover:text-white"
        >
          Close
        </button>
      </div>
      
      <div className="space-y-4">
        <div className="flex items-center space-x-2">
          <div className={`w-4 h-4 rounded-full ${socketReady ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <span className="font-mono">Socket: {socketReady ? 'Connected' : 'Disconnected'}</span>
          {socket && <span className="text-xs text-gray-400">ID: {socket.id}</span>}
        </div>
        
        <div className="flex items-center space-x-2">
          <div className={`w-4 h-4 rounded-full ${connectionState === 'connected' ? 'bg-green-500' : 
                          connectionState === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'}`}>
          </div>
          <span className="font-mono">Realtime: {connectionState}</span>
          {sessionId && <span className="text-xs text-gray-400">Session: {sessionId.substring(0, 8)}...</span>}
        </div>
        
        {realtimeError && (
          <div className="text-red-400 text-sm p-2 bg-red-900 bg-opacity-30 rounded">
            Error: {realtimeError}
          </div>
        )}
        
        <div className="flex space-x-2">
          <button
            onClick={handleReconnect}
            className="bg-blue-600 px-3 py-1 rounded text-sm hover:bg-blue-700"
            disabled={isRunningTest}
          >
            Reconnect Socket
          </button>
          
          <button
            onClick={runDiagnostics}
            className="bg-purple-600 px-3 py-1 rounded text-sm hover:bg-purple-700"
            disabled={isRunningTest}
          >
            {isRunningTest ? 'Running...' : 'Run Diagnostics'}
          </button>
        </div>
        
        {diagnosticResults && (
          <div className="mt-4 space-y-2">
            <h4 className="font-semibold">Diagnostic Results</h4>
            <div className="text-xs font-mono bg-gray-900 p-2 rounded overflow-x-auto">
              <pre>{JSON.stringify(diagnosticResults, null, 2)}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConnectionDebugger; 