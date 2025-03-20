import { create } from 'zustand';

export interface Message {
  id: string;
  text: string;
  type: 'user' | 'bot';
  timestamp: Date;
}

export interface PDFState {
  pdfDoc: any | null;
  pageNum: number;
  pageCount: number;
  scale: number;
  zoomFactor: number;
  baseScale: number;
}

interface AudioState {
  isRecording: boolean;
  isProcessing: boolean;
  hasPermission: boolean | null;
}

interface AppState {
  // Messages
  messages: Message[];
  addMessage: (text: string, type: 'user' | 'bot') => void;
  clearMessages: () => void;

  // PDF State
  pdfState: PDFState;
  setPDFDoc: (pdfDoc: any) => void;
  setPageNum: (pageNum: number) => void;
  setPageCount: (pageCount: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  setScale: (scale: number) => void;
  setZoomFactor: (zoomFactor: number) => void;
  setBaseScale: (baseScale: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;

  // Audio State
  audioState: AudioState;
  setIsRecording: (isRecording: boolean) => void;
  setIsProcessing: (isProcessing: boolean) => void;
  setHasPermission: (hasPermission: boolean) => void;

  // Connection state
  isConnected: boolean;
  setIsConnected: (isConnected: boolean) => void;
}

const useStore = create<AppState>((set) => ({
  // Messages
  messages: [{
    id: '1',
    text: 'Welcome to Korn Ferry Live Feedback! Upload a PDF document and start asking questions.',
    type: 'bot',
    timestamp: new Date()
  }],
  addMessage: (text: string, type: 'user' | 'bot') => 
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: Date.now().toString(),
          text,
          type,
          timestamp: new Date()
        }
      ]
    })),
  clearMessages: () => set({ messages: [] }),

  // PDF State
  pdfState: {
    pdfDoc: null,
    pageNum: 1,
    pageCount: 0,
    scale: 1.5,
    zoomFactor: 1.0,
    baseScale: 1.0
  },
  setPDFDoc: (pdfDoc) => set((state) => ({ pdfState: { ...state.pdfState, pdfDoc } })),
  setPageNum: (pageNum) => set((state) => ({ pdfState: { ...state.pdfState, pageNum } })),
  setPageCount: (pageCount) => set((state) => ({ pdfState: { ...state.pdfState, pageCount } })),
  nextPage: () => set((state) => ({ 
    pdfState: { 
      ...state.pdfState, 
      pageNum: state.pdfState.pageNum < state.pdfState.pageCount 
        ? state.pdfState.pageNum + 1 
        : state.pdfState.pageNum 
    } 
  })),
  prevPage: () => set((state) => ({ 
    pdfState: { 
      ...state.pdfState, 
      pageNum: state.pdfState.pageNum > 1 
        ? state.pdfState.pageNum - 1 
        : state.pdfState.pageNum 
    } 
  })),
  setScale: (scale) => set((state) => ({ pdfState: { ...state.pdfState, scale } })),
  setZoomFactor: (zoomFactor) => set((state) => ({ pdfState: { ...state.pdfState, zoomFactor } })),
  setBaseScale: (baseScale) => set((state) => ({ pdfState: { ...state.pdfState, baseScale } })),
  zoomIn: () => set((state) => {
    const newZoomFactor = Math.min(state.pdfState.zoomFactor * 1.2, 3.0);
    const newScale = state.pdfState.baseScale * newZoomFactor;
    return { pdfState: { ...state.pdfState, zoomFactor: newZoomFactor, scale: newScale } };
  }),
  zoomOut: () => set((state) => {
    const newZoomFactor = Math.max(state.pdfState.zoomFactor / 1.2, 0.5);
    const newScale = state.pdfState.baseScale * newZoomFactor;
    return { pdfState: { ...state.pdfState, zoomFactor: newZoomFactor, scale: newScale } };
  }),

  // Audio State
  audioState: {
    isRecording: false,
    isProcessing: false,
    hasPermission: null
  },
  setIsRecording: (isRecording) => set((state) => ({ 
    audioState: { ...state.audioState, isRecording } 
  })),
  setIsProcessing: (isProcessing) => set((state) => ({ 
    audioState: { ...state.audioState, isProcessing } 
  })),
  setHasPermission: (hasPermission) => set((state) => ({ 
    audioState: { ...state.audioState, hasPermission } 
  })),

  // Connection state
  isConnected: false,
  setIsConnected: (isConnected) => set({ isConnected }),
}));

export default useStore; 