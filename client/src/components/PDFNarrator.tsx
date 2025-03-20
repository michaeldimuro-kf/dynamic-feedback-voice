import { useEffect, useState } from 'react';
import useStore from '../store/useStore';
import useSocket from '../hooks/useSocket';

const PDFNarrator = () => {
  const { pdfState } = useStore();
  const { 
    requestPageSummary, 
    isProcessingPage, 
    currentAudio, 
    isPaused,
    pauseAudio,
    resumeAudio,
    stopAudio 
  } = useSocket();
  
  const [isNarrating, setIsNarrating] = useState(false);
  const [currentPageNumber, setCurrentPageNumber] = useState(1);

  // Start narration of the PDF
  const startNarration = async () => {
    setIsNarrating(true);
    
    // Start with the current page
    const currentPage = pdfState.pageNum;
    setCurrentPageNumber(currentPage);
    
    // Request summary for the current page
    await requestPageSummary(currentPage);
  };

  // Stop narration
  const stopNarration = () => {
    setIsNarrating(false);
    stopAudio();
  };

  // Move to the next page when audio playback finishes
  useEffect(() => {
    if (isNarrating && !isProcessingPage && !currentAudio && currentPageNumber > 0) {
      // Audio has finished playing, move to next page
      const nextPage = currentPageNumber + 1;
      
      if (nextPage <= pdfState.pageCount) {
        // There are more pages to narrate
        setCurrentPageNumber(nextPage);
        
        // Set a short delay before starting the next page
        setTimeout(() => {
          // Change the page in the PDF viewer
          useStore.getState().setPageNum(nextPage);
          
          // Request summary for the next page
          requestPageSummary(nextPage);
        }, 1500);
      } else {
        // No more pages to narrate
        setIsNarrating(false);
        setCurrentPageNumber(0);
      }
    }
  }, [isNarrating, isProcessingPage, currentAudio, currentPageNumber, pdfState.pageCount]);

  return (
    <div className="pdf-narrator">
      <div className="narrator-controls">
        {!isNarrating ? (
          <button 
            className="button primary" 
            onClick={startNarration}
            disabled={isProcessingPage}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            Start Narration
          </button>
        ) : (
          <button 
            className="button danger" 
            onClick={stopNarration}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            </svg>
            Stop Narration
          </button>
        )}
        
        {currentAudio && (
          isPaused ? (
            <button 
              className="button"
              onClick={resumeAudio}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              Resume
            </button>
          ) : (
            <button 
              className="button"
              onClick={pauseAudio}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="6" y="4" width="4" height="16"></rect>
                <rect x="14" y="4" width="4" height="16"></rect>
              </svg>
              Pause
            </button>
          )
        )}
      </div>
      
      {isProcessingPage && (
        <div className="narrator-status">
          <div className="loading-indicator"></div>
          <p>Processing page {currentPageNumber}...</p>
        </div>
      )}
      
      {isNarrating && !isProcessingPage && currentAudio && (
        <div className="narrator-status">
          <p>Narrating page {currentPageNumber} of {pdfState.pageCount}</p>
        </div>
      )}
    </div>
  );
};

export default PDFNarrator; 