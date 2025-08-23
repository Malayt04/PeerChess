import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export const Landing = () => {
  const navigate = useNavigate();
  return (
    <main className="relative h-screen w-full overflow-hidden">
      <video 
        autoPlay 
        muted 
        loop 
        className="absolute top-0 left-0 w-full h-full object-cover -z-20"
      >
        <source src="/landing-video.mp4" type="video/mp4" />
        Your browser does not support the video tag.
      </video>
      <div className="absolute top-0 left-0 w-full h-full bg-black bg-opacity-50 -z-10"></div>
      
      <div className="h-full flex flex-col justify-center items-center text-white text-center px-4">
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-4" style={{ textShadow: '2px 2px 8px rgba(0,0,0,0.6)' }}>
          Welcome to PeerChess
        </h1>
        <p className="text-lg md:text-xl max-w-2xl mx-auto mb-8" style={{ textShadow: '1px 1px 4px rgba(0,0,0,0.5)' }}>
          The ultimate online chess experience with a personal touch. Challenge opponents, connect via video, and prove your mastery on the board.
        </p>
        <Button
          size="lg"
          className="mt-8 text-lg px-8 py-6 rounded-full font-bold transition-all duration-300 ease-in-out hover:scale-105 hover:bg-gray-700"
          onClick={() => {
            navigate("/game");
          }}
        >
          Find Game
        </Button>
      </div>
    </main>
  );
};

export default Landing;

