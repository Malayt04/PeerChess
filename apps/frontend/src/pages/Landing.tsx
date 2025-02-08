import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { CastleIcon as ChessKnight, Video, PianoIcon as ChessPawn } from "lucide-react"

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#312E2B] text-white flex flex-col">
      <header className="container mx-auto py-6 flex justify-between items-center">
        <div className="flex items-center space-x-2">
          <ChessKnight size={32} />
          <span className="text-2xl font-bold">PeerChess</span>
        </div>
        <nav>
          <ul className="flex space-x-6">
            <li>
              <Link to="#" className="hover:text-yellow-400 transition-colors">
                Home
              </Link>
            </li>
            <li>
              <Link to="#" className="hover:text-yellow-400 transition-colors">
                How It Works
              </Link>
            </li>
            <li>
              <Link to="#" className="hover:text-yellow-400 transition-colors">
                About
              </Link>
            </li>
          </ul>
        </nav>
      </header>

      <main className="flex-grow container mx-auto flex flex-col items-center justify-center text-center px-4">
        <h1 className="text-5xl md:text-7xl font-extrabold mb-6 leading-tight">
          Checkmate Loneliness:
          <br />
          <span className="text-yellow-400">Face-to-Face Chess</span> with Peers!
        </h1>
        <p className="text-xl md:text-2xl mb-8 max-w-2xl">
          Experience the thrill of chess like never before. Play and chat with opponents worldwide in real-time video
          calls.
        </p>

        <Link to="/game">
        <Button
          size="lg"
          className="bg-yellow-400 text-[#312E2B] hover:bg-yellow-500 transition-colors text-lg px-8 py-4 rounded-full"
        >
          Start Playing Now
        </Button>
        </Link>

        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="flex flex-col items-center">
            <ChessKnight size={48} className="mb-4" />
            <h3 className="text-xl font-semibold mb-2">Peer Matches</h3>
            <p>Connect with chess enthusiasts from around the globe</p>
          </div>
          <div className="flex flex-col items-center">
            <Video size={48} className="mb-4" />
            <h3 className="text-xl font-semibold mb-2">Video Calls</h3>
            <p>See your opponent's reactions in real-time</p>
          </div>
          <div className="flex flex-col items-center">
            <ChessPawn size={48} className="mb-4" />
            <h3 className="text-xl font-semibold mb-2">Skill Levels</h3>
            <p>Play with peers at your skill level and improve together</p>
          </div>
        </div>
      </main>

      <footer className="container mx-auto py-6 text-center border-t border-gray-700">
        <div className="flex justify-center space-x-6 mb-4">
          <Link to="#" className="hover:text-yellow-400 transition-colors">
            Terms of Service
          </Link>
          <Link to="#" className="hover:text-yellow-400 transition-colors">
            Privacy Policy
          </Link>
          <Link to="#" className="hover:text-yellow-400 transition-colors">
            Contact Us
          </Link>
        </div>
        <p>&copy; 2025 PeerChess. All rights reserved.</p>
      </footer>
    </div>
  )
}

