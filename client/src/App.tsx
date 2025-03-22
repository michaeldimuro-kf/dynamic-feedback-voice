import { useEffect } from 'react'
import Header from './components/Header'
import PDFViewer from './components/PDFViewer'
import Chat from './components/Chat'
import AudioRecorder from './components/AudioRecorder'
import ConnectionDebugger from './components/ConnectionDebugger'
import useStore from './store/useStore'
import './App.css'
import useSocket from './hooks/useSocket'

function App() {
  const { isConnected } = useStore()
  const { reconnect } = useSocket()
  
  useEffect(() => {
    // Initial connection attempt
    reconnect()
  }, [reconnect])
  
  return (
    <div className="app">
      <Header />
      <main>
        <PDFViewer />
        <div className="chat-section">
          <Chat />
          
          {!isConnected && (
            <div className="connection-status">
              <p>Connecting to server...</p>
            </div>
          )}
          
          <AudioRecorder />
        </div>
      </main>
      
      <ConnectionDebugger />
    </div>
  )
}

export default App
