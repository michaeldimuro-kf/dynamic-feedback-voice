import React from 'react';

interface MicrophonePermissionsModalProps {
  onClose: () => void;
}

const MicrophonePermissionsModal: React.FC<MicrophonePermissionsModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <h2 className="text-xl font-bold mb-4">Microphone Access Required</h2>
        
        <p className="mb-4">
          To use the voice chat feature, please allow access to your microphone in your browser settings.
        </p>
        
        <div className="mb-4">
          <h3 className="font-semibold mb-2">How to enable microphone access:</h3>
          <ol className="list-decimal list-inside space-y-1">
            <li>Click on the padlock or info icon in your browser's address bar</li>
            <li>Find "Microphone" permissions in the site settings</li>
            <li>Change the setting to "Allow"</li>
            <li>Refresh the page</li>
          </ol>
        </div>
        
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default MicrophonePermissionsModal; 