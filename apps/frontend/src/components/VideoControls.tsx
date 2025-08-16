import { Button } from '@/components/ui/button';
import { PhoneOff, Mic, MicOff, Video, VideoOff } from 'lucide-react';

interface VideoControlsProps {
  isVideoEnabled: boolean;
  isAudioEnabled: boolean;
  isMediaConnected: boolean;
  onToggleVideo: () => void;
  onToggleAudio: () => void;
  onEndCall: () => void;
}

export function VideoControls({
  isVideoEnabled,
  isAudioEnabled,
  isMediaConnected,
  onToggleVideo,
  onToggleAudio,
  onEndCall
}: VideoControlsProps) {
  return (
    <div className="flex items-center gap-4 p-4 bg-[#272522] rounded-lg">
      <Button
        onClick={onToggleVideo}
        variant="ghost"
        size="icon"
        className={`rounded-full ${isVideoEnabled ? 'bg-blue-500 hover:bg-blue-600' : 'bg-gray-500 hover:bg-gray-600'} text-white`}
      >
        {isVideoEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
      </Button>
      
      <Button
        onClick={onToggleAudio}
        variant="ghost"
        size="icon"
        className={`rounded-full ${isAudioEnabled ? 'bg-blue-500 hover:bg-blue-600' : 'bg-gray-500 hover:bg-gray-600'} text-white`}
      >
        {isAudioEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
      </Button>
      
      <Button
        onClick={onEndCall}
        variant="ghost"
        size="icon"
        className="rounded-full bg-red-500 hover:bg-red-600 text-white"
      >
        <PhoneOff className="h-5 w-5" />
      </Button>
      
      {!isMediaConnected && (
        <div className="flex items-center text-amber-500">
          <div className="w-3 h-3 rounded-full bg-amber-500 mr-2 animate-pulse"></div>
          <span>Connecting...</span>
        </div>
      )}
    </div>
  );
}