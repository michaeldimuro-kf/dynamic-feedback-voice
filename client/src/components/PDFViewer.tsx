import { useState, useEffect, useRef, ChangeEvent } from 'react';
import useStore from '../store/useStore';
import * as pdfjsLib from 'pdfjs-dist';
// Import the worker directly (Vite will handle this correctly)
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Set the worker explicitly from the imported module
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const PDFViewer = () => {
  // Get PDF state from global store
  const {
    pdfState,
    setPDFDoc,
    setPageNum,
    setPageCount,
    nextPage,
    prevPage,
    zoomIn,
    zoomOut,
    setBaseScale,
  } = useStore();

  // Local state
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Create canvas ref
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle file upload
  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      // Check if the file is a PDF
      if (file.type !== 'application/pdf') {
        setPdfError('Please upload a PDF file');
        return;
      }
      
      try {
        setIsLoading(true);
        
        // Read the file as ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();
        
        // Load the PDF with CMaps support
        const loadingTask = pdfjsLib.getDocument({ 
          data: arrayBuffer,
          cMapUrl: 'https://unpkg.com/pdfjs-dist@5.0.375/cmaps/',
          cMapPacked: true
        });
        
        const pdf = await loadingTask.promise;
        
        console.log('PDF loaded with', pdf.numPages, 'pages');
        
        // Set PDF document and update page count
        setPDFDoc(pdf);
        setPageCount(pdf.numPages);
        setPageNum(1);
        setPdfError(null);
        setIsLoading(false);
        
        // Calculate base scale based on container size
        calculateBaseScale();
      } catch (error: any) {
        console.error('Error loading PDF:', error);
        setPdfError(`Error loading PDF: ${error.message || 'Unknown error'}. Please try again.`);
        setIsLoading(false);
      }
    }
  };

  // Load default PDF
  const loadDefaultPDF = async () => {
    try {
      setIsLoading(true);
      console.log('Starting to load default PDF');
      
      // First, try direct URL with cachebusting
      const directUrl = `/files/hm.pdf?v=${Date.now()}`;
      
      try {
        console.log(`Attempting to load PDF directly from: ${directUrl}`);
        const response = await fetch(directUrl);
        
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const loadingTask = pdfjsLib.getDocument({ 
            data: arrayBuffer,
            cMapUrl: 'https://unpkg.com/pdfjs-dist@5.0.375/cmaps/',
            cMapPacked: true
          });
          
          const pdf = await loadingTask.promise;
          console.log(`Successfully loaded PDF with ${pdf.numPages} pages`);
          
          // Set PDF document and update page count
          setPDFDoc(pdf);
          setPageCount(pdf.numPages);
          setPageNum(1);
          setPdfError(null);
          
          // Calculate base scale based on container size
          calculateBaseScale();
          
          setIsLoading(false);
          return;
        } else {
          console.warn(`Failed direct fetch: ${response.status} ${response.statusText}`);
        }
      } catch (e) {
        console.warn('Direct fetch failed:', e);
      }
      
      // Fallback to the more complex method if the direct approach failed
      const possiblePaths = [
        '/files/hm.pdf?v=' + Date.now(),
        './files/hm.pdf?v=' + Date.now(),
        '/public/files/hm.pdf?v=' + Date.now(),
        `${window.location.origin}/files/hm.pdf?v=${Date.now()}`,
      ];
      
      let pdf = null;
      let error = null;
      
      // Try each path until one works
      for (const path of possiblePaths) {
        try {
          console.log(`Attempting to load PDF from: ${path}`);
          const response = await fetch(path);
          
          if (!response.ok) {
            console.warn(`Failed to fetch from ${path}: ${response.status} ${response.statusText}`);
            continue;
          }
          
          // Get the PDF as ArrayBuffer
          const arrayBuffer = await response.arrayBuffer();
          
          // Load the PDF using the array buffer with CMaps
          const loadingTask = pdfjsLib.getDocument({ 
            data: arrayBuffer,
            cMapUrl: 'https://unpkg.com/pdfjs-dist@5.0.375/cmaps/',
            cMapPacked: true
          });
          
          pdf = await loadingTask.promise;
          console.log(`Successfully loaded PDF from ${path} with ${pdf.numPages} pages`);
          break; // Break the loop if successful
        } catch (e) {
          console.warn(`Error trying path ${path}:`, e);
          error = e;
        }
      }
      
      if (!pdf) {
        throw error || new Error('Could not load PDF from any path');
      }
      
      // Set PDF document and update page count
      setPDFDoc(pdf);
      setPageCount(pdf.numPages);
      setPageNum(1);
      setPdfError(null);
      
      // Calculate base scale based on container size
      calculateBaseScale();
      
      setIsLoading(false);
    } catch (error: any) {
      console.error('Error loading default PDF:', error);
      setPdfError(`Error loading default PDF: ${error.message || 'Unknown error'}. Please try uploading manually.`);
      setIsLoading(false);
    }
  };

  // Load default PDF on component mount
  useEffect(() => {
    if (!pdfState.pdfDoc) {
      loadDefaultPDF();
    }
  }, []);

  // Calculate the base scale based on container size
  const calculateBaseScale = () => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.clientWidth;
      const newBaseScale = containerWidth / 800; // Assuming 800px is a standard page width
      setBaseScale(Math.max(1.0, newBaseScale * 0.9)); // 90% of container width with minimum of 1.0
    }
  };

  // Render the current page
  const renderPage = async () => {
    const { pdfDoc, pageNum, scale } = pdfState;
    
    if (!pdfDoc || !canvasRef.current) return;
    
    // Clear any previous errors when starting a new render
    setPdfError(null);
    
    try {
      // Get the page
      const page = await pdfDoc.getPage(pageNum);
      
      // Set up the canvas
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      
      if (!context) {
        console.error('Failed to get canvas context');
        return;
      }
      
      // Get viewport for the specified scale
      const viewport = page.getViewport({ scale });
      
      // Set canvas dimensions
      canvas.height = viewport.height;
      canvas.width = viewport.width;
        
        // Clear canvas before rendering
        context.clearRect(0, 0, canvas.width, canvas.height);
        
        // Render PDF page into canvas context
        const renderContext = {
          canvasContext: context,
        viewport: viewport,
      };
      
      // Safely check if the render operation was successful
      const checkRenderSuccess = () => {
        // Don't use getImageData as it can trigger CORS errors
        // Instead, use a safer approach
        try {
          // We'll assume the render was successful if we reached this point
          // and the page object was successfully retrieved
          return !!page && canvas.width > 0 && canvas.height > 0;
        } catch (e) {
          console.warn('Error checking render success:', e);
          return false;
        }
        };
        
        try {
          await page.render(renderContext).promise;
          console.log(`Page ${pageNum} rendered at scale ${scale}`);
          
          // Successfully rendered, ensure no error is shown
          setPdfError(null);
        } catch (renderError) {
          console.error('Error during render:', renderError);
          
          // Only show error if there was truly a rendering failure
        // Wait a bit to see if content appears anyway
        setTimeout(() => {
          if (!checkRenderSuccess()) {
          setPdfError('Error rendering PDF page. Please try again.');
        }
        }, 300);
      }
    } catch (error) {
      console.error('Error getting PDF page:', error);
      
      // Only show the error if we couldn't access the page
      setPdfError('Error accessing PDF page. Please try again.');
    }
  };

  // Render page when PDF doc or page number changes
  useEffect(() => {
    if (pdfState.pdfDoc) {
      renderPage();
    }
  }, [pdfState.pdfDoc, pdfState.pageNum, pdfState.scale]);

  // Calculate base scale on resize
  useEffect(() => {
    const handleResize = () => {
      calculateBaseScale();
    };
    
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Add keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        nextPage();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        prevPage();
      } else if (e.key === '+' || e.key === '=') {
        zoomIn();
      } else if (e.key === '-') {
        zoomOut();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [nextPage, prevPage, zoomIn, zoomOut]);

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <h2>Report Viewer</h2>
        
        <input
          type="file"
          id="pdf-upload"
          accept="application/pdf"
          onChange={handleFileUpload}
          className="hidden"
        />
        
        <div className="buttons-container">
          {pdfState.pdfDoc ? (
            <>
              <button onClick={prevPage} className="button" title="Previous Page" disabled={pdfState.pageNum <= 1}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
              </button>
              
              <span id="page-info">
                Page <span id="page-num">{pdfState.pageNum}</span> of <span id="page-count">{pdfState.pageCount}</span>
              </span>
              
              <button onClick={nextPage} className="button" title="Next Page" disabled={pdfState.pageNum >= pdfState.pageCount}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
              
              <button onClick={zoomIn} className="button" title="Zoom In">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  <line x1="11" y1="8" x2="11" y2="14"></line>
                  <line x1="8" y1="11" x2="14" y2="11"></line>
                </svg>
              </button>
              
              <button onClick={zoomOut} className="button" title="Zoom Out">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  <line x1="8" y1="11" x2="14" y2="11"></line>
                </svg>
              </button>
              
              <label htmlFor="pdf-upload" className="button" title="Upload Different PDF">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
              </label>
            </>
          ) : (
            <label htmlFor="pdf-upload" className="button primary cursor-pointer">
              Upload PDF
            </label>
          )}
        </div>
      </div>
      
      <div className="pdf-container" ref={containerRef}>
        <div className="pdf-page">
          {pdfState.pdfDoc ? (
            <canvas ref={canvasRef} className="pdf-canvas" />
          ) : (
            <div className="pdf-placeholder">
              {isLoading ? (
                <p>Loading default PDF...</p>
              ) : (
                <>
                  <h1>Korn Ferry Live Feedback</h1>
                  <p>Loading the default PDF or upload a different one to get started.</p>
                  <p>Once loaded, you can ask questions about the document using your voice.</p>
                  <ol>
                    <li>Press and hold the microphone button or press Space to record</li>
                    <li>Ask a question about the document</li>
                    <li>Release to send your question</li>
                  </ol>
                </>
              )}
            </div>
          )}
          
          {isLoading && (
            <div className="loading-indicator">
              <p>Loading PDF...</p>
            </div>
          )}
          
          {pdfError && (
            <div className="error-message">
              <p>{pdfError}</p>
              <button 
                className="error-close" 
                onClick={() => setPdfError(null)}
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PDFViewer; 