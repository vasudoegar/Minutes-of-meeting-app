import React, { useState, useRef, useEffect } from 'react';
import { 
  Mic, 
  Square, 
  Upload, 
  FileText, 
  Download, 
  Copy, 
  Check, 
  RefreshCcw, 
  Clock, 
  Languages,
  AlertCircle,
  History,
  Settings,
  ChevronRight,
  TrendingUp,
  ListTodo
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import { jsPDF } from 'jspdf';
import { cn } from './lib/utils';

// Constants
const MODEL_NAME = "gemini-3-flash-preview";

export default function App() {
  // State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'capture' | 'history'>('capture');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [meetingName, setMeetingName] = useState("New Meeting");
  const [isEditingName, setIsEditingName] = useState(false);
  
  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Initialize Gemini
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Audio Visualization
  const startCanvasAnimation = (stream: MediaStream) => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 128;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!canvasRef.current) return;
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;

      const width = canvasRef.current.width;
      const height = canvasRef.current.height;

      animationFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, width, height);
      
      const barWidth = (width / bufferLength) * 2;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * height;
        ctx.fillStyle = '#6366f1'; // Indigo color
        ctx.fillRect(x, height - barHeight, barWidth, barHeight);
        x += barWidth + 2;
      }
    };

    draw();
  };

  const stopCanvasAnimation = () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  // Actions
  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      chunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stopCanvasAnimation();
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      startCanvasAnimation(stream);
    } catch (err) {
      setError("Microphone permission denied.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAudioBlob(file);
      setAudioUrl(URL.createObjectURL(file));
      setError(null);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const processAudio = async () => {
    if (!audioBlob) return;
    setIsProcessing(true);
    setError(null);
    setResult(null);

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onloadend = () => {
          const base64String = (reader.result as string).split(',')[1];
          resolve(base64String);
        };
      });
      reader.readAsDataURL(audioBlob);
      const base64Data = await base64Promise;

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [
          {
            parts: [
              {
                text: "You are an expert meeting minute taker. The provided audio contains a conversation that may switch between English and Hindi. \n\n" +
                      "Task:\n" +
                      "1. TRANSCRIBE the entire meeting accurately in English. Translate any Hindi spoken parts into English directly within the transcript.\n" +
                      "2. SUMMARIZE the meeting with clear sections: MEETING INFO, KEY POINTS, DECISIONS, and ACTION ITEMS.\n\n" +
                      "Format the final output cleanly in Markdown. Use hierarchical headers and bullet points."
              },
              {
                inlineData: {
                  mimeType: audioBlob.type || 'audio/webm',
                  data: base64Data
                }
              }
            ]
          }
        ]
      });

      if (response.text) {
        setResult(response.text);
      } else {
        throw new Error("No transcription result received.");
      }
    } catch (err: any) {
      setError(err.message || "Failed to process audio.");
    } finally {
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setRecordingTime(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRecording]);

  const exportPDF = () => {
    if (!result) return;
    const doc = new jsPDF();
    const margin = 10;
    const pageWidth = doc.internal.pageSize.getWidth();
    const textLines = doc.splitTextToSize(result, pageWidth - margin * 2);
    doc.setFontSize(16);
    doc.text(`${meetingName} - Vani Notes`, margin, 20);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, margin, 30);
    doc.setFontSize(11);
    let y = 40;
    textLines.forEach((line: string) => {
      if (y > 280) { doc.addPage(); y = 20; }
      doc.text(line, margin, y);
      y += 7;
    });
    doc.save('meeting-minutes.pdf');
  };

  const exportText = () => {
    if (!result) return;
    const element = document.createElement("a");
    const file = new Blob([result], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = `${meetingName.replace(/\s+/g, '-').toLowerCase()}-minutes.txt`;
    document.body.appendChild(element);
    element.click();
  };

  const copyToClipboard = () => {
    if (!result) return;
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col lg:flex-row h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
      {/* Mobile Top Header */}
      <div className="lg:hidden bg-white border-b border-slate-200 px-4 h-16 flex items-center justify-between shrink-0 sticky top-0 z-[60]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Languages className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight">Vani Notes</span>
        </div>
        <button 
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          {isMobileMenuOpen ? <Square className="w-6 h-6 rotate-45 text-slate-600" /> : <div className="space-y-1.5"><div className="w-6 h-0.5 bg-slate-600"></div><div className="w-6 h-0.5 bg-slate-600"></div><div className="w-6 h-0.5 bg-slate-600"></div></div>}
        </button>
      </div>

      {/* Sidebar Navigation */}
      <aside className={cn(
        "bg-white border-r border-slate-200 flex flex-col shrink-0 transition-all duration-300 ease-in-out z-50",
        "fixed inset-y-0 left-0 w-64 lg:relative lg:translate-x-0 lg:flex",
        isMobileMenuOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
      )}>
        <div className="p-8 pb-4">
          <div className="hidden lg:flex items-center gap-2 mb-10">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Languages className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight">Vani Notes</span>
          </div>
          
          <nav className="space-y-6">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Workspace</p>
              <ul className="space-y-1">
                <li>
                  <button 
                    onClick={() => { setActiveTab('capture'); setIsMobileMenuOpen(false); }}
                    className={cn(
                      "w-full flex items-center gap-3 p-2 rounded-md transition-all text-sm font-medium",
                      activeTab === 'capture' ? "text-indigo-600 bg-indigo-50" : "text-slate-600 hover:bg-slate-50"
                    )}
                  >
                    <Mic className="w-4 h-4" /> Live Capture
                  </button>
                </li>
                <li>
                  <label className="w-full flex items-center gap-3 p-2 rounded-md transition-all text-sm font-medium text-slate-600 hover:bg-slate-50 cursor-pointer">
                    <Upload className="w-4 h-4" /> Upload Audio
                    <input type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
                  </label>
                </li>
                <li>
                  <button 
                    onClick={() => { setActiveTab('history'); setIsMobileMenuOpen(false); }}
                    className={cn(
                      "w-full flex items-center gap-3 p-2 rounded-md transition-all text-sm font-medium",
                      activeTab === 'history' ? "text-indigo-600 bg-indigo-50" : "text-slate-600 hover:bg-slate-50"
                    )}
                  >
                    <History className="w-4 h-4" /> Meeting Logs
                  </button>
                </li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Pinned Notes</p>
              <ul className="space-y-2 text-slate-600">
                <li className="flex items-center justify-between group cursor-pointer hover:text-indigo-600 p-2 -mx-2 rounded-md">
                  <span className="truncate text-sm">Product Q3 Sync</span>
                  <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                </li>
                <li className="flex items-center justify-between group cursor-pointer hover:text-indigo-600 p-2 -mx-2 rounded-md">
                  <span className="truncate text-sm">Client Pitch - Mumbai</span>
                  <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                </li>
              </ul>
            </div>
          </nav>
        </div>

        <div className="mt-auto p-8 border-t border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-sm">
              VN
            </div>
            <div>
              <p className="text-sm font-semibold">Workspace User</p>
              <p className="text-xs text-slate-500">Free Tier</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div 
          onClick={() => setIsMobileMenuOpen(false)}
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden"
        />
      )}

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto lg:overflow-hidden relative">
        {/* Header Bar */}
        <header className="min-h-20 bg-white border-b border-slate-200 flex flex-col md:flex-row items-center justify-between gap-4 p-4 md:px-10 shrink-0 sticky top-0 z-30 lg:z-10">
          <div className="flex items-center gap-4 w-full md:w-auto">
            {isEditingName ? (
              <input
                autoFocus
                type="text"
                value={meetingName}
                onChange={(e) => setMeetingName(e.target.value)}
                onBlur={() => setIsEditingName(false)}
                onKeyDown={(e) => e.key === 'Enter' && setIsEditingName(false)}
                className="text-lg font-semibold bg-slate-50 border border-indigo-200 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-indigo-500/20 w-48 md:w-64"
              />
            ) : (
              <h2 
                onClick={() => setIsEditingName(true)}
                className="text-lg font-semibold truncate leading-none cursor-pointer hover:text-indigo-600 transition-colors flex items-center gap-2 group"
                title="Click to rename meeting"
              >
                {meetingName}
                <Settings className="w-3.5 h-3.5 opacity-0 group-hover:opacity-50" />
              </h2>
            )}
            
            {isRecording && (
              <span className="px-2 py-1 bg-red-100 text-red-600 text-[10px] font-bold rounded uppercase tracking-wider flex items-center gap-1.5 shrink-0">
                <span className="w-1.5 h-1.5 bg-red-600 rounded-full animate-pulse"></span>
                {formatTime(recordingTime)}
              </span>
            )}
          </div>
          
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-start md:justify-end">
            {result && (
              <>
                <button 
                  onClick={copyToClipboard}
                  className="px-3 py-2 border border-slate-200 text-xs font-medium rounded-lg flex items-center gap-2 hover:bg-slate-50 transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button 
                  onClick={exportText}
                  className="px-3 py-2 border border-slate-200 text-xs font-medium rounded-lg flex items-center gap-2 hover:bg-slate-50 transition-colors text-slate-600"
                >
                  <FileText className="w-4 h-4" /> TXT
                </button>
                <button 
                  onClick={exportPDF}
                  className="px-3 py-2 border border-slate-200 text-xs font-medium rounded-lg flex items-center gap-2 hover:bg-slate-50 transition-colors text-indigo-600 border-indigo-100 bg-indigo-50/30"
                >
                  <Download className="w-4 h-4" /> PDF
                </button>
              </>
            )}
            {isRecording ? (
              <button 
                onClick={stopRecording}
                className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-all flex items-center gap-2 active:scale-95 ml-auto md:ml-0"
              >
                <Square className="w-4 h-4 fill-current" /> Stop
              </button>
            ) : (
              !result && (
                <button 
                  onClick={startRecording}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-lg shadow-indigo-100 active:scale-95 ml-auto md:ml-0"
                >
                  <Mic className="w-4 h-4" /> Start Meeting
                </button>
              )
            )}
            {result && (
               <button 
               onClick={() => {setResult(null); setAudioUrl(null); setAudioBlob(null);}}
               className="p-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-all"
               title="New Session"
             >
               <RefreshCcw className="w-4 h-4" />
             </button>
            )}
          </div>
        </header>

        {/* Content View */}
        <div className="flex-1 p-6 md:p-10 flex flex-col xl:flex-row gap-8 overflow-y-auto lg:overflow-hidden">
          {/* Main Content Column */}
          <section className="flex-1 bg-white rounded-2xl border border-slate-200 flex flex-col shadow-sm min-h-[400px] overflow-hidden">
            <div className="p-4 md:p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 relative px-6">
              <h3 className="font-bold text-slate-500 uppercase text-[10px] tracking-widest flex items-center gap-2">
                <FileText className="w-3 h-3" /> Transcript & Analysis
              </h3>
              {isProcessing && <RefreshCcw className="w-3 h-3 animate-spin text-indigo-500" />}
            </div>

            <div className="flex-1 overflow-y-auto p-6 md:p-10 prose prose-slate max-w-none prose-sm sm:prose-base prose-headings:text-slate-900 prose-p:text-slate-600 prose-headings:mb-4 h-full">
              {!result && !isProcessing && !isRecording && (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-50 py-12">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                    <Mic className="w-8 h-8 text-slate-400" />
                  </div>
                  <p className="text-sm font-medium">Ready to record or upload</p>
                  <p className="text-xs mt-1">Multi-language processing active</p>
                </div>
              )}

              {isRecording && (
                <div className="h-full flex flex-col items-center justify-center space-y-6 py-12">
                  <div className="w-full max-w-md h-32 flex items-center justify-center bg-indigo-50/30 rounded-2xl border border-indigo-100 border-dashed p-4">
                     <canvas ref={canvasRef} width={400} height={100} className="w-full h-full opacity-60" />
                  </div>
                  <div className="text-center">
                    <motion.p 
                      animate={{ opacity: [0.5, 1, 0.5] }}
                      transition={{ repeat: Infinity, duration: 2 }}
                      className="text-lg font-semibold text-slate-700"
                    >
                      Capturing live audio...
                    </motion.p>
                    <p className="text-sm text-slate-500">Speaking in English & Hindi supported</p>
                  </div>
                </div>
              )}

              {isProcessing && (
                <div className="h-full flex flex-col items-center justify-center text-center py-20">
                  <motion.div 
                    animate={{ scale: [1, 1.1, 1], rotate: 360 }} 
                    transition={{ scale: { repeat: Infinity, duration: 2 }, rotate: { repeat: Infinity, duration: 4, ease: "linear" } }}
                    className="w-14 h-14 bg-indigo-100 rounded-full flex items-center justify-center mb-6"
                  >
                    <RefreshCcw className="w-7 h-7 text-indigo-600" />
                  </motion.div>
                  <h4 className="text-lg font-semibold mb-2">Analyzing Meeting Data</h4>
                  <p className="text-sm text-slate-500 max-w-xs mx-auto">
                    Transcribing and summarizing your session. This may take a moment...
                  </p>
                </div>
              )}

              {result && (
                <ReactMarkdown>{result}</ReactMarkdown>
              )}
            </div>
          </section>

          {/* Tools / Side Column */}
          <aside className="w-full xl:w-[300px] flex flex-col gap-6 shrink-0 lg:overflow-y-auto lg:pb-10">
            {/* Quick Actions / Integration */}
            <div className="bg-indigo-600 rounded-2xl p-6 text-white shadow-lg shadow-indigo-100/50 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2 group-hover:scale-110 transition-transform" />
              <h3 className="font-bold uppercase text-[10px] tracking-widest mb-4 opacity-80 flex items-center gap-2">
                <TrendingUp className="w-3 h-3" /> System Status
              </h3>
              <p className="text-xs leading-relaxed opacity-90 mb-4 relative z-10">
                Hybrid Engine: Seamlessly transitioning between Hindi and English transcription modes.
              </p>
              <div className="flex gap-2 flex-wrap">
                <div className="flex items-center gap-2 text-[10px] bg-white/10 px-2 py-1.5 rounded-md font-medium">
                  <span className="w-1.5 h-1.5 bg-indigo-300 rounded-full animate-pulse" />
                  EN/HI SYNC
                </div>
                <div className="flex items-center gap-2 text-[10px] bg-white/10 px-2 py-1.5 rounded-md font-medium">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
                  LATENCY OK
                </div>
              </div>
            </div>

            {/* Audio Panel */}
            {audioUrl && !isRecording && (
               <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-500 uppercase text-[10px] tracking-widest mb-3 flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5" /> Source Playback
                </h3>
                <div className="bg-slate-50 rounded-xl p-2 border border-slate-100">
                  <audio src={audioUrl} controls className="w-full h-8" />
                </div>
                {!result && !isProcessing && (
                  <button 
                    onClick={processAudio}
                    className="w-full mt-3 py-3 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-colors shadow-md shadow-indigo-100 flex items-center justify-center gap-2"
                  >
                    <RefreshCcw className="w-4 h-4" /> Run Processor
                  </button>
                )}
              </div>
            )}

            {/* Secondary Utility */}
            <div className="bg-white rounded-2xl p-6 border border-slate-200 flex-1 flex flex-col shadow-sm min-h-[200px]">
              <h3 className="font-bold text-slate-500 uppercase text-[10px] tracking-widest mb-4 flex items-center gap-2">
                <ListTodo className="w-3.5 h-3.5" /> Action Checklist
              </h3>
              <div className="space-y-2">
                {['Verify speaker names', 'Proofread translation', 'Export to PDF archive'].map((item, i) => (
                  <div key={i} className="group flex items-center gap-3 p-3 bg-slate-50 hover:bg-slate-100 transition-colors rounded-lg cursor-pointer border border-transparent">
                    <div className="w-4 h-4 rounded border-2 border-slate-300 shrink-0 flex items-center justify-center group-hover:border-indigo-400 transition-colors">
                      <div className="w-2 h-2 rounded-sm bg-indigo-500 opacity-0 group-hover:opacity-10 transition-opacity" />
                    </div>
                    <span className="text-xs font-medium text-slate-600">{item}</span>
                  </div>
                ))}
              </div>
              
              <div className="mt-8 pt-6 border-t border-slate-100">
                <div className="flex items-start gap-3 p-3 bg-indigo-50/50 rounded-xl border border-indigo-100">
                  <AlertCircle className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-indigo-700 leading-normal font-medium">
                    Note: Audio duration limits may apply based on workspace settings.
                  </p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* Error Toast / Alert Area */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[100]"
          >
            <div className="bg-red-600 text-white px-6 py-3 rounded-full shadow-xl flex items-center gap-3 whitespace-nowrap">
              <AlertCircle className="w-5 h-5" />
              <span className="text-sm font-medium">{error}</span>
              <button 
                onClick={() => setError(null)}
                className="ml-2 hover:bg-white/20 p-1 rounded-full transition-colors"
                title="Dismiss"
              >
                <Square className="w-4 h-4 rotate-45" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
