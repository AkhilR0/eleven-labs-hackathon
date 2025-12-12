"use client"
import { useState, useEffect, useRef } from "react";
import { SignUpButton } from "@clerk/nextjs";
import {
  IconPhone,
  IconArrowRight,
  IconInfinity,
  IconHeartHandshake,
  IconInfoCircle
} from "@tabler/icons-react";

export default function LandingPage() {
  // State to simulate the bi-directional nature (toggling between Past and Future)
  const [isFutureMode, setIsFutureMode] = useState(true);
  
  // Ref for the "Why we made this" section
  const makersNoteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setIsFutureMode((prev) => !prev);
    }, 2500); // Switch every 4 seconds
    return () => clearInterval(interval);
  }, []);

  const scrollToMakers = () => {
    makersNoteRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white overflow-hidden selection:bg-indigo-500/30 font-sans">
      {/* Background Gradients - Deep and mysterious */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className={`absolute top-[-10%] left-[-10%] w-[600px] h-[600px] rounded-full blur-[120px] transition-colors duration-1000 ${isFutureMode ? 'bg-indigo-900/20' : 'bg-amber-900/10'}`} />
        <div className={`absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full blur-[120px] transition-colors duration-1000 ${isFutureMode ? 'bg-cyan-900/10' : 'bg-rose-900/10'}`} />
      </div>

      <div className="relative z-10 flex flex-col min-h-screen">
     
        {/* Hero Section */}
        <main className="flex-grow flex flex-col items-center justify-center px-4 text-center py-20">
          
          {/* Dynamic Incoming Call Simulation */}
          <div className="mb-10 animate-in fade-in slide-in-from-bottom-4 duration-1000">
            <div className="relative bg-gray-900/60 backdrop-blur-xl border border-white/5 rounded-[2.5rem] p-6 w-80 shadow-2xl mx-auto ring-1 ring-white/5 transition-all duration-500">
              
              {/* Dynamic Content Switching */}
              <div className="flex flex-col items-center gap-5 transition-all duration-500">
                <div className={`w-24 h-24 rounded-full flex items-center justify-center text-4xl border-4 shadow-inner transition-all duration-500 ${isFutureMode ? 'bg-slate-800 border-slate-700' : 'bg-stone-800 border-stone-700'}`}>
                  {isFutureMode ? "👴" : "🧒"}
                </div>
                
                <div className="space-y-1 min-h-[60px]">
                  <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold animate-pulse">
                    Incoming Call...
                  </p>
                  <h3 className="text-2xl font-medium text-white transition-all duration-300">
                    {isFutureMode ? "You (Year 2054)" : "You (Year 2010)"}
                  </h3>
                  <p className="text-xs text-gray-500">
                    {isFutureMode ? "Context: Career & Legacy" : "Context: Dreams & Fears"}
                  </p>
                </div>

                <div className="flex gap-6 w-full justify-center pt-2">
                  <div className="h-14 w-14 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center border border-red-500/20">
                    <IconPhone className="w-6 h-6 rotate-[135deg]" stroke={2} />
                  </div>
                  <div className={`h-14 w-14 rounded-full text-white flex items-center justify-center shadow-lg animate-pulse ${isFutureMode ? 'bg-indigo-600 shadow-indigo-500/20' : 'bg-rose-600 shadow-rose-500/20'}`}>
                    <IconPhone className="w-6 h-6" stroke={2} />
                  </div>
                </div>
              </div>
            </div>
            <p className="mt-4 text-xs text-gray-500 font-mono">
              *AI clones your voice & personality based on your goals
            </p>
          </div>

          {/* Main Copy */}
          <h1 className="text-5xl md:text-7xl font-bold tracking-tighter max-w-5xl mx-auto mb-6 text-white">
            Travel through time.<br />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-rose-400 via-white to-indigo-400">
              In both directions.
            </span>
          </h1>

          <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            More immersive than <em>FutureMe</em>. Don`t just read an email—<strong className="text-white">talk</strong> to your past self to heal, or your future self to grow. Validated by research to build self-compassion and drive motivation.
          </p>

          {/* Buttons Container */}
          <div className="flex flex-col sm:flex-row items-center gap-4">
            
            {/* Primary CTA */}
            <SignUpButton mode="redirect" forceRedirectUrl="/onboarding">
              <button className="group relative inline-flex items-center justify-center gap-3 px-8 py-4 bg-white text-black rounded-full font-semibold text-lg hover:bg-gray-100 transition-all active:scale-95 shadow-[0_0_20px_rgba(255,255,255,0.2)] hover:shadow-[0_0_35px_rgba(255,255,255,0.4)]">
                Start The Conversation
                <IconArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" stroke={2} />
              </button>
            </SignUpButton>

            {/* Secondary CTA - Scroll to info */}
            <button 
              onClick={scrollToMakers}
              className="px-8 py-4 rounded-full font-medium text-lg border border-white/20 text-white hover:bg-white/5 transition-all active:scale-95 flex items-center gap-2"
            >
              <IconInfoCircle className="w-5 h-5 opacity-70" />
              Why we made this
            </button>
          </div>

          {/* Benefits Grid / Explanation */}
          <div className="mt-20 grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl w-full px-4">
            
            {/* Left: Past - Made to look less like a button (cursor-default, no hover border change) */}
            <div className="p-6 rounded-3xl bg-white/5 border border-white/10 text-left cursor-default">
              <div className="w-10 h-10 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mb-4">
                <IconHeartHandshake className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-semibold mb-2 text-rose-100">Talk to the Past</h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                Connect with your younger self. Processing where you`ve been fosters <strong>self-compassion</strong> and helps you understand your growth.
              </p>
            </div>

            {/* Right: Future - Made to look less like a button */}
            <div className="p-6 rounded-3xl bg-white/5 border border-white/10 text-left cursor-default">
              <div className="w-10 h-10 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center mb-4">
                <IconInfinity className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-semibold mb-2 text-indigo-100">Talk to the Future</h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                Impatient? Flip the switch. Roleplay with your future self to clarify goals and boost <strong>long-term decision making</strong>.
              </p>
            </div>
          </div>

          {/* Social Proof / Tech Badges */}
          <div className="mt-16 pt-8 flex flex-col items-center gap-6 opacity-60">
            <div className="flex items-center gap-4 text-sm text-gray-500">
               <span>Psychology Backed</span>
               <span className="w-1 h-1 bg-gray-700 rounded-full"></span>
               <span>Powered by ElevenLabs</span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-gray-600">
              <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">Conversational AI Agents</span>
              <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">Voice Cloning</span>
              <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">Scribe v2 Realtime STT</span>
              <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">Text to Speech</span>
            </div>
          </div>

          {/* --- NEW SECTION: Note from the makers --- */}
          <div ref={makersNoteRef} className="mt-24 max-w-3xl mx-auto px-6 text-left border-t border-white/10 pt-10 scroll-mt-10">
            <h4 className="text-white font-semibold mb-6 text-lg">Why we built this</h4>
            <div className="space-y-4 text-gray-400 text-sm leading-relaxed">
              <p>
                In high school, I used a website called FutureMe where you could send an email to yourself in the future. It was emotional and genuinely beneficial, just seeing how much I`d grown over the years.
              </p>
              <p>
                This takes that experience and makes it way more immersive. Instead of reading a message, you actually <strong>talk</strong> to your past self. The app clones your voice and uses your current goals, fears, and work as context. Then you schedule a call, and your past self calls you in the future. Imagine talking to yourself from when you were younger, or even as a kid. Your voice would sound so different. Your whole personality would be different.
              </p>
              <p>
                But if you`re impatient, you can flip it: get a roleplay of your <strong>future</strong> self to call you right now, helping you work toward those same goals you wrote about.
              </p>
              <p className="italic text-gray-300">
                Basically, you can literally travel through time in both directions.
              </p>
              <p>
                And this isn`t just a gimmick. There`s actually a lot of research from therapists and studies showing this kind of thing is genuinely beneficial. Connecting with your past self helps with self-compassion and processing where you`ve been. Connecting with your future self helps with motivation and long-term decision making. Both directions, uniquely useful.
              </p>
            </div>
          </div>
          {/* ----------------------------------------- */}

        </main>

        {/* Footer */}
        <footer className="py-8 text-center text-sm text-gray-800">
          <p>© {new Date().getFullYear()} Built with ❤️ by Akhil and Alex at the ElevenLabs WW Hackathon.</p>
        </footer>
      </div>
    </div>
  );
}