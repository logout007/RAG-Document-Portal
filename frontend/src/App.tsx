import { useState, useRef, useCallback } from 'react'
import { Upload, Search, FileText, Trash2, Loader2, ChevronDown, ChevronUp, Zap } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

interface Document {
  id: string
  filename: string
  file_size: number
  page_count: number
  chunk_count: number
  status: 'processing' | 'ready' | 'error'
  created_at: string
}

interface Source {
  documentId: string
  pageNumber: number
  similarity: number
  preview: string
}

interface SearchResult {
  query: string
  answer: string
  sources: Source[]
  latencyMs: number
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export default function App() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [result, setResult] = useState<SearchResult | null>(null)
  const [query, setQuery] = useState('')
  const [selectedDocId, setSelectedDocId] = useState<string>('')
  const [uploading, setUploading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [searchError, setSearchError] = useState('')
  const [showSources, setShowSources] = useState(false)
  const [docsLoaded, setDocsLoaded] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadDocuments = useCallback(async () => {
    try {
      const res = await fetch(`${API}/documents`)
      const data = await res.json()
      setDocuments(data.documents || [])
      setDocsLoaded(true)
    } catch {
      setDocuments([])
    }
  }, [])

  const handleUpload = async (file: File) => {
    setUploadError('')
    setUploading(true)
    const form = new FormData()
    form.append('file', file)

    try {
      const res = await fetch(`${API}/documents/upload`, { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      await loadDocuments()
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (id: string) => {
    await fetch(`${API}/documents/${id}`, { method: 'DELETE' })
    setDocuments(prev => prev.filter(d => d.id !== id))
    if (selectedDocId === id) setSelectedDocId('')
  }

  const handleSearch = async () => {
    if (!query.trim()) return
    setSearchError('')
    setSearching(true)
    setResult(null)
    setShowSources(false)

    try {
      const res = await fetch(`${API}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), documentId: selectedDocId || undefined })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Search failed')
      setResult(data)
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <Zap size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">DocSearch RAG Portal</h1>
            <p className="text-xs text-gray-500">Semantic document search · OpenAI + pgvector</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">

        {/* Upload zone */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-medium text-gray-700 mb-4">Upload Documents</h2>
          <div
            className="border-2 border-dashed border-gray-200 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors"
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleUpload(f) }}
          >
            {uploading
              ? <Loader2 size={24} className="animate-spin text-indigo-500 mx-auto mb-2" />
              : <Upload size={24} className="text-gray-400 mx-auto mb-2" />
            }
            <p className="text-sm text-gray-600">
              {uploading ? 'Processing PDF...' : 'Drop a PDF here or click to browse'}
            </p>
            <p className="text-xs text-gray-400 mt-1">Max 10MB · PDF only</p>
            <input ref={fileRef} type="file" accept=".pdf" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f) }} />
          </div>
          {uploadError && <p className="text-sm text-red-600 mt-2">{uploadError}</p>}
        </section>

        {/* Document list */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-700">Documents</h2>
            {!docsLoaded && (
              <button onClick={loadDocuments} className="text-xs text-indigo-600 hover:underline">
                Load documents
              </button>
            )}
          </div>

          {documents.length === 0
            ? <p className="text-sm text-gray-400 text-center py-4">No documents yet — upload a PDF above</p>
            : (
              <div className="space-y-2">
                {documents.map(doc => (
                  <div key={doc.id}
                    onClick={() => setSelectedDocId(prev => prev === doc.id ? '' : doc.id)}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedDocId === doc.id
                        ? 'border-indigo-300 bg-indigo-50'
                        : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <FileText size={16} className={selectedDocId === doc.id ? 'text-indigo-500' : 'text-gray-400'} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{doc.filename}</p>
                      <p className="text-xs text-gray-500">
                        {doc.page_count} pages · {doc.chunk_count} chunks · {formatBytes(doc.file_size)}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      doc.status === 'ready' ? 'bg-green-100 text-green-700'
                      : doc.status === 'error' ? 'bg-red-100 text-red-700'
                      : 'bg-yellow-100 text-yellow-700'
                    }`}>{doc.status}</span>
                    <button onClick={e => { e.stopPropagation(); handleDelete(doc.id) }}
                      className="text-gray-300 hover:text-red-500 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                {selectedDocId && (
                  <p className="text-xs text-indigo-600 mt-2">
                    Searching within selected document only. Click again to search all.
                  </p>
                )}
              </div>
            )}
        </section>

        {/* Search */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-medium text-gray-700 mb-4">Ask a Question</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="e.g. What are the key risks mentioned in section 3?"
              className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
            />
            <button
              onClick={handleSearch}
              disabled={searching || !query.trim()}
              className="px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
            >
              {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>
          {searchError && <p className="text-sm text-red-600 mt-2">{searchError}</p>}
        </section>

        {/* Result */}
        {result && (
          <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-700">Answer</h2>
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <Zap size={12} /> {result.latencyMs}ms
              </span>
            </div>

            <div className="prose prose-sm max-w-none">
              <p className="text-gray-800 leading-relaxed whitespace-pre-wrap text-sm">{result.answer}</p>
            </div>

            {result.sources.length > 0 && (
              <div className="border-t border-gray-100 pt-4">
                <button
                  onClick={() => setShowSources(s => !s)}
                  className="text-xs text-gray-500 flex items-center gap-1 hover:text-gray-700"
                >
                  {showSources ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {result.sources.length} sources used
                </button>

                {showSources && (
                  <div className="mt-3 space-y-2">
                    {result.sources.map((src, i) => (
                      <div key={i} className="bg-gray-50 rounded-lg p-3 text-xs">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-gray-700">Page {src.pageNumber}</span>
                          <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-medium">
                            {src.similarity}% match
                          </span>
                        </div>
                        <p className="text-gray-600 leading-relaxed">{src.preview}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
