import { useState, useRef, useEffect } from 'react'
import { Send, Paperclip, Folder, AtSign, Search, Share2, Download } from 'lucide-react'

// Message Types
interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  analysisSteps?: AnalysisStep[]
}

interface AnalysisStep {
  icon: 'database' | 'globe' | 'chart'
  title: string
  subtitle: string
}

// Analysis Stream Component
function AnalysisStream({ steps }: { steps: AnalysisStep[] }) {
  const icons = {
    database: (
      <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
      </svg>
    ),
    globe: (
      <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
      </svg>
    ),
    chart: (
      <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  }

  return (
    <div className="flex gap-4 mb-6">
      {steps.map((step, i) => (
        <div key={i} className="flex-1 bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
              {icons[step.icon]}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">{step.title}</p>
              <p className="text-xs text-gray-500">{step.subtitle}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// Data Table Component
function DataTable() {
  const data = [
    { category: 'TAM', scope: 'Total Hydrogen Economy Infrastructure', value: '¥1.24 Trillion' },
    { category: 'SAM', scope: 'Public & Industrial Refueling Stations', value: '¥480 Billion' },
    { category: 'SOM', scope: 'Sinopec Targeted Vertical Expansion', value: '¥165 Billion' },
  ]

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Metric Category</th>
            <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Scope Definition</th>
            <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Value (RMB)</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className="border-b border-gray-100 last:border-0">
              <td className="px-4 py-4">
                <span className="font-semibold text-blue-600">{row.category}</span>
              </td>
              <td className="px-4 py-4 text-sm text-gray-600">{row.scope}</td>
              <td className="px-4 py-4 text-right font-semibold text-blue-600">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Chat Message Component
function ChatMessage({ message }: { message: Message }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-6">
        <div className="max-w-3xl bg-gray-100 rounded-2xl rounded-br-md px-6 py-4">
          <p className="text-gray-800 leading-relaxed">{message.content}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-6">
      {/* AI Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <span className="font-semibold text-gray-900">Aria AI Analysis Stream</span>
        <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
      </div>

      {/* Analysis Steps */}
      {message.analysisSteps && <AnalysisStream steps={message.analysisSteps} />}

      {/* Content */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <p className="text-gray-700 leading-relaxed mb-6">
          {message.content}
        </p>
        <DataTable />
      </div>
    </div>
  )
}

// Input Toolbar
function InputToolbar() {
  return (
    <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-200">
      <button className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
        <Folder className="w-4 h-4" />
        <span>Project Context</span>
      </button>
      <button className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
        <AtSign className="w-4 h-4" />
        <span>@ Skills</span>
      </button>
      <button className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
        <Search className="w-4 h-4" />
        <span>/ Context</span>
      </button>
    </div>
  )
}

// Main Chat Component
export function Chat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'user',
      content: 'Aria, I need a detailed market sizing analysis for the Sinopec 2026 Growth Strategy. Specifically, focus on the hydrogen refueling infrastructure market in Mainland China. Please break it down into TAM, SAM, and SOM in RMB values.',
      timestamp: new Date(),
    },
    {
      id: '2',
      role: 'assistant',
      content: 'Based on current infrastructure trajectory and the 14th Five-Year Plan targets, here is the market sizing for Hydrogen Refueling Stations (HRS) in Mainland China by 2026. The model assumes a shift toward integrated energy stations.',
      timestamp: new Date(),
      analysisSteps: [
        { icon: 'database', title: 'Searching DB', subtitle: 'Sinopec Internal 2024' },
        { icon: 'globe', title: 'Web Researching', subtitle: 'China Energy Admin' },
        { icon: 'chart', title: 'Generating Model', subtitle: 'Projecting 2026 CAGR' },
      ],
    },
  ])
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSend = () => {
    if (!input.trim()) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')

    // Simulate AI response
    setTimeout(() => {
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'I\'ve analyzed the data and provided comprehensive market sizing. Would you like me to dive deeper into any specific segment or create a detailed competitive landscape analysis?',
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, aiMessage])
    }, 1500)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      {/* Project Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between max-w-5xl mx-auto">
          <div>
            <span className="inline-block px-2.5 py-0.5 text-xs font-semibold text-blue-700 bg-blue-100 rounded-full mb-2">
              ACTIVE STRATEGY
            </span>
            <h1 className="text-2xl font-bold text-gray-900">Sinopec 2026 Growth Strategy</h1>
            <p className="text-sm text-gray-500">Market Sizing & Vertical Expansion Analysis</p>
          </div>
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
              <Share2 className="w-4 h-4" />
              Share
            </button>
            <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
              <Download className="w-4 h-4" />
              Export Report
            </button>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-4xl mx-auto">
          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="bg-white border-t border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <InputToolbar />
          <div className="flex items-center gap-3 px-4 py-3">
            <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              <Paperclip className="w-5 h-5" />
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Deepen analysis or trigger skill..."
              className="flex-1 text-gray-800 placeholder-gray-400 outline-none"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="w-10 h-10 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg flex items-center justify-center transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
