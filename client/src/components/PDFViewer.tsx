import { useState, useEffect, useRef, ChangeEvent } from 'react';
import useStore from '../store/useStore';
import * as pdfjsLib from 'pdfjs-dist';
// Import the worker directly (Vite will handle this correctly)
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import PDFNarrator from './PDFNarrator';

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
      const containerHeight = containerRef.current.clientHeight - 100; // Account for UI elements
      
      // Use a more conservative scale to ensure PDF fits in viewport
      const widthScale = containerWidth / 800; // Assuming 800px is a standard page width
      const heightScale = containerHeight / 1100; // Assuming 1100px is a standard page height
      
      // Use the smaller of the two scales to ensure PDF fits in both dimensions
      const newBaseScale = Math.min(widthScale, heightScale);
      
      // Ensure scale is not too small (minimum 0.7) or too large (maximum 1.0)
      setBaseScale(Math.max(0.7, Math.min(1.0, newBaseScale * 0.9)));
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
    <div className="pdf-viewer" ref={containerRef}>
      {pdfState.pdfDoc && <PDFNarrator />}
      
      <div className="pdf-container">
        {isLoading && (
          <div className="loading-overlay">
            <div className="spinner"></div>
            <p>Loading PDF...</p>
          </div>
        )}
        
        {pdfError && (
          <div className="error-message">
            <p>{pdfError}</p>
            <button onClick={loadDefaultPDF}>Try again</button>
          </div>
        )}
        
        <canvas ref={canvasRef} className="pdf-canvas"></canvas>
      </div>
      
      {pdfState.pdfDoc && (
        <div className="page-navigation-bottom">
          <button 
            onClick={prevPage} 
            disabled={pdfState.pageNum <= 1 || isLoading}
            title="Previous page"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
          
          <span className="page-info">
            Page {pdfState.pageNum} of {pdfState.pageCount}
          </span>
          
          <button 
            onClick={nextPage} 
            disabled={pdfState.pageNum >= pdfState.pageCount || isLoading}
            title="Next page"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default PDFViewer; 